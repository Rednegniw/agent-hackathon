import { exec } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createServer as createProbe } from 'node:net'
import { dirname, extname, join, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { AgentSandbox } from './arena.js'
import { BaseArena, waitForHealthy } from './arena-base.js'
import type { AgentId } from './events.js'

const run = promisify(exec)
const CAP = 2000

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
}

/**
 * A sandbox backed by a local temp directory. No Daytona, no network, no cost.
 * Behaviour matches DaytonaArena closely enough that the agent loop cannot
 * tell them apart.
 */
/**
 * Commands that would reach past this agent and hit the developer's machine.
 * Real agents genuinely try these: given a port conflict they will happily
 * run `lsof -i :3000 | xargs kill -9`, which in fake mode kills whatever the
 * developer had on that port. DaytonaArena needs no such list because the
 * kernel and network namespace are already the boundary.
 */
const HOST_HAZARDS = /\b(pkill|killall|kill\s+-9|shutdown|reboot|launchctl|systemctl)\b|lsof[^|]*\|\s*xargs\s+kill/

let nextPort = 4100

/** True if something is already listening. Used to skip occupied ports. */
const portTaken = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createProbe()
    probe.once('error', () => resolve(true))
    probe.once('listening', () => probe.close(() => resolve(false)))
    probe.listen(port, '127.0.0.1')
  })

class FakeSandbox implements AgentSandbox {
  #dir: string
  #server?: Server
  #port: number
  #portChecked = false

  constructor(agentId: AgentId) {
    this.#dir = join(tmpdir(), `arena-${agentId}-${Date.now()}`)
    mkdirSync(this.#dir, { recursive: true })

    /**
     * Each fake agent owns a distinct port. Without this every agent binds
     * 3000 on one laptop, they detect the collision, and they spend the whole
     * build phase killing each other's servers instead of building.
     */
    this.#port = nextPort++
  }

  /** Where the shell records PIDs it backgrounded, so close() can reap them. */
  get #pidFile() {
    return join(this.#dir, '.arena-pids')
  }

  /**
   * Claims a port nothing else is on.
   *
   * The counter restarts at 4100 in every process, so a server orphaned by an
   * earlier run still holds the port a new agent is about to claim. The agent
   * then fails to bind, preview() finds the *stale* server healthy, and the
   * round reports one agent's URL serving another agent's page.
   */
  async #claimPort(): Promise<number> {
    if (this.#portChecked) return this.#port

    while (await portTaken(this.#port)) this.#port = nextPort++
    this.#portChecked = true
    return this.#port
  }

  get dir() {
    return this.#dir
  }

  async bash(command: string): Promise<string> {
    if (HOST_HAZARDS.test(command)) {
      throw new Error(
        'That command would affect processes outside your sandbox and was blocked. ' +
          'Nothing else is competing for your port: just start your server.',
      )
    }

    // Redirect the shared port onto this agent's own, so agents cannot collide.
    const ported = command.replaceAll('3000', String(await this.#claimPort()))

    /**
     * `~` is the sandbox home in DaytonaArena. Here the shell would expand it
     * to the developer's real home, so `cd ~/app` escapes the sandbox, fails,
     * and — because the agent's canonical command backgrounds that `cd`
     * chain — takes the server down while `sleep 1; echo up` still exits 0.
     * The agent then reports a running server that never existed.
     */
    const local = ported.replace(/~(?=\/|$|\s)/g, this.#dir)

    /**
     * Record anything the command backgrounded so close() can reap it. A
     * nohup'd server outlives the shell, the round and the whole process, and
     * the next run then collides with it. `$!` is the last background PID;
     * the exit code is captured first so this bookkeeping cannot mask a
     * genuine command failure.
     */
    const wrapped =
      `${local}\n__rc=$?; if [ -n "$!" ]; then echo $! >> ${JSON.stringify(this.#pidFile)}; fi; exit $__rc`

    try {
      const { stdout, stderr } = await run(wrapped, { cwd: this.#dir, timeout: 60_000 })
      return (stdout || stderr || '').slice(0, CAP)
    } catch (err: any) {
      const out = `${err.stdout ?? ''}${err.stderr ?? ''}` || err.message
      throw new Error(`exit ${err.code ?? 1}: ${String(out).slice(0, CAP)}`)
    }
  }

  async write(path: string, content: string): Promise<void> {
    await this.writeBytes(path, Buffer.from(content, 'utf8'))
  }

  async writeBytes(path: string, content: Uint8Array): Promise<void> {
    const target = this.#resolve(path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }

  async read(path: string): Promise<Uint8Array> {
    return new Uint8Array(readFileSync(this.#resolve(path)))
  }

  #resolve(path: string) {
    return join(this.#dir, path.replace(/^[~/]+/, ''))
  }

  /**
   * Serves this agent's directory on an ephemeral port and returns that URL.
   * The declared port is deliberately ignored: six fake agents on one laptop
   * would all try to bind 3000 and five would fail. In DaytonaArena each
   * agent has its own network namespace, so there the port is honoured.
   */
  async preview(_port: number): Promise<string> {
    /**
     * If the agent started its own server on its rewritten port, that is the
     * real artifact and we serve it. Only when nothing is listening do we fall
     * back to serving the directory ourselves, so a fake round still completes.
     */
    try {
      return await waitForHealthy(`http://127.0.0.1:${await this.#claimPort()}/`, 2500)
    } catch {
      // Nothing listening. Fall through to the built-in static server.
    }

    /**
     * Serve wherever the artifact actually is. Agents are told to build in
     * ~/app and serve that directory, so rooting the fallback at the sandbox
     * home 404s every well-behaved agent: `/` looks for <dir>/index.html while
     * the page sits at <dir>/app/index.html.
     */
    const root = existsSync(join(this.#dir, 'index.html'))
      ? this.#dir
      : existsSync(join(this.#dir, 'app', 'index.html'))
        ? join(this.#dir, 'app')
        : this.#dir

    if (!this.#server) {
      this.#server = createServer((req, res) => {
        const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]))
        let file = join(root, rel)

        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
        if (!file.startsWith(root) || !existsSync(file)) {
          res.writeHead(404).end('not found')
          return
        }

        res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'text/plain' })
        createReadStream(file).pipe(res)
      })

      await new Promise<void>((r) => this.#server!.listen(0, '127.0.0.1', r))
    }

    const { port } = this.#server.address() as { port: number }
    return waitForHealthy(`http://127.0.0.1:${port}/`)
  }

  /**
   * Closes the built-in server *and* reaps whatever the agent backgrounded.
   * Without this a nohup'd server outlives the round and the whole process,
   * and the next run either collides with it or — worse — serves its stale
   * page under a new agent's name.
   */
  async close(): Promise<void> {
    this.#server?.close()

    /**
     * Recorded PIDs first. `$!` is the backgrounded *subshell*, so killing it
     * is necessary but not sufficient: `cd x && nohup server` leaves the
     * server parented to that subshell, and it survives as an orphan.
     */
    if (existsSync(this.#pidFile)) {
      for (const line of readFileSync(this.#pidFile, 'utf8').split('\n')) {
        const pid = Number(line.trim())
        if (!Number.isInteger(pid) || pid <= 1) continue
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Already gone, which is the outcome we wanted.
        }
      }
    }

    /**
     * Then the orphan itself, by port. This is safe precisely because
     * #claimPort verified nothing held this port when the sandbox took it:
     * whatever is listening now was started by this agent. Without that
     * guarantee, killing by port could hit a developer's own process.
     */
    if (!this.#portChecked) return

    try {
      await run(`pids=$(lsof -ti:${this.#port} -sTCP:LISTEN); [ -n "$pids" ] && kill -9 $pids || true`)
    } catch {
      // No lsof, or nothing left to kill. Neither is worth failing teardown.
    }
  }
}

/** Drop-in Arena with zero external dependencies. Run with ARENA=fake. */
export class FakeArena extends BaseArena {
  #pool = new Map<AgentId, FakeSandbox>()

  sandboxFor(agentId: AgentId): AgentSandbox {
    let s = this.#pool.get(agentId)
    if (!s) {
      s = new FakeSandbox(agentId)
      this.#pool.set(agentId, s)
    }
    return s
  }

  async teardown() {
    // allSettled: one sandbox failing to reap must not strand the others.
    await Promise.allSettled([...this.#pool.values()].map((s) => s.close()))
    this.#pool.clear()
  }
}

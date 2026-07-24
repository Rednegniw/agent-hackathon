import { exec } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
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

class FakeSandbox implements AgentSandbox {
  #dir: string
  #server?: Server
  #port: number

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
    const local = command.replaceAll('3000', String(this.#port))

    try {
      const { stdout, stderr } = await run(local, { cwd: this.#dir, timeout: 60_000 })
      return (stdout || stderr || '').slice(0, CAP)
    } catch (err: any) {
      const out = `${err.stdout ?? ''}${err.stderr ?? ''}` || err.message
      throw new Error(`exit ${err.code ?? 1}: ${String(out).slice(0, CAP)}`)
    }
  }

  async write(path: string, content: string): Promise<void> {
    const target = join(this.#dir, path.replace(/^[~/]+/, ''))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
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
      return await waitForHealthy(`http://127.0.0.1:${this.#port}/`, 2500)
    } catch {
      // Nothing listening. Fall through to the built-in static server.
    }

    if (!this.#server) {
      this.#server = createServer((req, res) => {
        const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]))
        let file = join(this.#dir, rel)

        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
        if (!file.startsWith(this.#dir) || !existsSync(file)) {
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

  close() {
    this.#server?.close()
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
    for (const s of this.#pool.values()) s.close()
    this.#pool.clear()
  }
}

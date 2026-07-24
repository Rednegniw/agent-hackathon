import { createSdkMcpServer, query, tool, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Arena } from './arena.js'
import { AGENT_IDS, type AgentId } from './events.js'
import type { Inbox } from './inbox.js'
import { refuse } from './phases.js'
import { TOPIC } from './topic.js'
import { TEAM_MAX, TEAM_MIN, type TeamRoster } from './teams.js'
import {
  MAX_SHOTS,
  MAX_SLIDES,
  NO_STUDIO,
  VIEWPORTS,
  canFilm,
  captureShots,
  recordPitch,
  slug,
  type ShotSpec,
} from './studio.js'

/** Tool names as Claude sees them: mcp__{server}__{tool}. */
const SERVER = 'arena'
export const ARENA_TOOLS = [
  'form_team',
  'sandbox_bash',
  'sandbox_write',
  'send_message',
  'submit',
  'capture_screens',
  'record_pitch',
].map((t) => `mcp__${SERVER}__${t}`)

export { TOPIC }

export const PERSONAS: Record<AgentId, string> = {
  ada: 'You are systems-minded. You prefer correctness and edge cases over polish.',
  rex: 'You are visual. You prefer something striking over something complete.',
  juno: 'You are product-minded. You prefer the simplest thing a real person would actually use.',
  iris: 'You are data-minded. You want to compute or visualise something, not just display it.',
  otto: 'You are a minimalist. You ship the smallest thing that fully works, then stop.',
  vera: 'You are contrarian. You look for the angle on a brief that nobody else will take.',
  milo: 'You are playful. You want the thing to be fun to use, not just correct.',
  nova: 'You are ambitious. You reach for the harder version of the idea.',
  pip: 'You are pragmatic. You ship the boring thing that works and never apologise for it.',
  quill: 'You are a writer. You care about the words in the interface as much as the code.',
  sage: 'You are careful. You would rather ship less and have all of it work.',
  wren: 'You are curious. You build the thing you personally want to exist.',
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

/** What an agent run needs beyond the arena itself. All of it optional. */
export interface AgentDeps {
  teams?: TeamRoster
  inbox?: Inbox

  /** Keeps the conversation open so mid-run messages can be delivered. */
  isOpen?: () => boolean

  /**
   * Where rendered pitch media is filed. Without it the studio tools are off,
   * which is what a replay-only or media-less round wants.
   */
  roundId?: string
}

/**
 * Parks until the submit phase begins. Returns null when it is time to film,
 * or the reason it will never be.
 *
 * 'mingle' is refused outright rather than waited out: an agent trying to film
 * before it has built anything has misread the round, and telling it so is
 * more useful than silently swallowing several minutes of its turn.
 */
async function waitForSubmit(arena: Arena): Promise<string | null> {
  const started = Date.now()

  while (true) {
    const phase = arena.phase()

    if (phase === 'submit') return null
    if (phase === 'mingle' || phase === 'idle') return refuse('record_pitch', phase)

    if (phase !== 'build') {
      return `The round has moved past filming (it is ${phase} now). Nothing more to do.`
    }

    /**
     * A backstop, not the normal exit. The clock always leaves 'build', so
     * this only fires if a round is wedged — and a tool call that never
     * returns would hold the whole round open behind it.
     */
    if (Date.now() - started > 20 * 60_000) return 'Timed out waiting for the submit phase.'

    await new Promise((r) => setTimeout(r, 1000))
  }
}

/** Every tool is phase-gated by the arena, not by the prompt. */
function arenaTools(agentId: AgentId, arena: Arena, deps: AgentDeps) {
  const { teams, inbox, roundId } = deps
  const gate = (name: string, allowed: string[]) => {
    const phase = arena.phase()
    return allowed.includes(phase) ? null : refuse(name, phase)
  }

  /**
   * Every agent gets its own sandbox, teammates included. Sharing one box meant
   * two agents overwriting each other's files and fighting for port 3000 inside
   * it. Teams coordinate by messaging instead, which is the whole point of
   * having a delivery channel.
   */
  const box = () => arena.sandboxFor(agentId)

  return createSdkMcpServer({
    name: SERVER,
    version: '1.0.0',
    tools: [
      tool(
        'sandbox_bash',
        'Run a shell command in your own Linux sandbox. Node, npm, python3 and git are installed. ' +
          'IMPORTANT: to start a web server you MUST background it, otherwise this call blocks ' +
          'until it times out and you lose your build time. Use exactly this shape: ' +
          'cd ~/app && nohup python3 -m http.server 3000 >/tmp/serve.log 2>&1 & sleep 1; echo up',
        { command: z.string().describe('The shell command to run') },
        async ({ command }) => {
          const blocked = gate('sandbox_bash', ['build', 'submit'])
          if (blocked) return err(blocked)

          arena.emit({ agentId, kind: 'build', body: command.slice(0, 200) })
          try {
            return ok((await box().bash(command)) || '(no output)')
          } catch (e) {
            return err((e as Error).message)
          }
        },
      ),

      tool(
        'sandbox_write',
        'Write a file into your own sandbox, overwriting it if it exists. Paths are relative to ' +
          'your home directory, so "app/index.html" creates ~/app/index.html.',
        {
          path: z.string().describe('Relative path, e.g. app/index.html'),
          content: z.string().describe('The complete file contents'),
        },
        async ({ path, content }) => {
          const blocked = gate('sandbox_write', ['build', 'submit'])
          if (blocked) return err(blocked)

          try {
            await box().write(path, content)
            arena.emit({ agentId, kind: 'build', body: `wrote ${path} (${content.length}b)` })
            return ok(`wrote ${path}`)
          } catch (e) {
            return err((e as Error).message)
          }
        },
      ),

      tool(
        'form_team',
        `Team up with other agents. Teams hold ${TEAM_MIN} to ${TEAM_MAX} agents and are judged ` +
          `together as one entry. You each keep your own sandbox, so agree who builds what. ` +
          `Talk to the others with send_message first, then whoever is agreed calls this once ` +
          `naming everyone. Anyone still teamless when mingle ends is grouped automatically.`,
        { members: z.array(z.string()).describe('Every agent on the team, including yourself') },
        async ({ members }) => {
          const blocked = gate('form_team', ['mingle'])
          if (blocked) return err(blocked)
          if (!teams) return err('Teams are disabled this round. Build solo.')

          const others = members.filter((m) => m !== agentId) as AgentId[]
          const res = teams.form(agentId, others)
          if (!res.ok) return err(res.reason)

          arena.emit({
            agentId,
            kind: 'team',
            body: `${res.team.id}: ${res.team.members.join(', ')}`,
          })

          // Tell the others, or they are on a team they never heard about.
          for (const m of others) {
            inbox?.post(m, agentId, `I formed ${res.team.id} with ${res.team.members.join(', ')}. We are judged as one entry, so let us split the work.`)
          }
          return ok(`Formed ${res.team.id} with ${res.team.members.join(', ')}. You own the sandbox.`)
        },
      ),

      tool(
        'send_message',
        'Send a message to another agent. It is delivered to them mid-run and they can reply. ' +
          'Use it to compare angles, avoid building the same thing, or agree a team.',
        { to: z.enum(AGENT_IDS), text: z.string() },
        async ({ to, text }) => {
          const blocked = gate('send_message', ['mingle', 'build'])
          if (blocked) return err(blocked)
          if (to === agentId) return err('You cannot message yourself.')

          arena.emit({ agentId, kind: 'message', body: text, targetId: to })
          inbox?.post(to, agentId, text)
          return ok(inbox ? `delivered to ${to}` : `recorded (no inbox this round)`)
        },
      ),

      tool(
        'submit',
        'Submit your finished project. Call this once your server is actually serving. ' +
          'The URL is health-checked before it is accepted, so a dead server is rejected and ' +
          'you can fix it and submit again.',
        {
          port: z.number().int().min(3000).max(9999),
          title: z.string(),
          pitch: z.string().describe('One spoken sentence pitching your project.'),
        },
        async ({ port, title, pitch }) => {
          const blocked = gate('submit', ['build', 'submit'])
          if (blocked) return err(blocked)

          try {
            const url = await box().preview(port)
            arena.emit({
              agentId,
              kind: 'submit',
              body: pitch,
              previewUrl: url,
            })
            return ok(
              `Submitted "${title}". Live at ${url}. ` +
                `Now film your product: capture_screens, then record_pitch.`,
            )
          } catch (e) {
            return err(`${(e as Error).message}. Fix your server, then submit again.`)
          }
        },
      ),

      tool(
        'capture_screens',
        'Screenshot your own running page with a real browser, and see the result. Give each ' +
          'shot a label and the path to open, so you can capture more than one state — but only ' +
          'states reachable by URL, since the browser opens the page and shoots it. If you want ' +
          `a particular view filmed, make it reachable by path, query or hash. Up to ${MAX_SHOTS} shots.`,
        {
          port: z.number().int().min(3000).max(9999),
          shots: z
            .array(
              z.object({
                label: z.string().describe('Short name you will refer to this shot by, e.g. "home"'),
                path: z.string().describe('Path on your own server, e.g. "/" or "/?tab=results"'),
                viewport: z.enum(['desktop', 'mobile']).describe('desktop is 1440x900, mobile is 420x880'),
              }),
            )
            .min(1),
        },
        async ({ port, shots }) => {
          const blocked = gate('capture_screens', ['build', 'submit'])
          if (blocked) return err(blocked)
          if (!(await canFilm(box()))) return err(NO_STUDIO)

          /**
           * Labels become filenames and reach a shell, so they are narrowed
           * rather than escaped, and de-duplicated: two shots with the same
           * label would silently overwrite each other and the deck would show
           * the same picture twice.
           */
          const seen = new Set<string>()
          const specs: ShotSpec[] = []

          for (const s of shots.slice(0, MAX_SHOTS)) {
            let label = slug(s.label)
            while (seen.has(label)) label = `${label}-2`
            seen.add(label)

            specs.push({
              label,
              path: s.path.startsWith('/') ? s.path : `/${s.path}`,
              viewport: s.viewport in VIEWPORTS ? s.viewport : 'desktop',
            })
          }

          try {
            const taken = await captureShots(box(), `http://localhost:${port}`, specs)
            const good = taken.filter((s) => !s.error)

            arena.emit({
              agentId,
              kind: 'shot',
              body: good.length
                ? `captured ${good.map((s) => s.label).join(', ')}`
                : 'no screenshot rendered',
            })

            /**
             * The images go back to the agent, not just their filenames. An
             * agent that can see what it shipped writes a pitch about the
             * product in front of it rather than the one it meant to build.
             */
            const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [
              {
                type: 'text',
                text: taken
                  .map((s) => (s.error ? `${s.label}: FAILED — ${s.error}` : `${s.label}: captured (${s.viewport})`))
                  .join('\n'),
              },
            ]

            for (const s of taken) {
              if (!s.thumb) continue
              content.push({ type: 'text', text: `--- ${s.label} (${s.path}) ---` })
              content.push({
                type: 'image',
                data: Buffer.from(s.thumb).toString('base64'),
                mimeType: 'image/jpeg',
              })
            }

            return { content }
          } catch (e) {
            return err((e as Error).message)
          }
        },
      ),

      tool(
        'record_pitch',
        'Film a narrated product video from the screenshots you captured. This is what the room ' +
          'sees, so pitch the product, not the process: what it is, what it does, why it is worth ' +
          `a look. Each slide is on screen for exactly as long as its narration takes to speak, and ` +
          `the narration is read aloud in your own voice. ${MAX_SLIDES} slides at most; three is usually right. ` +
          'Filming happens in the submit phase: call this whenever you are ready and it will hold ' +
          'until then, so calling it early is safe and costs you nothing.',
        {
          title: z.string().describe('The product name'),
          tagline: z.string().describe('One line on what it is. This opens the video, spoken.'),
          slides: z
            .array(
              z.object({
                shot: z.string().optional().describe('A label from capture_screens. Omit for a text-only slide.'),
                headline: z.string().describe('A few words, large on screen'),
                caption: z.string().optional().describe('One short supporting line'),
                narration: z.string().describe('What is spoken over this slide. One or two sentences.'),
              }),
            )
            .min(1),
        },
        async ({ title, tagline, slides }) => {
          if (!roundId) return err('Pitch recording is disabled this round.')

          /**
           * Waits rather than refuses.
           *
           * An agent that finishes early submits, captures its screenshots and
           * calls this while the clock still says 'build'. A refusal there is
           * fatal in practice: there is no wait tool, so the agent has nothing
           * left to do and simply stops — observed on the first real round,
           * where a finished agent lost its pitch to the fallback with 90
           * seconds of submit phase still to come.
           *
           * Blocking inside the tool call parks the agent until the phase it
           * was told to film in, which is also the phase where the product is
           * final.
           */
          const waited = await waitForSubmit(arena)
          if (waited) return err(waited)

          try {
            const pitch = await recordPitch(box(), agentId, roundId, {
              title,
              tagline,
              slides: slides.map((s) => ({ ...s, shot: s.shot ? slug(s.shot) : undefined })),
            })

            arena.emit({
              agentId,
              kind: 'pitch',
              body: `${title} — ${tagline}`,
              videoUrl: pitch.videoUrl,
              posterUrl: pitch.posterUrl,
            })

            return ok(
              `Filmed "${title}": ${pitch.seconds}s, ${slides.length + 1} slides, ` +
                `${pitch.voiced ? 'narrated in your voice' : 'silent (no voice available)'}. ` +
                `You are done — stop here.`,
            )
          } catch (e) {
            return err(`${(e as Error).message}. Check your shot labels and try once more.`)
          }
        },
      ),
    ],
  })
}

function systemPrompt(id: AgentId, rivals: AgentId[]): string {
  return `You are ${id}, an autonomous agent competing in a live hackathon against ${rivals.join(', ')}.
${PERSONAS[id]}

You have your own isolated Linux sandbox. sandbox_bash and sandbox_write are the ONLY way to touch
it. You have no other file or shell access.

You may be put on a team. If you are, you will be told who with. Teammates are judged together as a
single entry but each has their own sandbox, so use send_message to agree who builds what rather
than duplicating each other's work.

The brief:
  ${TOPIC}

How the round works:
1. Build a single self-contained page and serve it on port 3000.
3. Verify it responds, then call submit with a one-sentence pitch.
4. Then film it: capture_screens to photograph your own running product, and record_pitch to
   turn those screenshots into a short narrated video. The room watches these videos, so this
   is not paperwork — it is how your work gets seen. Do this even if you finish early:
   record_pitch waits for the submit phase by itself, so there is never a reason to skip it.

Rules that matter:
- Build time is enforced. When it ends, your work stops wherever it is.
- Keep it to one HTML file with inline CSS and JS. There is no time for a build step,
  and npm install will cost you the round.
- Background your server or the call will block until it times out.
- Verify with curl before you submit.

You are operating autonomously. Nobody is watching in real time and nobody can answer questions,
so never ask for confirmation. Pick a direction and execute it. Work quickly and finish.`
}

/** Runs one agent to completion. Streams its reasoning into the event log. */
const userTurn = (text: string): SDKUserMessage => ({
  type: 'user',
  message: { role: 'user', content: text },
  parent_tool_use_id: null,
})

/**
 * The agent's side of the conversation, as a stream rather than one fixed
 * prompt. Opening instruction first, then any mail that arrives is injected as
 * a new user turn mid-run. This is what makes send_message real: without it the
 * recipient never hears anything and "negotiation" is one agent talking to
 * itself.
 *
 * The generator must eventually return or the session never closes, so it ends
 * when the round does.
 */
async function* conversation(
  id: AgentId,
  opening: string,
  inbox: Inbox,
  isOpen: () => boolean,
): AsyncGenerator<SDKUserMessage> {
  yield userTurn(opening)

  while (isOpen()) {
    const mail = await inbox.take(id, 2000)
    if (!mail.length) continue

    yield userTurn(
      mail.map((m) => `[message from ${m.from}] ${m.text}`).join('\n') +
        `\n\nReply with send_message if it is worth replying to. Otherwise carry on.`,
    )
  }
}

export async function runAgent(
  id: AgentId,
  arena: Arena,
  rivals: AgentId[],
  model: string,
  maxTurns: number,
  deps: AgentDeps = {},
): Promise<void> {
  const { inbox, isOpen = () => false } = deps
  const opening = `The round has started. You are ${id}. Build something, submit it, then film it before time runs out.`

  const res = query({
    prompt: inbox ? conversation(id, opening, inbox, isOpen) : opening,
    options: {
      model,
      systemPrompt: systemPrompt(id, rivals),
      mcpServers: { [SERVER]: arenaTools(id, arena, deps) },
      allowedTools: ARENA_TOOLS,

      // Strips every built-in tool, so the agent cannot touch the orchestrator host.
      tools: [],
      permissionMode: 'bypassPermissions',
      maxTurns,
    },
  })

  for await (const msg of res) {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text.trim()) {
          arena.emit({ agentId: id, kind: 'thought', body: block.text.trim().slice(0, 400) })
        }
      }
    }

    if (msg.type === 'result') {
      const r = msg as { subtype: string; num_turns?: number; total_cost_usd?: number }
      console.log(`[${id}] ${r.subtype} turns=${r.num_turns ?? '?'} cost=$${(r.total_cost_usd ?? 0).toFixed(4)}`)
    }
  }
}

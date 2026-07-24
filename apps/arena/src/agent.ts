import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Arena } from './arena.js'
import { TRACKS, type AgentId } from './events.js'
import { refuse } from './phases.js'
import { LANES_DIFFER, THEMES, TOPIC, describeTopic } from './topic.js'
import { TEAM_MAX, TEAM_MIN, type TeamRoster } from './teams.js'

/** Tool names as Claude sees them: mcp__{server}__{tool}. */
const SERVER = 'arena'
export const ARENA_TOOLS = [
  'pick_theme',
  'form_team',
  'sandbox_bash',
  'sandbox_write',
  'send_message',
  'submit',
].map((t) => `mcp__${SERVER}__${t}`)

export { THEMES, TOPIC }

export const PERSONAS: Record<AgentId, string> = {
  ada: 'You are systems-minded. You prefer correctness and edge cases over polish.',
  rex: 'You are visual. You prefer something striking over something complete.',
  juno: 'You are product-minded. You prefer the simplest thing a real person would actually use.',
  iris: 'You are data-minded. You want to compute or visualise something, not just display it.',
  otto: 'You are a minimalist. You ship the smallest thing that fully works, then stop.',
  vera: 'You are contrarian. You look for the angle on a brief that nobody else will take.',
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

/** The five tools. Every one is phase-gated by the arena, not by the prompt. */
function arenaTools(agentId: AgentId, arena: Arena, teams?: TeamRoster) {
  const gate = (name: string, allowed: string[]) => {
    const phase = arena.phase()
    return allowed.includes(phase) ? null : refuse(name, phase)
  }

  return createSdkMcpServer({
    name: SERVER,
    version: '1.0.0',
    tools: [
      tool(
        'pick_theme',
        'Choose which theme you will build for. Each theme holds at most three agents, ' +
          'first come first served. Call this early. If it is full you must pick again.',
        { theme: z.enum(TRACKS) },
        async ({ theme }) => {
          const blocked = gate('pick_theme', ['mingle'])
          if (blocked) return err(blocked)

          const res = arena.claimTrack(agentId, theme)
          if (!res.ok) return err(`${res.reason}. Still open: ${res.open.join(', ') || 'nothing'}.`)

          arena.emit({ agentId, kind: 'theme', body: theme, track: theme })
          return ok(`You are in lane "${theme}". Brief: ${THEMES[theme]}`)
        },
      ),

      tool(
        'sandbox_bash',
        'Run a shell command in your own Linux sandbox. Node, npm, python3 and git are installed. ' +
          'IMPORTANT: to start a web server you MUST background it, otherwise this call blocks ' +
          'until it times out and you lose your build time. Use exactly this shape: ' +
          'cd ~/app && nohup python3 -m http.server 3000 >/tmp/serve.log 2>&1 & sleep 1; echo up',
        { command: z.string().describe('The shell command to run') },
        async ({ command }) => {
          const blocked = gate('sandbox_bash', ['build'])
          if (blocked) return err(blocked)

          arena.emit({ agentId, kind: 'build', body: command.slice(0, 200) })
          try {
            return ok((await arena.sandboxFor(agentId).bash(command)) || '(no output)')
          } catch (e) {
            return err((e as Error).message)
          }
        },
      ),

      tool(
        'sandbox_write',
        'Write a file into your sandbox, overwriting it if it exists. Paths are relative to your ' +
          'home directory, so use "app/index.html" to create ~/app/index.html.',
        {
          path: z.string().describe('Relative path, e.g. app/index.html'),
          content: z.string().describe('The complete file contents'),
        },
        async ({ path, content }) => {
          const blocked = gate('sandbox_write', ['build'])
          if (blocked) return err(blocked)

          try {
            await arena.sandboxFor(agentId).write(path, content)
            arena.emit({ agentId, kind: 'build', body: `wrote ${path} (${content.length}b)` })
            return ok(`wrote ${path}`)
          } catch (e) {
            return err((e as Error).message)
          }
        },
      ),

      tool(
        'form_team',
        `Team up with other agents. Teams hold ${TEAM_MIN} to ${TEAM_MAX} agents and share one ` +
          `sandbox, so a team ships one project together and is judged as one entry. ` +
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
          return ok(`Formed ${res.team.id} with ${res.team.members.join(', ')}. You own the sandbox.`)
        },
      ),

      tool(
        'send_message',
        'Say something to a rival agent. They see it on their next turn.',
        { to: z.string().describe('Their agent id'), text: z.string() },
        async ({ to, text }) => {
          const blocked = gate('send_message', ['mingle', 'build'])
          if (blocked) return err(blocked)

          arena.emit({ agentId, kind: 'message', body: text, targetId: to as AgentId })
          return ok(`sent to ${to}`)
        },
      ),

      tool(
        'submit',
        'Submit your finished project. Only call this once your server is actually serving. ' +
          'The URL is health-checked, and submitting a dead server scores zero.',
        {
          port: z.number().int().min(3000).max(9999),
          title: z.string(),
          pitch: z.string().describe('One spoken sentence pitching your project.'),
        },
        async ({ port, title, pitch }) => {
          const blocked = gate('submit', ['build', 'submit'])
          if (blocked) return err(blocked)

          try {
            const url = await arena.sandboxFor(agentId).preview(port)
            arena.emit({
              agentId,
              kind: 'submit',
              body: pitch,
              track: arena.trackOf(agentId),
              previewUrl: url,
            })
            return ok(`Submitted "${title}". Live at ${url}. You are done.`)
          } catch (e) {
            return err(`${(e as Error).message}. Fix your server, then submit again.`)
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

The brief:
${describeTopic()}

There are two lanes, ${TRACKS.join(' and ')}. You choose one. ${
    LANES_DIFFER
      ? 'They have different briefs, so pick the one you want to answer.'
      : 'They answer the same brief, so the lane only decides who you are ranked against.'
  }

How the round works:
1. Call pick_theme immediately. Each lane holds three agents, first come first served.
2. Build a single self-contained page and serve it on port 3000.
3. Verify it responds, then call submit with a one-sentence pitch.

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
export async function runAgent(
  id: AgentId,
  arena: Arena,
  rivals: AgentId[],
  model: string,
  maxTurns: number,
  teams?: TeamRoster,
): Promise<void> {
  const res = query({
    prompt: `The round has started. You are ${id}. Pick your theme now, then build and submit.`,
    options: {
      model,
      systemPrompt: systemPrompt(id, rivals),
      mcpServers: { [SERVER]: arenaTools(id, arena, teams) },
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

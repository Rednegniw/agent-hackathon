import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where rendered pitch media lands, and the URL the office fetches it from.
 *
 * Resolved against this file, never cwd. `pnpm --filter arena` runs with the
 * cwd set to the package, but `pnpm dev` from the repo root does not, and a
 * cwd-relative media root silently splits one round's video across two
 * directories — the server then serves 404s for files that exist.
 */
const HERE = dirname(fileURLToPath(import.meta.url))

export const PUBLIC_DIR = join(HERE, '..', 'public')
export const MEDIA_DIR = join(PUBLIC_DIR, 'media')

/** Filenames come from agent ids and round ids, but never trust that. */
const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '-')

/**
 * Writes one media file and returns its public path.
 *
 * The path is relative on purpose. The arena does not know which host the
 * office reaches it on, so it emits `/media/...` and the office prefixes its
 * own ARENA_URL — the same file then resolves from a laptop, a phone on the
 * LAN, or a replay.
 */
export function saveMedia(roundId: string, name: string, bytes: Uint8Array): string {
  const dir = join(MEDIA_DIR, safe(roundId))
  mkdirSync(dir, { recursive: true })

  const file = safe(name)
  writeFileSync(join(dir, file), bytes)
  return `/media/${safe(roundId)}/${file}`
}

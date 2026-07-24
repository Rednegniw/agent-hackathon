import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

/**
 * Secrets live in a single .env at the repo root, shared by every workspace
 * package. Resolve it from this file rather than the cwd, because pnpm runs
 * package scripts with the cwd set to the package, not the root.
 *
 * Import this before anything that reads process.env.
 */
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

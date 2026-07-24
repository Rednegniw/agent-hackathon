/**
 * Level-1 smoke test. No agents, no tokens.
 * Validates the whole Daytona path: create, write, serve, preview, fetch, delete.
 * Also inspects the preview response headers, because if the proxy forbids
 * framing then the office cannot iframe submissions and the design changes.
 */
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Daytona } from '@daytonaio/sdk'

// Secrets live in the repo-root .env, shared by every workspace package.
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

const PORT = 3000
const log = (...a) => console.log(...a)

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })

let sandbox
try {
  log('1. creating sandbox...')
  const t0 = Date.now()
  sandbox = await daytona.create({ labels: { purpose: 'smoke' }, ephemeral: true })
  log(`   ok id=${sandbox.id} in ${Date.now() - t0}ms`)

  log('2. writing index.html via fs.uploadFile(Buffer)...')
  const html = '<!doctype html><h1>arena smoke</h1><p>' + 'x'.repeat(600) + '</p>'
  await sandbox.fs.uploadFile(Buffer.from(html), 'app/index.html')
  log('   ok')

  log('3. starting a static server...')
  const boot = await sandbox.process.executeCommand(
    `cd ~/app && nohup python3 -m http.server ${PORT} >/tmp/serve.log 2>&1 & sleep 2; echo started`,
  )
  log(`   exitCode=${boot.exitCode} result=${JSON.stringify(boot.result?.trim())}`)

  log('4. resolving preview URLs...')
  const plain = await sandbox.getPreviewLink(PORT)
  const signed = await sandbox.getSignedPreviewUrl(PORT, 3600)
  log(`   getPreviewLink   -> url=${plain.url} tokenLen=${plain.token?.length}`)
  log(`   getSignedPreviewUrl -> url=${signed.url.slice(0, 80)}... tokenLen=${signed.token?.length}`)

  log('5. fetching the SIGNED url with no headers (the iframe case)...')
  const res = await fetch(signed.url, { redirect: 'follow' })
  const body = await res.text()
  log(`   status=${res.status} bytes=${body.length}`)
  log('   --- framing-relevant headers ---')
  for (const h of ['x-frame-options', 'content-security-policy', 'content-type']) {
    log(`   ${h}: ${res.headers.get(h) ?? '(absent)'}`)
  }
  const csp = res.headers.get('content-security-policy') ?? ''
  const xfo = res.headers.get('x-frame-options') ?? ''
  const framable = !xfo && !/frame-ancestors/i.test(csp)
  log(`   IFRAMEABLE: ${framable ? 'YES' : 'NO - design change needed'}`)

  log('6. fetching the PLAIN url with no headers (expect auth failure)...')
  const res2 = await fetch(plain.url, { redirect: 'follow' })
  log(`   status=${res2.status} (confirms why we need the signed variant)`)
} catch (err) {
  console.error('FAILED:', err?.message ?? err)
  if (err?.response?.data) console.error('detail:', JSON.stringify(err.response.data))
  process.exitCode = 1
} finally {
  if (sandbox) {
    log('7. deleting sandbox...')
    await sandbox.delete().catch((e) => console.error('   delete failed:', e?.message))
    log('   ok')
  }
}

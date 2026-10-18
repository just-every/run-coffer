#!/usr/bin/env node
// A hosted transfer uses Coffer's owner-only portability API, never the local DB.
import { readFile, lstat, mkdir, open, link, unlink } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { resolve, dirname } from 'node:path'
import { readArchive, canonicalJson, sha256 } from '@runeditrun/rer/modules/portability'
import { cookieFile, absent } from '@runeditrun/rer/modules/portability/cli-options'
import { HostedTransferError, restoreTransport } from './hosted-transfer.mjs'
import { transferClient, transferDiagnostic } from '@runeditrun/rer/internal/modules/portability/http-client.mjs'

const usage = `Usage:
  rer run backup:hosted -- --environment production --session-file owner-session.txt [--output exports/coffer.rer]
  rer run backup:hosted -- --environment restored --session-file owner-session.txt --restore exports/coffer.rer --yes
Optional: --origin https://YOUR-COFFER (instead of a saved deployment), --resume JOB_ID.
Sign in as owner first; the private session file holds one NAME=VALUE cookie. See docs/backup.md.`
class InputError extends Error {}

async function privateInput(path) {
 const info = await lstat(path)
 if (!info.isFile() || (info.mode & 0o077)) throw new InputError(`Make ${path} a private regular file (chmod 600).`)
}
function options(argv) {
 const out = { environment: 'production' }
 const names = { '--environment': 'environment', '--origin': 'origin', '--session-file': 'session', '--output': 'output', '--restore': 'restore', '--resume': 'resume' }
 for (let i = 0; i < argv.length; i++) {
  const flag = argv[i]
  if (flag === '--') continue
  if (flag === '--help' || flag === '-h') { console.log(usage); return }
  if (flag === '--yes') { out.yes = true; continue }
  const key = names[flag], value = argv[++i]
  if (!key || !value || value.startsWith('--') || (key !== 'environment' && out[key])) throw new InputError(usage)
  out[key] = value
 }
 if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(out.environment) || !out.session || (out.restore && out.output)) throw new InputError(usage)
 if (out.restore && !out.yes) throw new InputError('Restore goes into an empty hosted Coffer. Add --yes to confirm.')
 return out
}
const records = path => readArchive(Readable.toWeb(createReadStream(path)))

async function main() {
 const o = options(process.argv.slice(2)); if (!o) return
 const root = new URL('../', import.meta.url)
 const origin = o.origin ?? JSON.parse(await readFile(new URL(`.rer/deploy/${o.environment}.json`, root), 'utf8')).receipt?.origin
 let url; try { url = new URL(origin) } catch { throw new InputError('No completed hosted deployment. Deploy first, or supply --origin https://YOUR-COFFER.') }
 if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new InputError('Use a hosted HTTPS origin without a path or credentials.')
 await privateInput(o.session)
 const cookie = await cookieFile(resolve(o.session))
 const client = transferClient({ endpoint: url.origin + '/api/portability', origin: url.origin, cookie }), { get } = client
 if (o.restore) {
  const input = resolve(o.restore); await privateInput(input)
  // Verify the complete archive before opening a remote staging job.
  for await (const ignored of records(input)) { /* checksums and closing record */ }
  const remote = restoreTransport({ origin: url.origin, cookie })
  let id = o.resume, closing, received = new Set()
  for await (const record of records(input)) {
   if (record.kind === 'manifest') {
    id = client.jobId(id ?? (await remote.get('imports', 'POST', { confirmed: true, manifest: record })).id, 'imports')
    if (o.resume) {
     const state = await remote.get(`imports/${id}`)
     if (state.manifestHash !== await sha256(canonicalJson(record))) throw new InputError('This job belongs to a different archive. Use its original backup or start a new restore.')
     if (!Array.isArray(state.received) || state.received.some(index => !Number.isSafeInteger(index) || index < 0 || index >= record.partCount)) throw new InputError('The server did not return a valid list of saved parts.')
     received = new Set(state.received)
     console.log(`Resuming with ${received.size} of ${record.partCount} parts already saved; uploading only missing parts.`)
    }
    console.log(`Restoring to ${url.origin}; job ${id}. Resume with --resume ${id}.`)
   } else if (record.kind === 'part') {
    if (received.has(record.index)) continue
    await remote.upload(id, record)
    if ((record.index + 1) % 25 === 0) console.log(`Uploaded ${record.index + 1} parts.`)
   } else closing = record
  }
  const state = await remote.get(`imports/${id}/finalize`, 'POST', { contentHash: closing.contentHash, archiveHash: closing.archiveHash })
  if (state.phase !== 'complete') throw client.failedJob(`imports/${id}/finalize`, state)
  console.log(`Restored ${state.completed} parts into ${url.origin}. Sign in by email; private configuration stays with the destination.`)
 } else {
  const output = resolve(o.output ?? `exports/coffer-${o.environment}-${new Date().toISOString().replace(/[:.]/g, '-')}.rer`)
  await absent(output)
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  const file = await open(output + '.partial', 'wx', 0o600)
  try {
   const id = client.jobId(o.resume ?? (await get('exports', 'POST', {})).id, 'exports')
   console.log(`Backing up ${url.origin}; job ${id}. Resume with --resume ${id} and a new --output.`)
   let state = await get(`exports/${id}`)
   while (state.phase === 'building') state = await get(`exports/${id}/advance`, 'POST', { expectedPart: state.completed, maxParts: 8 })
   if (state.phase !== 'complete') throw client.failedJob(`exports/${id}`, state)
   for await (const record of await client.download(id)) await file.writeFile(canonicalJson(record) + '\n')
   await file.sync()
   // link refuses to overwrite an existing backup, including a symlink.
   await link(output + '.partial', output)
   console.log(`Backed up ${state.completed} verified parts to ${output} (mode 600). Keep it private.`)
  } finally { await file.close(); await unlink(output + '.partial') }
 }
}
main().catch(error => {
 console.error(transferDiagnostic(error) ?? (error instanceof InputError || error instanceof HostedTransferError ? error.message : 'Backup or restore failed. Check the paths, permissions and deployment; see docs/backup.md.'))
 process.exitCode = 1
})

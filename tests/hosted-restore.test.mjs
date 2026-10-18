import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installation, donor, stripe } from './harness.mjs'

// TLS is the network edge; requests run through the actual Coffer Worker and D1.
async function serve(h, tls) {
 const server = createServer(tls, async (req, res) => {
  try {
   const chunks = []; for await (const chunk of req) chunks.push(chunk)
   const response = await h.mf.dispatchFetch(h.origin + req.url, {
    method: req.method, redirect: 'manual',
    headers: { ...req.headers, host: new URL(h.origin).host, origin: h.origin },
    ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
   })
   res.writeHead(response.status, Object.fromEntries(response.headers))
   if (response.body) for await (const chunk of response.body) res.write(chunk)
   res.end()
  } catch { res.writeHead(500); res.end() }
 })
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
 return { origin: `https://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
}
async function command(args, cert) {
 const child = spawn(process.execPath, ['scripts/backup-hosted.mjs', ...args], {
  env: { ...process.env, NODE_EXTRA_CA_CERTS: cert }, stdio: ['ignore', 'pipe', 'pipe'],
 })
 let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d)
 const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
 return { status, output }
}

test('hosted command restores records and large retained originals, preserves destination owner and refuses overwrite', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'coffer-hosted-')), cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem')
 const source = await installation(); let fresh, a, b
 try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
  const tls = { cert: await readFile(cert), key: await readFile(key) }
  const d = await donor(source, 'Jordan Rivera')
  await source.command('gift.record', { donorId: d.id, amount: '125.67', receivedOn: '2026-10-01', method: 'check', goods: 'none' })
  const fixtures = await stripe(), template = fixtures.charges.flatMap(p => p.data).find(c => c.paid && c.status === 'succeeded')
  const customers = Array.from({ length: 150 }, (_, i) => ({ ...fixtures.customers[0].data[0], id: `cus_Archive${i}`, name: `Archive donor ${i}`, email: `archive${i}@example.org`, metadata: { retained: 'é'.repeat(4000) } }))
  const input = { customers: [{ object: 'list', data: customers, has_more: false }], charges: [{ object: 'list', data: customers.map((c, i) => ({ ...template, id: `ch_Archive${i}`, customer: c.id, amount_refunded: 0 })), has_more: false }], noGoodsOrServices: true }
  const preview = await source.api('/api/coffer/imports/preview', input)
  let job = await source.api('/api/coffer/imports/apply', { ...input, fingerprint: preview.fingerprint })
  while (job.state !== 'completed') job = await source.api('/api/coffer/imports/resume', { id: job.id })
  a = await serve(source, tls)
  const session = join(directory, 'session.txt'), archive = join(directory, 'backup.rer')
  await writeFile(session, source.owner, { mode: 0o600 })
  const backup = await command(['--origin', a.origin, '--session-file', session, '--output', archive], cert)
  assert.equal(backup.status, 0, backup.output)
  assert.equal((await stat(archive)).mode & 0o077, 0)
  const saved = await readFile(archive)
  assert.ok(!saved.includes(Buffer.from(source.owner)))
  const repeat = await command(['--origin', a.origin, '--session-file', session, '--output', archive], cert)
  assert.notEqual(repeat.status, 0); assert.deepEqual(await readFile(archive), saved)
  fresh = await installation(); b = await serve(fresh, tls)
  await writeFile(session, fresh.owner)
  const restore = await command(['--origin', b.origin, '--session-file', session, '--restore', archive, '--yes'], cert)
  assert.equal(restore.status, 0, restore.output)
  assert.deepEqual(await fresh.get('/api/coffer/donors'), await source.get('/api/coffer/donors'))
  assert.deepEqual((await fresh.get('/api/coffer/imports/journal?id=' + job.id)).originals, (await source.get('/api/coffer/imports/journal?id=' + job.id)).originals)
  assert.equal((await fresh.get('/auth/session')).operator.role, 'owner')
  const occupied = await command(['--origin', b.origin, '--session-file', session, '--restore', archive, '--yes'], cert)
  assert.notEqual(occupied.status, 0)
  assert.deepEqual(await fresh.get('/api/coffer/donors'), await source.get('/api/coffer/donors'))
 } finally {
  await a?.close(); await b?.close(); await source.close(); await fresh?.close(); await rm(directory, { recursive: true, force: true })
 }
})

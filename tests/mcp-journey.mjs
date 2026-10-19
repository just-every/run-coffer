import assert from 'node:assert/strict'
import { run, donor, reviewed } from './harness.mjs'

const path = '/api/coffer/mcp', current = '2026-07-28', legacy = '2025-11-25'
// A real JSON-RPC client over the public Worker door, with no application fake.
function client(h, key, version = current) {
 let sequence = 0
 const envelope = (method, params = {}, id = ++sequence) => ({ jsonrpc: '2.0', id, method, params: version === current ? { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientInfo': { name: 'coffer-journey', version: '1.0.0' }, 'io.modelcontextprotocol/clientCapabilities': {} } } : params })
 const headers = message => ({ authorization: `Bearer ${key.token}`, accept: 'application/json, text/event-stream', 'mcp-protocol-version': version, ...(version === current ? { 'mcp-method': message.method, ...(message.method === 'tools/call' ? { 'mcp-name': message.params.name } : {}) } : {}) })
 const send = async (message, options = {}) => h.request(path, { method: 'POST', as: '', body: message, ...options, headers: { ...headers(message), ...options.headers } })
 const rpc = async (method, params, options = {}) => {
  const message = envelope(method, params), response = await send(message, options)
  assert.equal(response.status, options.status ?? 200)
  assert.match(response.headers.get('content-type'), /^application\/json/)
  const answer = await response.json()
  assert.equal(answer.jsonrpc, '2.0'); assert.equal(answer.id, message.id)
  return answer
 }
 const call = async (name, args = {}) => {
  const answer = await rpc('tools/call', { name, arguments: args })
  assert.equal(answer.error, undefined); assert.equal(answer.result.isError, false)
  assert.deepEqual(JSON.parse(answer.result.content[0].text), answer.result.structuredContent)
  return answer.result.structuredContent
 }
 return { envelope, headers, send, rpc, call }
}

export async function mcpJourney() {
 await run(async h => {
  const ana = await donor(h, 'Ana MCP'), gift = await h.command('gift.record', { donorId: ana.id, amount: '250', receivedOn: '2026-09-20', method: 'check', goods: 'none' })
  const key = await h.command('agent.create', { label: 'Nonprofit MCP assistant' }), mcp = client(h, key)
  const discovery = (await mcp.rpc('server/discover')).result
  assert.ok(discovery.supportedVersions.includes(current)); assert.ok(discovery.supportedVersions.includes(legacy)); assert.ok(discovery.capabilities.tools)
  const catalog = (await mcp.rpc('tools/list')).result.tools
  for (const name of ['donors.list', 'donors.context', 'ack.prepare', 'appeal.prepare']) assert.ok(catalog.some(tool => tool.name === name && tool.inputSchema.type === 'object'))
  assert.ok(!catalog.some(tool => /approve|send|export/.test(tool.name)))
  const found = await mcp.call('donors.list', { q: 'Ana MCP' })
  assert.deepEqual(found.donors.map(d => d.id), [ana.id])
  const context = await mcp.call('donors.context', { donorId: ana.id })
  assert.ok(context.gifts.some(g => g.id === gift.id))
  const unreviewed = await mcp.rpc('tools/call', { name: 'ack.prepare', arguments: { giftIds: [gift.id] } })
  assert.equal(unreviewed.result.isError, true)
  assert.equal(JSON.parse(unreviewed.result.content[0].text).error, 'SETTINGS_UNREVIEWED')
  await reviewed(h)
  const batch = await mcp.call('ack.prepare', { giftIds: [gift.id] })
  assert.equal(batch.letters, 1)
  assert.equal((await h.get(`/api/coffer/letters/${batch.id}`)).batch.status, 'prepared')
  const denied = await mcp.rpc('tools/call', { name: 'ack.approve', arguments: { batchId: batch.id, version: batch.version } }, { status: 400 })
  assert.equal(denied.error.code, -32602)
  await h.command('ack.approve', { batchId: batch.id, version: batch.version }, { as: '', headers: { authorization: `Bearer ${key.token}` }, status: 403 })
  if(process.env.COFFER_MCP_BROWSER){const {mcpBrowser}=await import('./mcp-browser.mjs');await mcpBrowser(h,batch,process.env.COFFER_MCP_BROWSER)}
  else await h.command('ack.approve', { batchId: batch.id, version: batch.version })
  const approved = await h.get(`/api/coffer/letters/${batch.id}`)
  assert.equal(approved.batch.status, 'approved'); assert.equal(approved.approval.prepared_by_role, 'agent'); assert.equal(approved.approval.approved_by_role, 'owner'); assert.equal(approved.approval.content_hash, batch.contentHash)
  await h.command('consent.record', { donorIds: [ana.id], channel: 'email', status: 'granted', method: 'paper form', evidence: 'Signed donor permission for appeals.', capturedOn: '2026-09-20' })
  const appeal = await mcp.call('appeal.prepare', { name: 'MCP appeal proposal', channel: 'email', subject: 'Help the reading room', body: 'Dear {{donor_name}}, thank you for supporting our reading room.' })
  assert.equal(appeal.recipients, 1)
  assert.equal((await h.get(`/api/coffer/appeals/${appeal.id}`)).appeal.status, 'prepared')
  const before = (await h.get('/api/coffer/donors')).total
  assert.equal((await mcp.rpc('tools/call', { name: 'donor.create', arguments: { name: 'Outside grant' } }, { status: 400 })).error.code, -32602)
  assert.equal((await h.get('/api/coffer/donors')).total, before)
  assert.equal((await mcp.rpc('tools/call', { name: 'ack.prepare', arguments: { command: 'ack.approve' } }, { status: 400 })).error.code, -32602)
  assert.equal((await mcp.rpc('unknown/method', {}, { status: 404 })).error.code, -32601)
  assert.equal((await mcp.rpc('ping', {}, { status: 404 })).error.code, -32601)
  assert.equal((await mcp.rpc('tools/call', { name: 'donors.context', arguments: { donorId: 9 } }, { status: 400 })).error.code, -32602)
  assert.equal((await mcp.rpc('tools/call', { name: 'ack.prepare', arguments: null }, { status: 400 })).error.code, -32602)
  const invalid = mcp.envelope('tools/list')
  for (const raw of ['{', '[]', '{"jsonrpc":"2.0","id":null,"method":"tools/list"}', '{"jsonrpc":"2.0","id":1,"result":{}}']) {
   const response = await mcp.send(invalid, { raw }); assert.equal(response.status, 400); assert.ok((await response.json()).error)
  }
  const mismatch = await mcp.send(invalid, { headers: { 'mcp-method': 'tools/call' } })
  assert.equal(mismatch.status, 400); assert.equal((await mismatch.json()).error.code, -32020)
  const unsupported = await mcp.send(invalid, { body: { ...invalid, params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } } }, headers: { 'mcp-protocol-version': '1900-01-01' } })
  assert.equal(unsupported.status, 400); assert.ok((await unsupported.json()).error.data.supported.includes(current))
  const missingMeta = await mcp.send(invalid, { body: { ...invalid, params: { _meta: { 'io.modelcontextprotocol/protocolVersion': current } } } })
  assert.equal(missingMeta.status, 400); assert.equal((await missingMeta.json()).error.code, -32602)
  assert.equal((await mcp.send(invalid, { headers: { accept: 'text/html' } })).status, 406)
  assert.equal((await mcp.send(invalid, { headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await mcp.send(invalid, { raw: ' '.repeat(1024 * 1024 + 1) })).status, 413)
  assert.equal((await mcp.send(invalid, { headers: { origin: 'https://elsewhere.test' } })).status, 403)
  assert.equal((await h.request(path, { method: 'POST', as: '', body: invalid })).status, 401)
  assert.equal((await h.request(path, { method: 'POST', body: invalid, headers: { accept: 'application/json, text/event-stream' } })).status, 403)
  for (const method of ['GET', 'DELETE', 'PUT']) {
   const response = await h.request(path, { method, as: '', headers: { authorization: `Bearer ${key.token}` } })
   assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'POST')
  }
  // Legacy clients can handshake without a session, then use the explicit version.
  const old = client(h, key, legacy)
  const initialization = await old.rpc('initialize', { protocolVersion: legacy, capabilities: {}, clientInfo: { name: 'legacy-journey', version: '1.0.0' } })
  assert.equal(initialization.result.protocolVersion, legacy)
  const notification = { jsonrpc: '2.0', method: 'notifications/initialized' }
  const accepted = await old.send(notification)
  assert.equal(accepted.status, 202); assert.equal(await accepted.text(), '')
  assert.deepEqual((await old.rpc('ping')).result, {})
  assert.ok((await old.call('donors.list', { q: 'Ana MCP' })).donors.some(d => d.id === ana.id))
  const callWithoutId = mcp.envelope('tools/call', { name: 'ack.prepare' }); delete callWithoutId.id
  assert.equal((await mcp.send(callWithoutId)).status, 400)
  // Exercise expiry through the test clock at the network edge, not a DB edit.
  const expires = new Date(key.expiresAt + 1).toISOString()
  assert.equal((await mcp.send(invalid, { headers: { 'x-test-now': expires } })).status, 401)
  await h.command('agent.revoke', { id: key.id })
  assert.equal((await mcp.send(invalid)).status, 401)
 }, { entry: 'tests/advancing-clock-worker.ts' })
}

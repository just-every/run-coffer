import assert from 'node:assert/strict'
import { run, donor, archive, restore, installation } from './harness.mjs'

export async function researchJourney() {
 const calls = [], key = 'test-wealthengine-edge-only'
 let providerFailure = false, invalidResult = false
 const outbound = async request => {
  const url = new URL(request.url), body = await request.json()
  assert.equal(url.origin, 'https://api.wealthengine.com')
  assert.equal(request.method, 'POST')
  assert.equal(request.headers.get('authorization'), 'APIkey ' + key)
  calls.push({ path: url.pathname, body })
  if (url.pathname === '/v1/session/create') return Response.json({ _id: 'temporary-provider-session' }, { status: 201 })
  assert.equal(url.pathname, '/v1/profile/summary/basic')
  // The paid edge receives only the documented identification fields.
  assert.deepEqual(Object.keys(body).sort(), ['address_line1', 'city', 'client_id', 'first_name', 'last_name', 'state', 'zip'])
  if (providerFailure) return Response.json({ message: 'Private upstream body ' + key }, { status: 503 })
  if (body.first_name === 'No') return Response.json({ status: 'NO_MATCH', message: 'No Result Found' }, { status: 555 })
  return Response.json({
   id: body.first_name === 'Ada' ? 12345 : 67890, client_id: invalidResult ? 'wrong-donor' : body.client_id,
   identity: { first_name: body.first_name, last_name: body.last_name }, locations: [{ address: { city: 'Springfield' } }],
   wealth: { wealth_score: { text: 'Excellent', value: 92 }, networth: { text: '$5MM-$10MM' } },
   giving: { gift_capacity: { text: '$100K-$200K', text_low: '$100K', text_high: '$200K', value: 15, min: 1, max: 20 },
    p2g_score: { text: '1|2 - Excellent', value: '12' }, estimated_annual_donations: { text: '$10K-$25K' } },
   demographics: { private_field: 'must not be stored' },
  })
 }
 await run(async h => {
  const ada = await donor(h, 'Ada Rivera'), ben = await donor(h, 'Ben Wells'), missing = await donor(h, 'No Match')
  const member = await h.person('research-entry@example.test'), admin = await h.person('research-admin@example.test', 'admin')
  const connect = { provider: 'wealthengine', apiKey: key }, input = { donorIds: [ada.id, ben.id] }
  const state = (options = {}) => h.get('/api/coffer/research', options)
  await h.command('research.connect', connect, { as: '', status: 401 })
  await h.command('research.connect', connect, { as: member.cookie, status: 403 })
  await state({ as: member.cookie, status: 403 })
  await state({ as: '', status: 401 })
  await h.command('research.screen', input, { status: 409 })
  await h.command('research.connect', connect, { as: admin.cookie })
  assert.equal((await state()).connection.provider, 'wealthengine')
  await h.command('research.screen', input, { as: member.cookie, status: 403 })
  const agent = await h.command('agent.create', { label: 'No research access' })
  const agentOptions = { as: '', headers: { authorization: 'Bearer ' + agent.token }, status: 403 }
  await h.command('research.screen', input, agentOptions)
  await state(agentOptions)
  const screened = await h.command('research.screen', input, { as: admin.cookie })
  assert.equal(screened.screened, 2); assert.equal(screened.matched, 2)
  let saved = await state({ as: admin.cookie })
  assert.equal(saved.results.length, 2)
  const adaResearch = saved.results.find(r => r.donor_id === ada.id)
  assert.equal(adaResearch.provider, 'wealthengine'); assert.ok(Date.parse(adaResearch.researched_at))
  assert.equal(adaResearch.wealth_rating, 'Excellent'); assert.equal(adaResearch.wealth_score, 92)
  assert.equal(adaResearch.capacity_range, '$100K-$200K'); assert.equal(adaResearch.capacity_low, '$100K')
  assert.equal(adaResearch.capacity_high, '$200K'); assert.equal(adaResearch.propensity, '1|2 - Excellent')
  assert.equal(adaResearch.annual_donations, '$10K-$25K')
  assert.doesNotMatch(JSON.stringify(saved), /must not be stored|networth|encrypted_key|test-wealthengine-edge-only|temporary-provider-session/)
  assert.equal((await h.get('/api/coffer/research?donorId=' + ada.id, { as: admin.cookie })).results.length, 1)
  assert.equal((await h.request('/app/research?donorId=' + ada.id, { as: admin.cookie })).status, 200)
  assert.equal((await h.request('/app/research', { as: member.cookie })).status, 403)
  const selection = new URLSearchParams({ command: 'research.screen' })
  selection.append('donorIds', ada.id); selection.append('donorIds', ben.id)
  const posted = await h.request('/app/actions', { method: 'POST', as: admin.cookie, raw: selection.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } })
  assert.equal(posted.status, 303, await posted.text())
  assert.ok(posted.headers.get('location')?.startsWith('/app/research'))
  saved = await state({ as: admin.cookie })
  const before = calls.length
  await h.command('research.screen', { donorIds: [ada.id, 'unknown'] }, { status: 404 })
  assert.equal(calls.length, before, 'Validate the entire selection before sending any donor')
  providerFailure = true
  const failure = await h.command('research.screen', input, { status: 502 })
  assert.doesNotMatch(JSON.stringify(failure), /Private upstream body|test-wealthengine-edge-only/)
  providerFailure = false; invalidResult = true
  await h.command('research.screen', input, { status: 502 })
  invalidResult = false
  assert.deepEqual((await state()).results, saved.results, 'Failed provider requests cannot replace saved results')
  await h.command('research.screen', { donorIds: [missing.id] })
  assert.equal((await state()).results.find(r => r.donor_id === missing.id).status, 'no_match')
  const backup=await archive(h),fresh=await installation({outbound})
  try{await restore(fresh,backup);assert.deepEqual((await fresh.get('/api/coffer/research')).results,(await state()).results);assert.equal((await fresh.get('/api/coffer/research')).connection,null)}finally{await fresh.close()}
  const compare=await h.get(`/api/coffer/duplicates/compare?source=${ada.id}&target=${ben.id}`)
  const merged=await h.command('donor.merge',{sourceDonorId:ada.id,donorId:ben.id,sourceVersion:compare.source.version,version:compare.target.version,reason:'duplicate_record'})
  assert.equal((await h.get('/api/coffer/research?donorId='+ben.id)).results.length,2,'Research from both records follows the surviving donor')
  const entryHistory=await h.get('/api/coffer/donors/'+ben.id,{as:member.cookie});assert.doesNotMatch(JSON.stringify(entryHistory),/Excellent|100K|capacity_range|wealth_score/)
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.equal((await h.get('/api/coffer/research?donorId='+ada.id)).results.length,1)
  if(process.env.COFFER_RESEARCH_BROWSER){const {researchBrowser}=await import('./research-browser.mjs');await researchBrowser(h,ada.id,missing.id,process.env.COFFER_RESEARCH_BROWSER)}
  const exported = JSON.stringify(await archive(h))
  assert.doesNotMatch(exported, /encrypted_key|test-wealthengine-edge-only|temporary-provider-session/)
  await h.command('donor.erase', { donorId: missing.id, confirm: 'ERASE' })
  assert.ok(!(await state()).results.some(r => r.donor_id === missing.id))
  await h.command('donor.erase', { donorId: ada.id, confirm: 'ERASE' })
  saved = await state()
  assert.deepEqual(saved.results.map(r => r.donor_id).sort(), [ben.id], 'Donor erasure removes all research for that person only')
  assert.doesNotMatch(JSON.stringify(await archive(h)), /"provider_profile_id":"12345"|must not be stored/)
  await h.command('research.disconnect', {}, { as: admin.cookie })
  assert.equal((await state()).connection, null)
  await h.command('research.screen', { donorIds: [ben.id] }, { status: 409 })
 }, { outbound })
}

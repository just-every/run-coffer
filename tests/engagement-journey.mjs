import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { run, donor, archive, restore, installation } from './harness.mjs'
import { withBrowserWorker } from './browser-worker.mjs'

// Public-door proof for MAJOR-004. The date is fixed by the normal advancing
// clock Worker, so eligibility and retention do not depend on wall-clock time.
export async function engagementJourney() {
 const chimp=JSON.parse(await readFile('tests/fixtures/mailchimp/responses.json','utf8'))
 let recipientEmail='',sent=false
 const member=()=>({id:'fixture-contact',email_address:recipientEmail,status:'subscribed'})
 const outbound=async request=>{
  const u=new URL(request.url),key=`${request.method} ${u.pathname}`
  assert.equal(u.origin,'https://us21.api.mailchimp.com')
  if(key==='GET /3.0/lists')return Response.json({lists:[{id:'fixture-list',name:'Reading room supporters',stats:{member_count:1}}]})
  if(key==='GET /3.0/lists/fixture-list/merge-fields')return Response.json({merge_fields:['CF_INFORM','CF_FORMAL','CF_ENVELOP','CF_PREFIX','CF_FIRST','CF_MIDDLE','CF_LAST','CF_SUFFIX','CF_NICK'].map(tag=>({tag,type:'text'})),total_items:9})
  if(/^PATCH \/3.0\/lists\/fixture-list\/members\//.test(key))return Response.json({...member(),merge_fields:(await request.json()).merge_fields})
  if(/^GET \/3.0\/lists\/fixture-list\/members\//.test(key))return Response.json(member())
  if(key==='POST /3.0/lists/fixture-list/segments')return Response.json(chimp.static_segment)
  if(key==='GET /3.0/lists/fixture-list/segments/101/members')return Response.json({total_items:1,members:[member()]})
  if(key==='POST /3.0/campaigns')return Response.json(chimp.campaign_saved)
  if(key==='GET /3.0/campaigns/fixture-campaign')return Response.json(sent?chimp.campaign_sent:chimp.campaign_saved)
  if(key==='PATCH /3.0/campaigns/fixture-campaign'||key==='PUT /3.0/campaigns/fixture-campaign/content')return Response.json({})
  if(key==='POST /3.0/campaigns/fixture-campaign/actions/send'){sent=true;return new Response(null,{status:204})}
  assert.fail(`Unexpected Mailchimp request ${key}`)
 }
 await run(async h => {
  const headers = { 'x-test-now': '2026-10-15T16:00:00Z' }
  const get = (path, options = {}) => h.get(path, { ...options, headers })
  const command = (name, input, options = {}) => h.command(name, input, { ...options, headers })
  const ada = await donor(h, 'Ada Engagement'), ben = await donor(h, 'Ben Earlier'), newcomer = await donor(h, 'New Constituent')
  const gift = (d, amount, receivedOn) => command('gift.record', { donorId: d.id, amount, receivedOn, goods: 'none', method: 'check' })
  await gift(ada, '200', '2026-10-01'); await gift(ada, '100', '2026-07-01')
  await gift(ben, '100', '2024-01-01')
  const reversed = await gift(ada, '1000', '2026-10-02')
  await command('gift.reverse', { giftId: reversed.id, reason: 'duplicate_entry' })
  for (const kind of ['call', 'meeting', 'email']) await command('interaction.record', { donorId: ada.id, kind, occurredOn: '2026-10-10', who: 'Donor and fundraiser', notes: 'Discussed the upcoming program.' })
  // The real provider submission creates the communication that receives replies.
  recipientEmail=(await get('/api/coffer/donors/'+ada.id)).donor.email
  await command('consent.record',{donorIds:[ada.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic newsletter opt-in at the reading-room tour.',capturedOn:'2026-10-01'})
  await command('marketing.connectMailchimp',{apiKey:'test-us21'})
  await command('marketing.chooseAudience',{listId:'fixture-list',fromName:'Reading room team',fromEmail:'replies@example.test'})
  const appeal=await command('appeal.prepare',{name:'Reading room news',channel:'email',subject:'Reading room news',body:'Dear {{donor_name}}, thank you for visiting the reading room.'})
  await command('appeal.approve',{appealId:appeal.id,version:appeal.version})
  assert.equal((await command('appeal.send',{appealId:appeal.id,version:2})).submitted,1)
  await command('appeal.export',{appealId:appeal.id,version:2})
  await command('appeal.markSent',{appealId:appeal.id,version:3,sentOn:'2026-10-15'})
  const reply=async(automatic=false)=>{
   const response=await h.request('/test-email',{method:'POST',headers,body:{from:recipientEmail,to:'replies@example.test',headers:{subject:'Re: Reading room news','message-id':automatic?'<automatic@example.test>':'<reply@example.test>',...(automatic?{'auto-submitted':'auto-replied'}:{})},raw:'Content-Type: text/plain; charset=utf-8\r\n\r\nThank you, I would like to meet about the reading room.'}})
   assert.equal(response.status,200);return response.json()
  }
  assert.equal((await reply()).forwarded.length,1)
  assert.equal((await reply()).forwarded.length,0,'A replay never forwards or counts a second reply')
  assert.equal((await reply(true)).forwarded.length,0)
  const owner=(await get('/auth/session')).operator
  const taskSource=(await get('/api/coffer/tasks')).sources.find(s=>s.donorId===ben.id)
  const call=await command('task.generate',{sourceKey:taskSource.key,ownerId:owner.id,dueOn:'2026-10-15'})
  await command('task.complete',{taskId:call.id,version:call.version,outcome:'no_answer',notes:'No answer at the listed number.'})
  const prospect=await command('prospect.save',{donorId:ada.id,label:'Reading room renewal',ownerId:owner.id,stage:'cultivate',askAmount:'5000',expectedCloseOn:'2026-12-01',nextStep:'Visit the reading room.'})
  const futureHeaders={'x-test-now':'2026-10-20T16:00:00Z'}
  await h.command('gift.record',{donorId:ada.id,amount:'999',receivedOn:'2026-10-20',goods:'none',method:'check'},{headers:futureHeaders})
  await h.command('interaction.record',{donorId:ada.id,kind:'meeting',occurredOn:'2026-10-20',who:'Future visitor',notes:'Outside the report period.'},{headers:futureHeaders})
  const report = await get('/api/coffer/engagement'), policy = await get('/api/coffer/engagement/settings')
  assert.deepEqual(report.policy, policy)
  assert.ok(report.donors.some(d => d.donorId === newcomer.id), 'Constituents without prospects receive scores')
  const read = (r, d) => r.donors.find(row => row.donorId === d.id).engagement
  const active = read(report, ada)
  assert.equal(active.frequency.gifts, 2); assert.equal(active.amount.cents, 30000)
  assert.equal(active.conversations.count, 4)
  assert.deepEqual([active.conversations.calls, active.conversations.meetings, active.conversations.emails], [1, 1, 2])
  // Independently reconstruct every component from public inputs and policy.
  const round = n => Math.round(n * 100) / 100
  for (const row of report.donors) {
   const s = row.engagement, f = policy.formula, w = policy.weights
   const recency = s.recency.days === null ? 0 : f.recency.find(t => s.recency.days <= t.throughDays)?.basePoints ?? 0
   const bases = { recency, frequency: Math.min(f.frequency.cap, s.frequency.gifts * f.frequency.pointsPerGift),
    amount: Math.min(f.amount.cap, Math.floor(s.amount.cents / f.amount.centsPerUnit) * f.amount.pointsPerUnit),
    conversations: Math.min(f.conversations.cap, s.conversations.count * f.conversations.pointsPerInteraction) }
   const points = Object.entries(bases).map(([key, value]) => round(value * w[key] / 25))
   assert.equal(s.score, round(points.reduce((sum, n) => sum + n, 0)))
   for (const [key, value] of Object.entries(bases)) assert.equal(s[key].points, round(value * w[key] / 25))
  }
  assert.equal(read(report, ben).conversations.count,0)
  assert.equal(active.conversations.replies,1)
  assert.deepEqual((await get('/api/coffer/prospects')).find(p=>p.id===prospect.id).engagement,active)
  assert.equal(read(report, ben).retentionRisk.flag, true)
  assert.equal(read(report, newcomer).retentionRisk.status, 'unknown')
  const member = await h.person('score-member@example.test')
  const input = { version: policy.version, recency: 100, frequency: 0, amount: 0, conversations: 0 }
  await command('engagement.settings', input, { as: member.cookie, status: 403 })
  await command('engagement.settings', input, { as: '', status: 401 })
  const agent = await command('agent.create', { label: 'Read constituent engagement' })
  await h.command('engagement.settings', input, { as: '', headers: { ...headers, authorization: 'Bearer ' + agent.token }, status: 403 })
  await command('engagement.settings', { ...input, recency: 90 }, { status: 400 })
  const changed = await command('engagement.settings', input)
  await command('engagement.settings', input, { status: 409 })
  const updated = await get('/api/coffer/engagement')
  assert.notEqual(read(updated, ada).score, active.score)
  assert.equal(read(updated, ada).score, 100)
  assert.equal(read(updated, ben).retentionRisk.flag, true)
  const admin = await h.person('score-admin@example.test', 'admin')
  const adminSaved = await command('engagement.settings', { ...input, version: changed.version, recency: 0, conversations: 100 }, { as: admin.cookie })
  assert.equal((await get('/api/coffer/engagement/settings')).version, adminSaved.version)
  const page = await h.request('/app/engagement', { headers }); assert.equal(page.status, 200)
  const settingsHtml=await page.text(),visiblePolicy=await get('/api/coffer/engagement/settings')
  for(const [key,weight] of Object.entries(visiblePolicy.weights)) {
   const control=settingsHtml.match(new RegExp('<input[^>]*name="'+key+'"[^>]*>'))?.[0]
   assert.ok(control,`The settings page exposes the ${key} weight`)
   assert.equal(control.match(/value="([^"]*)"/)?.[1],String(weight),'The page and API expose the same current policy')
  }
  const detail = await get('/api/coffer/donors/' + ada.id)
  assert.deepEqual(detail.engagement, read(await get('/api/coffer/engagement'), ada))
  if (process.env.COFFER_ENGAGEMENT_BROWSER) {
   const directory = process.env.COFFER_ENGAGEMENT_BROWSER
   await mkdir(directory, { recursive: true })
   await withBrowserWorker(h, async (context, origin) => {
    await context.setExtraHTTPHeaders({ cookie: h.owner, ...headers })
    const page = await context.newPage()
    for (const width of [1440, 390]) {
     await page.setViewportSize({ width, height: 1000 })
     await page.goto(origin + '/app/engagement')
     assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
     await page.screenshot({ path: `${directory}/MAJOR-004-settings-${width}.png`, fullPage: true })
     await page.getByLabel('Recency weight', { exact: true }).fill('50')
     await page.getByLabel('Conversations weight', { exact: true }).fill('50')
     await page.getByRole('button', { name: 'Save score weights', exact: true }).click()
     assert.ok(await page.getByLabel('Recency weight', { exact: true }).inputValue() === '50')
     await page.goto(origin + '/app/pipeline')
     await page.getByText(/Engagement .*see inputs and points/).click()
     await page.screenshot({path:`${directory}/MAJOR-004-pipeline-${width}.png`,fullPage:true})
     await page.goto(origin + '/app/donors/' + ada.id)
     await page.locator('#engagement').waitFor()
     assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
     await page.screenshot({ path: `${directory}/MAJOR-004-donor-${width}.png`,fullPage:true })
     await page.locator('#engagement').evaluate(el=>el.scrollIntoView({block:'center'}))
     await page.locator('#engagement').screenshot({path:`${directory}/MAJOR-004-factors-${width}.png`})
    }
   })
  }
  const saved = await archive(h), fresh = await installation({ entry: 'tests/advancing-clock-worker.ts' })
  try {
   await restore(fresh, saved)
   assert.deepEqual(await fresh.get('/api/coffer/engagement', { headers }), await get('/api/coffer/engagement'))
  } finally { await fresh.close() }
  const source = await get('/api/coffer/donors/' + ada.id), target = await get('/api/coffer/donors/' + ben.id)
  const merged = await command('donor.merge', { sourceDonorId: ada.id, sourceVersion: source.donor.version, donorId: ben.id, version: target.donor.version, reason: 'duplicate_record' })
  const combined = await get('/api/coffer/engagement')
  assert.ok(!combined.donors.some(d => d.donorId === ada.id)); assert.equal(read(combined, ben).conversations.count, 4)
  await command('donor.unmerge', { mergeId: merged.mergeId, reason: 'incorrect_match' })
  assert.equal(read(await get('/api/coffer/engagement'), ada).conversations.count, 4)
  await command('donor.erase', { donorId: ada.id, confirm: 'ERASE' })
  const erased = await get('/api/coffer/engagement')
  assert.ok(!erased.donors.some(d => d.donorId === ada.id)); assert.doesNotMatch(JSON.stringify(erased), /Ada Engagement/)
 }, { entry: 'tests/engagement-worker.ts',outbound,bindings:{COFFER_REPLY_ADDRESS:'replies@example.test'} })
}

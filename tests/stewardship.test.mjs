import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run, donor, reviewed } from './harness.mjs'

test('stewardship uses real cited records, protects the key, and only sends an explicitly reviewed consented version once', async () => {
 const calls = [], emails = []
 let unsupported = false, inventedCitation = false
 const workspaceId = 'wrkspc_network_edge_01'
 const created = Math.floor(Date.now()/1000)-3600
 const savedCharge = {id:'ch_Stewardship',object:'charge',amount:10000,amount_refunded:1000,currency:'usd',paid:true,status:'succeeded',created,customer:'cus_Stewardship',metadata:{fund:'Reading'},billing_details:{email:'adjusted@example.test',name:'Adjusted Donor'}}
 const liveCharge = {...savedCharge,amount_refunded:2000,metadata:{fund:'Meals'}}
 await run(async h => {
  await reviewed(h)
  const d = await donor(h, 'Ana Diaz')
  const gift = await h.command('gift.record', { donorId:d.id, amount:'125', receivedOn:'2026-10-01', method:'check', goods:'none', fund:'Reading fund' })
  await h.command('interaction.record', { donorId:d.id, kind:'call', occurredOn:'2026-10-02', who:'Morgan', notes:'Ana asked for an update about the Reading fund.' })
  await h.command('tribute.record', { giftId:gift.id, kind:'memory', honoree:'Leela Diaz' })
  const route = action => '/api/coffer/agent/stewardship/' + action
  const state = () => h.get('/api/coffer/agent/stewardship?donorId=' + d.id)
  await h.api(route('draft'), { donorId:d.id, kind:'thank_you' }, { status:409 })
  assert.equal(calls.length, 0)
  const noKeyPage = await h.request('/app/agent/setup')
  assert.equal(noKeyPage.status, 200)
  assert.match(await noKeyPage.text(), /Deterministic jobs work without AI/)
  const key = 'synthetic-key-for-network-edge-only'
  const initial = await state()
  await h.api(route('setup'), { version:initial.setup.version, key })
  assert.ok(!JSON.stringify(await state()).includes(key))
  assert.ok(!(await (await h.request('/app/agent/setup')).text()).includes(key))
  const workspaceMissing = await h.api(route('test'), {}, {status:409})
  assert.equal(workspaceMissing.error,'ai_workspace_required')
  assert.match(workspaceMissing.message,/AI setup/)
  assert.ok(!JSON.stringify(workspaceMissing).includes('private-provider-diagnostic'))
  await h.api(route('setup'),{version:(await state()).setup.version,workspaceId:'invalid workspace'},{status:400})
  // Selecting a workspace does not require plaintext readback or re-entry of
  // the saved key; subsequent key replacement keeps the selected workspace.
  await h.api(route('setup'),{version:(await state()).setup.version,workspaceId})
  await h.api(route('setup'),{version:(await state()).setup.version,key})
  assert.equal((await state()).setup.workspaceId,workspaceId)
  assert.match(await (await h.request('/app/agent/setup')).text(),new RegExp(workspaceId))
  assert.equal((await h.api(route('test'), {})).connected, true)
  assert.equal(calls[0].messages[0].content.includes('Ana'), false)
  const draft = await h.api(route('draft'), { donorId:d.id, kind:'impact' })
  const prompt = JSON.parse(calls.find(call => JSON.parse(call.messages[0].content).kind === 'impact').messages[0].content)
  assert.ok(prompt.sources.some(s => s.id === 'gift:' + gift.id && s.facts.original_fund === 'Reading fund' && s.facts.current_amount_cents === 12500))
  assert.ok(prompt.sources.some(s => s.kind === 'conversation' && s.facts.notes.includes('Ana asked')))
  assert.ok(prompt.sources.some(s => s.kind === 'tribute' && s.facts.honoree === 'Leela Diaz'))
  assert.ok(!JSON.stringify(prompt).includes('ana.diaz@example.org'))
  const first = (await state()).drafts.find(row => row.id === draft.id)
  assert.ok(JSON.parse(first.citations).every(c => prompt.sources.some(s => s.id === c.sourceId)))
  const page = await h.request('/app/agent/stewardship?donorId=' + d.id)
  // the recorded gift is shown as a ledger row (fund, amount), never as its raw source key
  const pageText = await page.text()
  assert.match(pageText, /<strong>Reading fund<\/strong>[^]*\$125\.00/)
  assert.doesNotMatch(pageText, new RegExp('gift:' + gift.id))
  await h.api(route('send'), { ...draft, confirm:'SEND' }, { status:409 })
  unsupported = true
  await h.api(route('save'), { ...draft, subject:first.subject, body:'Your gift taught 500 children to read.' }, { status:409 })
  unsupported = false
  let saved = await h.api(route('save'), { ...draft, subject:first.subject, body:first.body + '\n\nWith gratitude.' })
  await h.api(route('save'), { ...draft, subject:first.subject, body:first.body }, { status:409 })
  await h.api(route('send'), { ...saved, confirm:'SEND' }, { status:409 })
  assert.equal(emails.length, 0)
  let discarded = await h.api(route('discard'), saved)
  let restored = await h.api(route('restore'), discarded)
  const restoredRow = (await state()).drafts.find(row => row.id === restored.id)
  saved = await h.api(route('save'), { ...restored, subject:restoredRow.subject, body:restoredRow.body })
  await h.command('consent.record', { donorIds:[d.id], channel:'email', status:'granted', method:'paper form', evidence:'Synthetic consent', capturedOn:'2026-10-01' })
  const sent = await h.api(route('send'), { ...saved, confirm:'SEND' })
  assert.equal(sent.status, 'submitted')
  assert.equal(emails.length, 1)
  assert.equal(emails[0].personalizations[0].to[0].email, 'ana.diaz@example.org')
  assert.equal(emails[0].content[0].value, restoredRow.body)
  await h.api(route('send'), { ...saved, confirm:'SEND' }, { status:409 })
  assert.equal(emails.length, 1)
  inventedCitation = true
  await h.api(route('draft'), { donorId:d.id, kind:'thank_you' }, { status:502 })
  inventedCitation = false
  const stale = await h.api(route('draft'), { donorId:d.id, kind:'thank_you' })
  const staleRow = (await state()).drafts.find(row => row.id === stale.id)
  await h.command('gift.record', { donorId:d.id, amount:'30', receivedOn:'2026-10-03', method:'check', goods:'none', fund:'Reading fund' })
  await h.api(route('save'), { ...stale, subject:staleRow.subject, body:staleRow.body }, { status:409 })
  // Import an already partly refunded charge, then reconcile a further refund
  // and changed fund through the actual public reconciliation commands.
  const moveIn = {customers:[{object:'list',data:[{id:'cus_Stewardship',object:'customer',name:'Adjusted Donor',email:'adjusted@example.test',created}]}],charges:[{object:'list',data:[savedCharge]}],noGoodsOrServices:true}
  const plan = await h.api('/api/coffer/imports/preview',moveIn)
  let job = await h.api('/api/coffer/imports/apply',{...moveIn,fingerprint:plan.fingerprint})
  while(job.state!=='completed') job = await h.api('/api/coffer/imports/resume',{id:job.id})
  const adjusted = (await h.get('/api/coffer/donors')).donors.find(row=>row.email==='adjusted@example.test')
  const adjustedState = () => h.get('/api/coffer/agent/stewardship?donorId='+adjusted.id)
  const pending = await h.api(route('draft'),{donorId:adjusted.id,kind:'thank_you'})
  const pendingRow = (await adjustedState()).drafts.find(row=>row.id===pending.id)
  const reviewedPending = await h.api(route('save'),{...pending,subject:pendingRow.subject,body:pendingRow.body})
  await h.command('consent.record',{donorIds:[adjusted.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic consent',capturedOn:'2026-10-01'})
  const scan = await h.api('/api/coffer/agent/reconcile/run',{})
  const issue = scan.issues.find(row=>row.source_id===savedCharge.id && row.kind==='contribution')
  await h.api('/api/coffer/agent/reconcile/apply',{id:issue.id})
  const rejectedSend = await h.api(route('send'),{...reviewedPending,confirm:'SEND'},{status:409})
  assert.equal(rejectedSend.error,'SOURCES_CHANGED')
  const correctedSources = (await adjustedState()).sources
  const correctedGift = correctedSources.find(source=>source.kind==='gift')
  assert.equal(correctedGift.facts.original_amount_cents,9000)
  assert.equal(correctedGift.facts.current_amount_cents,8000)
  assert.ok(correctedSources.some(source=>source.kind==='contribution' && source.facts.kind==='reversal' && source.facts.reverses===correctedGift.facts.id && source.facts.signed_amount_cents===-9000 && source.facts.fund==='Reading'))
  assert.ok(correctedSources.some(source=>source.kind==='contribution' && source.facts.kind==='gift' && source.facts.gift_id===correctedGift.facts.id && source.facts.signed_amount_cents===8000 && source.facts.fund==='Meals'))
  assert.ok(correctedSources.some(source=>source.kind==='fund' && source.facts.fund==='Reading' && source.facts.current_amount_cents===0))
  const correctedDraft = await h.api(route('draft'),{donorId:adjusted.id,kind:'thank_you'})
  const correctedRow = (await adjustedState()).drafts.find(row=>row.id===correctedDraft.id)
  assert.match(correctedRow.body,/\$80\.00.*Meals/)
  assert.ok(JSON.parse(correctedRow.citations).every(citation=>correctedSources.some(source=>source.id===citation.sourceId)))
  await h.api('/api/coffer/agent/reconcile/undo',{id:issue.id})
  const rejectedSave = await h.api(route('save'),{...correctedDraft,subject:correctedRow.subject,body:correctedRow.body},{status:409})
  assert.equal(rejectedSave.error,'SOURCES_CHANGED')
  assert.equal((await adjustedState()).sources.find(source=>source.kind==='gift').facts.current_amount_cents,9000)
  // This installation uses SendGrid for auth invitations as well as notes.
  await h.api('/auth/invite', { email:'member@example.test',role:'member',displayName:'Member',returnTo:'/app' }, { status:202 })
  const invitation = emails.at(-1).content.find(part=>part.type==='text/plain').value
  const token = new URL(invitation.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]).searchParams.get('token')
  const confirmation = await h.request('/auth/confirm', { method:'POST',as:'',body:{token} })
  assert.equal(confirmation.status, 303)
  const memberCookie = confirmation.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  await h.api(route('setup'), { version:(await state()).setup.version, key }, { as:memberCookie,status:403 })
  await h.api(route('setup'), { version:(await state()).setup.version, remove:true })
  await h.api(route('draft'), { donorId:d.id,kind:'thank_you' }, { status:409 })
  await h.command('donor.erase', { donorId:d.id,confirm:'ERASE' })
  const erased = await h.get('/api/coffer/agent/stewardship')
  assert.equal(erased.drafts.some(row => row.donor_id === d.id), false)
 }, { bindings:{ MAIL_PROVIDER:'sendgrid', STRIPE_SECRET_KEY:'sk_test_stewardship_network_edge' }, outbound:async request => {
  const host = new URL(request.url).hostname
  if (host === 'api.sendgrid.com') { emails.push(await request.json()); return new Response(null,{ status:202,headers:{'x-message-id':'stewardship-test-email'} }) }
  if (host === 'api.stripe.com') {
   const path = new URL(request.url).pathname
   if(path==='/v1/charges') return Response.json({data:[liveCharge],has_more:false})
   if(path==='/v1/payouts') return Response.json({data:[],has_more:false})
   if(path==='/v1/charges/'+savedCharge.id) return Response.json(liveCharge)
   assert.fail('Unexpected Stripe request '+path)
  }
  assert.equal(host, 'api.anthropic.com')
  assert.equal(request.headers.get('x-api-key'), 'synthetic-key-for-network-edge-only')
  if(!request.headers.has('anthropic-workspace-id')) return Response.json({error:{message:'private-provider-diagnostic: workspace header is required'}},{status:400})
  assert.equal(request.headers.get('anthropic-workspace-id'),workspaceId)
  const call = await request.json(), input = JSON.parse(call.messages[0].content)
  calls.push(call)
  let output
  if (input.requestedStatus) output = { status:'connected' }
  else if (input.subject) output = { assessment:unsupported?'The claimed outcome is absent from the records.':'The current contribution and fund support the note.',supported:!unsupported,sourceIds:[input.sources.find(s=>s.kind==='gift' && s.facts.current_amount_cents>0).id,input.sources.find(s=>s.kind==='fund' && s.facts.current_amount_cents>0).id] }
  else {
   const gift = input.sources.find(s => s.kind === 'gift' && s.facts.current_amount_cents>0)
   const fund = input.sources.find(s => s.kind === 'fund' && s.facts.current_amount_cents>0)
   output = { subject:'Thank you',body:`Thank you for your current support of $${(fund.facts.current_amount_cents/100).toFixed(2)} to ${fund.facts.fund}.`,citations:[{sourceId:inventedCitation?'gift:invented':gift.id},{sourceId:fund.id}] }
  }
  return Response.json({ stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(output)}] })
 } })
})

// DEV-006 shares this existing test file to keep the seed's test-file budget.
test('STEW-006: personal calendar connection, donor timeline and signed Calendly booking preparation with custody',async()=>{
 const {calendarsJourney}=await import('./calendars-journey.mjs')
 await calendarsJourney()
})

test('DEV-006: schedule, day-ahead source-linked brief, existing research boundaries and custody',async()=>{
 const {meetingBriefJourney}=await import('./meeting-briefs-journey.mjs')
 await meetingBriefJourney()
})


test('DEV-011: monthly development reports cite their sources and require exact director approval before submission',async()=>{
 const {developmentReportJourney}=await import('./development-report-journey.mjs')
 await developmentReportJourney()
})

import assert from 'node:assert/strict'
import { run, donor, archive, restore, csvRows, reviewed, settings as letterSettings } from './harness.mjs'
import { recognitionEdges, giveRecognition } from './recognition-edge.mjs'

export async function stateReportJourney() {
 const edge = recognitionEdges()
 await run(async h => {
  await reviewed(h)
  const place = (region, extra = {}) => ({ region, city: 'Springfield', postalCode: '00000', ...extra })
  const ada = await donor(h, 'Ada State', place('IL')), ben = await donor(h, 'Ben State', place('Wisconsin')), cara = await donor(h, 'Cara State', place('ca'))
  const nora = await donor(h, 'Nora Noaddress', { addressLine1: '', city: '', region: '', postalCode: '' }), eve = await donor(h, 'Eve Abroad', place('ON', { country: 'Canada' }))
  const moe = await donor(h, 'Moe Mover', place('IL')), org = await donor(h, 'Lakeside Foundation', place('MN'))
  const spring = await h.api('/api/coffer/giving/campaigns', { name: 'Spring books', slug: 'spring-books', description: 'Books for spring.', fund: 'Reading', goal: '1000' })
  const autumn = await h.api('/api/coffer/giving/campaigns', { name: 'Autumn reading', slug: 'autumn-reading', description: 'Keep reading.', fund: 'Reading', goal: '1000' })
  const gift = (d, amount, receivedOn, extra = {}) => h.command('gift.record', { donorId: d.id, amount, receivedOn, method: 'check', fund: 'Reading', goods: 'none', ...extra })
  await gift(ada, '100', '2026-03-01'); await gift(ada, '999', '2025-12-31')
  await gift(ben, '200', '2026-04-01', { method: 'cash', fund: 'Library' })
  const cara1 = await gift(cara, '50', '2026-02-01'); await gift(cara, '25', '2026-05-01')
  await gift(nora, '30', '2026-02-02'); await gift(eve, '40', '2026-02-03'); await gift(org, '500', '2026-02-04')
  const moeMarch = await gift(moe, '70', '2026-03-15')
  // A split offline gift attributed to two campaigns, none through a giving form.
  await h.command('gift.record', { donorId: ben.id, amount: '100', receivedOn: '2026-04-02', method: 'check', goods: 'none', allocations: [{ amount: '60', fund: 'Reading', campaignId: spring.id }, { amount: '40', fund: 'Reading', campaignId: autumn.id }] })

  // REPORT-008: a move records the earlier address with its exact effective day.
  const move = (version, region, addressEffectiveOn, options) => h.command('donor.update', { donorId: moe.id, version, name: 'Moe Mover', email: 'moe.mover@example.org', addressLine1: '1 Main Street', city: 'Albany', region, postalCode: '12207', country: 'United States', addressEffectiveOn }, options)
  assert.equal((await move(1, 'NY', '2999-01-01', { status: 400 })).error, 'INPUT')
  await move(1, 'NY', '2026-06-01')
  assert.equal((await move(2, 'NJ', '2026-05-01', { status: 409 })).error, 'ADDRESS_ORDER', 'a move cannot predate the last recorded move')
  await gift(moe, '10', '2026-06-01'); await gift(moe, '80', '2026-07-01')
  await h.command('gift.reverse', { giftId: moeMarch.id, reason: 'Check returned unpaid' })
  await h.command('gift.reverse', { giftId: cara1.id, reason: 'Check returned unpaid' })
  // An online gift through the autumn giving form.
  await giveRecognition(h, { name: 'Ada State', email: 'ada.state@example.org', amount: '20.00' })

  const report = (query = '') => h.get('/api/coffer/reports/states?year=2026' + query)
  const r = await report(), row = label => r.rows.find(x => x.label === label || x.state === label)
  assert.deepEqual(r.rows.map(x => x.state ?? x.label), ['CA', 'IL', 'MN', 'NY', 'WI', 'Outside the United States', 'Unknown address'])
  // Moe's March gift and its later reversal stay in Illinois; the move day and later count in New York.
  assert.deepEqual(row('IL'), { state: 'IL', label: 'Illinois', donors: 2, gifts: 3, amountCents: 10000 + 2000 })
  assert.deepEqual(row('NY'), { state: 'NY', label: 'New York', donors: 1, gifts: 2, amountCents: 9000 })
  assert.deepEqual(row('CA'), { state: 'CA', label: 'California', donors: 1, gifts: 2, amountCents: 2500 })
  assert.deepEqual(row('WI'), { state: 'WI', label: 'Wisconsin', donors: 1, gifts: 2, amountCents: 30000 })
  assert.equal(row('MN').amountCents, 50000, 'an organization counts by its own address')
  assert.deepEqual([row('Outside the United States').amountCents, row('Unknown address').amountCents], [4000, 3000])
  // Rows sum to the ledger: the fund report for the same period agrees to the cent.
  const ledger = (await h.get('/api/coffer/reports/funds?from=2026-01-01&through=2026-12-31')).funds.reduce((s, f) => s + Number(f.amount_cents), 0)
  assert.equal(r.totalCents, ledger); assert.equal(r.rows.reduce((s, x) => s + x.amountCents, 0), ledger)
  assert.equal(r.start, '2026-01-01')

  // Filters: fund, channel, campaign (attribution) and giving form (online gifts through that page).
  assert.deepEqual((await report('&fund=Library')).rows.map(x => [x.state, x.amountCents]), [['WI', 20000]])
  assert.deepEqual((await report('&channel=cash')).rows.map(x => [x.state, x.amountCents]), [['WI', 20000]])
  assert.deepEqual((await report('&campaignId=' + spring.id)).rows.map(x => [x.state, x.amountCents]), [['WI', 6000]])
  assert.deepEqual((await report('&campaignId=' + autumn.id)).rows.map(x => [x.state, x.amountCents]), [['IL', 2000], ['WI', 4000]])
  assert.deepEqual((await report('&formId=' + autumn.id)).rows.map(x => [x.state, x.amountCents]), [['IL', 2000]])
  assert.equal((await h.get('/api/coffer/reports/states?year=2026&channel=pigeon', { status: 400 })).error, 'INPUT')
  // A fiscal year starting 1 July moves the window.
  const current = await h.get('/api/coffer/settings')
  await h.command('settings.update', { ...letterSettings, fiscalYearStart: '07-01', version: current.version })
  const fiscal = await h.get('/api/coffer/reports/states?year=2025&basis=fiscal')
  // FY2025 runs 1 July 2025 through 30 June 2026: Ada's December gift and every first-half 2026 entry, not the later reversals.
  assert.deepEqual([fiscal.start, fiscal.through, fiscal.totalCents], ['2025-07-01', '2026-06-30', 99900 + 112500])

  // CSV for registrations and renewals.
  const csv = await h.request('/api/coffer/reports/states.csv?year=2026')
  assert.match(csv.headers.get('content-disposition'), /coffer-giving-by-state\.csv/)
  const lines = csvRows(await csv.text())
  assert.equal(lines[0], '"State","State name","Donors","Gifts","Amount USD"')
  assert.ok(lines.includes('"NY","New York","1","2","90.00"'))
  assert.equal(lines.at(-1), `"","Total (ledger)","","","${(ledger / 100).toFixed(2)}"`)
  assert.match(await (await h.request('/app/reports/states?year=2026')).text(), /Giving by state[\s\S]*New York/)

  // Custody: history survives backup/restore and merge/undo exactly; erasure removes it.
  const before = (await report()).rows
  const lines2 = await archive(h)
  await run(async fresh => { await restore(fresh, lines2); assert.deepEqual((await fresh.get('/api/coffer/reports/states?year=2026')).rows, before) })
  const twin = await donor(h, 'Moe Twin', place('TX'))
  const comparison = await h.get(`/api/coffer/duplicates/compare?source=${twin.id}&target=${moe.id}`)
  const merged = await h.command('donor.merge', { sourceDonorId: twin.id, donorId: moe.id, sourceVersion: comparison.source.version, version: comparison.target.version, fields: { addressLine1: 'source', city: 'source', region: 'source', postalCode: 'source' }, reason: 'duplicate_record' })
  assert.deepEqual((await report()).rows.find(x => x.state === 'NY'), before.find(x => x.state === 'NY'), 'a merge-day address change never reassigns earlier gifts')
  await h.command('donor.unmerge', { mergeId: merged.mergeId, reason: 'incorrect_match' })
  assert.deepEqual((await report()).rows, before)
  const file = await (await h.request(`/api/coffer/donors/${moe.id}/data-request`, { method: 'POST', body: { requestedOn: '2026-07-02', method: 'email' } })).json()
  assert.deepEqual(['region', 'until_on', 'source'].map(k => file.records.donor_address_history[0][k]), ['IL', '2026-06-01', 'staff'], 'the donor’s own file holds their address history')
  await h.command('donor.erase', { donorId: moe.id, confirm: 'ERASE' })
  const erased = await report()
  assert.equal(erased.rows.find(x => x.state === 'NY'), undefined)
  assert.equal(erased.rows.find(x => x.label === 'Unknown address').amountCents, 3000 + 9000)
  assert.equal(erased.totalCents, ledger, 'erased gifts stay in the ledger total, under Unknown address')
  const db = await h.mf.getD1Database('DB')
  assert.equal((await db.prepare('SELECT count(*) AS n FROM cf_donor_address_history WHERE donor_id=?').bind(moe.id).first()).n, 0, 'no address history remains for the erased donor')
 }, { bindings: { STRIPE_SECRET_KEY: 'sk_test_recognition_edge', MAIL_PROVIDER: 'sendgrid' }, outbound: edge.outbound })
}


/** DONOR-009: real entry, minute Cron, mail preparation and custody; only the
 * Smarty and licensed NCOA HTTP edges are faked. The list has 100 genuine test
 * constituents, rather than production padding to evade a provider minimum. */
export async function addressVerificationJourney(){
 const smarty=[],ncoa=[];let rejectSmarty=false,malformedNcoa=false,failNcoa=false,moverId,badId
 const edge=async request=>{
  const host=new URL(request.url).hostname,body=await request.json()
  if(host==='us-street.api.smarty.com'){
   assert.equal(request.method,'POST');assert.ok(request.headers.get('authorization')?.startsWith('Basic '));smarty.push(body)
   if(rejectSmarty)return new Response('unavailable',{status:503})
   return Response.json(body.map((a,i)=>({input_id:a.input_id,input_index:i,delivery_line_1:a.street.toUpperCase().replace('STREET','ST'),delivery_line_2:a.street2,components:{city_name:a.city.toUpperCase(),state_abbreviation:a.state.toUpperCase(),zipcode:a.zipcode.slice(0,5),plus4_code:'1234'},analysis:{dpv_match_code:'Y',dpv_vacant:'N',dpv_no_stat:'N',dpv_footnotes:'AABB'}})))
  }
  assert.equal(host,'smartmover.melissadata.net');assert.equal(request.method,'POST');ncoa.push(body)
  assert.equal(body.Actions,'NCOA');assert.equal(body.CustomerID,'synthetic-coffer-903');assert.equal(body.Records.length,100)
  if(failNcoa)return new Response('unavailable',{status:503})
  const records=body.Records.map(r=>({...r,CountryCode:'US',Plus4:'1234',Results:r.RecordID===badId?'AE04':r.RecordID===moverId?'AS01,CS01':'AS01',MoveReturnCode:r.RecordID===moverId?'A':'00',...(r.RecordID===moverId?{AddressLine1:'9 MOVER ST',City:'ALBANY',State:'NY',PostalCode:'12207',MoveEffectiveDate:'202609'}:{})}))
  if(malformedNcoa)records[1].RecordID=records[0].RecordID
  return Response.json({TransmissionResults:'',TransmissionReference:body.TransmissionReference,TotalRecords:String(records.length),Records:records})
 }
 await run(async h=>{
  await reviewed(h)
  const member=await h.person('synthetic-coffer-904@example.test'),getAddress=id=>h.get('/api/coffer/donors/'+id+'/addresses')
  const processing=version=>h.command('address.processing',{version,enabled:'yes',pafReference:'synthetic-coffer-905',reviewed:'yes'})
  await h.command('address.processing',{version:0,enabled:'yes',pafReference:'synthetic-coffer-905',reviewed:'yes'},{as:member.cookie,status:403})
  await h.get('/api/coffer/addresses',{as:member.cookie,status:403});await h.get('/api/coffer/addresses',{as:'',status:401})
  await processing(0)
  const maya=await donor(h,'Synthetic Address Maya',{email:'synthetic-coffer-906@example.test',addressLine1:'1 maple street'});moverId=maya.id
  let history=await h.get('/api/coffer/donors/'+maya.id)
  assert.equal(history.donor.address_line1,'1 MAPLE ST');assert.equal(history.donor.postal_code,'62701-1234')
  assert.equal((await getAddress(maya.id)).check.status,'verified')
  assert.ok((await getAddress(maya.id)).history.some(r=>r.address_line1==='1 maple street'&&r.source==='smarty'))
  const undeliverable=await donor(h,'Synthetic Address Rowan',{email:'synthetic-coffer-907@example.test',addressLine1:'2 maple street'});badId=undeliverable.id
  const permission=d=>h.command('consent.record',{donorIds:[d.id],channel:'mail',status:'granted',method:'paper form',evidence:'synthetic-coffer-908',capturedOn:'2025-01-01'})
  await permission(maya);await permission(undeliverable)
  await h.command('gift.record',{donorId:maya.id,amount:'100',receivedOn:'2025-01-01',method:'check',goods:'none'})
  const short=await h.command('address.queueNcoa',{}, {status:409});assert.equal(short.error,'NCOA_LIST_TOO_SMALL');assert.equal(ncoa.length,0)
  for(let i=0;i<98;i++)await donor(h,'Synthetic Address Supporter '+i,{email:`synthetic-coffer-${1000+i}@example.test`,addressLine1:`${i+10} maple street`})
  rejectSmarty=true
  await donor(h,'Synthetic Unverified Write',{email:'synthetic-coffer-909@example.test'},{status:502})
  assert.equal((await h.get('/api/coffer/donors?q=Synthetic%20Unverified%20Write')).donors.length,0,'A provider outage saves no purported verification or partial donor')
  rejectSmarty=false
  const prepare=()=>h.command('appeal.prepare',{name:'Autumn address-reviewed mailing',channel:'mail'})
  const queued=await h.command('appeal.prepare',{name:'Autumn address-reviewed mailing',channel:'mail'},{status:409})
  assert.equal(queued.error,'NCOA_PENDING');assert.equal(ncoa.length,0,'Preparing a pass sends no unreviewed mailing or immediate NCOA request')
  const tick=async()=>{const response=await h.mf.dispatchFetch(h.origin+'/cdn-cgi/local/scheduled?time='+Date.now()+'&format=json');assert.equal(response.status,200,await response.text())}
  await tick();await tick()
  assert.equal(ncoa.length,1,'The actual minute scheduler processes this pass once')
  assert.equal((await h.get('/api/coffer/addresses')).runs[0].state,'completed')
  history=await h.get('/api/coffer/donors/'+maya.id)
  assert.equal(history.donor.region,'NY');assert.equal(history.donor.address_line1,'9 MOVER ST')
  const move=await getAddress(maya.id)
  assert.equal(move.check.source,'ncoa');assert.equal(move.check.move_effective_month,'2026-09')
  assert.ok(move.history.some(r=>r.region==='IL'&&r.source==='ncoa'),'The mover retains the original Illinois address with NCOA provenance')
  assert.equal((await getAddress(undeliverable.id)).check.status,'undeliverable')
  const report=await h.get('/api/coffer/reports/states?year=2025');assert.equal(report.rows.find(r=>r.state==='IL').amountCents,10000);assert.ok(!report.rows.some(r=>r.state==='NY'),'Earlier gifts remain in the earlier state')
  const appeal=await prepare();assert.equal(appeal.recipients,1);assert.equal(appeal.excluded['undeliverable address'],1)
  await h.command('appeal.approve',{appealId:appeal.id,version:1})
  // Re-verification invalidates a frozen check even if the address stays valid.
  await h.command('address.verify',{donorId:maya.id,version:history.donor.version})
  assert.equal((await h.command('appeal.export',{appealId:appeal.id,version:2},{status:409})).error,'ADDRESS_CHANGED')
  assert.equal((await h.get('/api/coffer/appeals/'+appeal.id)).addressChanged,true)
  await h.command('appeal.discard',{appealId:appeal.id,version:2})
  await h.command('address.queueNcoa');malformedNcoa=true;await tick();malformedNcoa=false
  assert.equal((await h.get('/api/coffer/addresses')).runs[0].state,'failed','A duplicate provider record ID refuses the whole batch')
  assert.equal((await h.get('/api/coffer/donors/'+maya.id)).donor.region,'NY')
  await h.command('address.queueNcoa');failNcoa=true;await tick();failNcoa=false
  assert.equal((await h.get('/api/coffer/addresses')).runs[0].state,'failed')
  const beforeRetry=ncoa.length;await tick();assert.equal(ncoa.length,beforeRetry,'A failed provider pass is not silently resubmitted')
  await h.command('address.queueNcoa');await tick()
  const approved=await prepare();await h.command('appeal.approve',{appealId:approved.id,version:1});await h.command('appeal.export',{appealId:approved.id,version:2})
  const file=await h.request('/api/coffer/appeals/'+approved.id+'/recipients.csv');assert.equal(file.status,200);assert.match(await file.text(),/9 MOVER ST/)
  const ownFile=await h.api('/api/coffer/donors/'+maya.id+'/data-request',{requestedOn:new Date().toISOString().slice(0,10),method:'email'})
  const ownText=JSON.stringify(ownFile);assert.ok(ownText.includes('ncoa')&&ownText.includes('9 MOVER ST'));assert.ok(!ownText.includes('Synthetic Address Rowan')&&!ownText.includes('synthetic-coffer-1000@example.test'),'The donor file contains their address records without other constituents')
  const backup=await archive(h)
  await run(async fresh=>{await restore(fresh,backup);assert.equal((await fresh.get('/api/coffer/donors/'+maya.id+'/addresses')).check.source,'ncoa');assert.equal((await fresh.get('/api/coffer/addresses')).connection.enabled,0)})
  if(process.env.COFFER_ADDRESS_BROWSER){
   const {mkdir}=await import('node:fs/promises');await mkdir(process.env.COFFER_ADDRESS_BROWSER,{recursive:true})
   const {withBrowserWorker}=await import('./browser-worker.mjs')
   await withBrowserWorker(h,async(context,origin)=>{
    const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1500});await page.goto(origin+'/app/addresses');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${process.env.COFFER_ADDRESS_BROWSER}/DONOR-009-passes-${width}.png`,fullPage:true})
     await page.goto(origin+'/app/donors/'+maya.id);await page.locator('#address-verification details').evaluate(el=>el.open=true);await page.locator('#address-verification').screenshot({path:`${process.env.COFFER_ADDRESS_BROWSER}/DONOR-009-move-${width}.png`})
     await page.goto(origin+'/app/donors/'+undeliverable.id);await page.locator('#address-verification').screenshot({path:`${process.env.COFFER_ADDRESS_BROWSER}/DONOR-009-undeliverable-${width}.png`})
     await page.goto(origin+'/app/appeals/'+approved.id);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${process.env.COFFER_ADDRESS_BROWSER}/DONOR-009-mail-${width}.png`,fullPage:true})
    }
   })
  }
  await h.command('donor.erase',{donorId:maya.id,confirm:'ERASE'})
  const erased=JSON.stringify(await archive(h));assert.ok(!erased.includes('Synthetic Address Maya')&&!erased.includes('9 MOVER ST'))
 },{triggerHandlers:true,bindings:{SMARTY_AUTH_ID:'synthetic-coffer-901',SMARTY_AUTH_TOKEN:'synthetic-coffer-902',MELISSA_SMARTMOVER_KEY:'synthetic-coffer-903'},outbound:edge})
}

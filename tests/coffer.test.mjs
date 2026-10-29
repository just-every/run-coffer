import {prepareVerifiedMail} from './verified-mail-edge.mjs'
import {organizationsJourney} from './organizations-journey.mjs'
import {stateReportJourney} from './state-report-journey.mjs'
import {attributionJourney} from './attribution-journey.mjs'
import {donorFileJourney} from './donor-file-journey.mjs'
import {timelineJourney} from './timeline-journey.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run,installation,archive,restore,stripe,imported,reviewed,donor,csvRows,settings} from './harness.mjs'
import {ackBrowser} from './ack-browser.mjs'
import {mcpJourney} from './mcp-journey.mjs'

test('DONOR-014 / DONOR-002: organizations retain their own gifts, two named contacts, addressed receipts and state attribution',organizationsJourney)

test('API-004: MCP donor context and preparation retain native keys and human approval',mcpJourney)

const agentOf=async h=>{const key=await h.command('agent.create',{label:'Letters assistant'});return {key,as:{as:'',headers:{authorization:`Bearer ${key.token}`}}}}
const consent=(h,donorIds,channel='email',status='granted',options={})=>h.command('consent.record',{donorIds,channel,status,method:'paper form',evidence:'Ticked the newsletter box on the gala RSVP card',capturedOn:'2026-03-14'},options)

test('sign-in, origin checks and every role boundary hold in the server handlers',()=>run(async h=>{
 await h.get('/api/coffer/donors',{as:'',status:401})
 await h.command('donor.create',{name:'Ana Diaz'},{headers:{origin:'https://elsewhere.test'},status:403})
 const member=await h.person('volunteer@example.test'),m={as:member.cookie}
 const ana=await donor(h,'Ana Diaz',{},m)
 await h.command('gift.record',{donorId:ana.id,amount:'300',receivedOn:'2026-09-01',method:'check',goods:'none'},m)
 await consent(h,[ana.id],'email','granted',m)
 for(const [command,input] of [['ack.prepare',{}],['appeal.prepare',{name:'Fall',channel:'email'}],['settings.update',settings],['agent.create',{label:'x'}],['donor.erase',{donorId:ana.id,confirm:'ERASE'}]])
  assert.equal((await h.command(command,input,{...m,status:403})).error.length>0,true,command)
 await h.api('/api/coffer/imports/preview',await stripe(),{...m,status:403})
 await h.api('/api/portability/exports',{},{...m,status:403})
 const {key,as}=await agentOf(h)
 assert.equal((await h.get('/api/coffer/donors',as)).total,1)
 for(const [command,input] of [['donor.create',{name:'Agent made'}],['gift.record',{donorId:ana.id,amount:'5',receivedOn:'2026-09-01',method:'cash',goods:'none'}],['consent.record',{donorIds:[ana.id],channel:'email',status:'granted',method:'other',evidence:'x',capturedOn:'2026-09-01'}],['ack.approve',{batchId:'x',version:1}],['agent.create',{label:'y'}]])
  await h.command(command,input,{...as,status:403})
 await h.request(`/app/letters/x/letters.csv`,{...as}).then(r=>assert.equal(r.status,403))
 await h.command('agent.revoke',{id:key.id})
 await h.get('/api/coffer/donors',{...as,status:401})
 await h.api('/auth/operator/status',{operatorId:member.id,status:'inactive'})
 await h.get('/api/coffer/donors',{...m,status:401})
}))

test('inherited dispatch names stay unknown without exposing Worker bindings',()=>run(async h=>{
 const reports='/api/coffer/agent/reports',member=await h.person('dispatch-member@example.test'),admin=await h.person('dispatch-admin@example.test','admin')
 const schedule=(await h.get(reports,{as:admin.cookie})).schedule
 const registered=await h.request(reports+'/schedule',{method:'POST',as:admin.cookie,body:{version:schedule.version,dayOfMonth:26,enabled:false}})
 assert.equal(registered.status,200,'A registered report action still works')
 assert.equal((await registered.json()).scheduled,true)
 for(const name of ['unknown-action','constructor','__proto__','hasOwnProperty']){
  const denied=await h.request(reports+'/'+name,{method:'POST',as:member.cookie,body:{}})
  assert.equal(denied.status,403,'Members retain the report role boundary')
  for(const prefix of [reports,'/app/agent/reports']){
   const payload=prefix===reports?{body:{}}:{headers:{'content-type':'application/x-www-form-urlencoded'},raw:''}
   const response=await h.request(prefix+'/'+name,{method:'POST',as:admin.cookie,...payload}),body=await response.text()
   // Only booleans and status codes enter assertion output, never response bodies.
   assert.equal(response.status,404,'Inherited and unknown report actions return 404')
   assert.equal(/SESSION_SECRET|SETUP_TOKEN|MAIL_API_KEY|synthetic-dispatch|"env"|"authority"|"db"/.test(body),false,'Report refusals contain no Worker context or bindings')
   if(prefix===reports)assert.equal(JSON.parse(body).error==='NOT_FOUND',true,'The API returns its unknown-action error')
  }
  const command=await h.request('/api/coffer/commands',{method:'POST',as:member.cookie,body:{command:name,input:{}}})
  assert.equal(command.status,400,'Inherited and unknown Coffer commands return 400')
  assert.equal((await command.json()).error==='COMMAND',true,'The command door returns its unknown-command error')
 }
},{bindings:{SESSION_SECRET:'synthetic-dispatch-session'.padEnd(32,'-'),MAIL_API_KEY:'synthetic-dispatch-mail'}}))

test('GIFT-001: gifts are exact integer-cent ledger lines; corrections are reversals',()=>run(async h=>{
 const ana=await donor(h,'Ana Diaz')
 const big=await h.command('gift.record',{donorId:ana.id,amount:'$1,250.50',receivedOn:'2026-09-01',method:'check',reference:'4471',goods:'none'})
 assert.equal(big.amountCents,125050)
 await h.command('gift.record',{donorId:ana.id,amountCents:4999,receivedOn:'2026-02-01',method:'card',goods:'provided',goodsValue:'60',goodsDescription:'Dinner'},{status:400})
 await h.command('gift.record',{donorId:ana.id,amount:250,receivedOn:'2026-09-01',method:'check',goods:'none'},{status:400})
 await h.command('gift.record',{donorId:ana.id,amount:'10.001',receivedOn:'2026-09-01',method:'check',goods:'none'},{status:400})
 await h.command('gift.record',{donorId:ana.id,amount:'10',receivedOn:'2099-01-01',method:'check',goods:'none'},{status:400})
 await h.command('gift.record',{donorId:ana.id,amount:'5',receivedOn:'2026-09-02',method:'check',reference:'4471',goods:'none'},{status:409})
 await h.command('gift.record',{donorId:ana.id,amountCents:4999,receivedOn:'2025-12-31',method:'card',goods:'none'})
 await h.command('gift.reverse',{giftId:big.id,reason:'Check returned unpaid'})
 assert.equal((await h.command('gift.reverse',{giftId:big.id,reason:'again'},{status:409})).error,'ALREADY_REVERSED')
 const history=await h.get(`/api/coffer/donors/${ana.id}`)
 assert.equal(history.gifts.length,3)
 assert.equal(history.totals.lifetimeCents,4999)
 assert.deepEqual(history.totals.byYear,[{year:'2026',cents:0},{year:'2025',cents:4999}])
 assert.equal(history.gifts.find(g=>g.kind==='reversal').amount_cents,-125050)
 assert.equal((await h.get('/api/coffer/letters')).due.length,0)
}))

test('ACK-001: an agent prepares frozen letters, a person approves, exports and records each gift acknowledged by letter',()=>run(async h=>{
 const {as}=await agentOf(h)
 const ana=await donor(h,'Ana Diaz'),ben=await donor(h,'Ben Cole')
 const gift=await h.command('gift.record',{donorId:ana.id,amount:'250',receivedOn:'2026-09-20',method:'check',goods:'none'})
 await h.command('gift.record',{donorId:ben.id,amount:'500',receivedOn:'2026-09-21',method:'card',goods:'provided',goodsValue:'120',goodsDescription:'two gala dinner tickets'})
 await h.command('gift.record',{donorId:ben.id,amount:'249.99',receivedOn:'2026-09-21',method:'card',goods:'none'})
 assert.equal((await h.command('ack.prepare',{},{...as,status:409})).error,'SETTINGS_UNREVIEWED')
 assert.equal((await h.command('settings.update',{...settings,letterTemplate:'Dear {{donor_name}}, thanks.',version:1},{status:400})).error,'TEMPLATE')
 await reviewed(h)
 const due=await h.get('/api/coffer/letters');assert.equal(due.due.length,2)
 const waiting=due.due.find(g=>g.id===gift.id),deadline=new Date(waiting.received_on+'T00:00:00Z');deadline.setUTCDate(deadline.getUTCDate()+(await h.get('/api/coffer/settings')).target_days)
 assert.equal(waiting.due_on,deadline.toISOString().slice(0,10));assert.equal(waiting.overdue,due.today>waiting.due_on)
 const batch=await h.command('ack.prepare',{},as)
 assert.equal(batch.letters,2);assert.equal(batch.totalCents,75000)
 const frozen=await h.get(`/api/coffer/letters/${batch.id}`)
 await h.command('settings.update',{...settings,organisation:'Riverbend Literacy Foundation',version:(await h.get('/api/coffer/settings')).version})
 assert.deepEqual((await h.get(`/api/coffer/letters/${batch.id}`)).letters,frozen.letters)
 assert.equal((await h.command('ack.approve',{batchId:batch.id,version:1},{...as,status:403})).error,'FORBIDDEN')
 await h.command('ack.export',{batchId:batch.id,version:1},{status:409})
 await h.command('gift.reverse',{giftId:gift.id,reason:'x'},{status:409})
 const approved=await h.command('ack.approve',{batchId:batch.id,version:1})
 const detail=await h.get(`/api/coffer/letters/${batch.id}`)
 assert.equal(detail.approval.prepared_by_role,'agent');assert.equal(detail.approval.approved_by_role,'owner');assert.equal(detail.approval.content_hash,batch.contentHash)
 const exported=await h.command('ack.export',{batchId:batch.id,version:approved.version})
 assert.deepEqual(await h.command('ack.export',{batchId:batch.id,version:exported.version}),{id:batch.id,version:exported.version,status:'exported',exportHash:exported.exportHash})
 const file=await h.request(`/app/letters/${batch.id}/letters.csv`);assert.equal(file.status,200,file.headers.get('location')+await file.clone().text())
 const text=await file.text(),rows=csvRows(text)
 assert.equal(rows.length,3)
 assert.match(text,/Dear Ana Diaz,\n\nThank you for your gift of \$250\.00 on September 20, 2026 to Riverbend Literacy Project\.\n\nNo goods or services were provided/)
 assert.match(text,/You received two gala dinner tickets worth \$120\.00; \$380\.00 may be deductible\./)
 await h.command('ack.markSent',{batchId:batch.id,version:exported.version,sentOn:'2099-01-01',method:'mail'},{status:400})
 const today=new Date().toISOString().slice(0,10),sentOn=exported.exportHash&&new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date())
 const sent=await h.command('ack.markSent',{batchId:batch.id,version:exported.version,sentOn,method:'mail'})
 await h.command('ack.send',{batchId:batch.id,version:sent.version},{status:409})
 const history=await h.get(`/api/coffer/donors/${ana.id}`)
 assert.equal(history.gifts[0].acknowledgment.status,'acknowledged');assert.equal(history.gifts[0].acknowledgment.method,'letter');assert.equal(history.gifts[0].acknowledgment.acknowledged_on,sentOn);assert.equal(history.gifts[0].acknowledgment.batch_id,batch.id);assert.equal(history.gifts[0].acknowledgment.letter_id,detail.letters.find(l=>l.gift_id===gift.id).id)
 assert.equal(history.gifts[0].ack_status,'sent');assert.equal(history.letters[0].sent_on,sentOn);assert.ok(today)
 assert.equal((await h.get('/api/coffer/letters')).due.length,0)
 assert.deepEqual((await h.get(`/api/coffer/letters/${batch.id}`)).events.map(e=>e.action),['ack.prepare','ack.approve','ack.export','ack.markSent'])
 const backup=await archive(h),fresh=await installation()
 try {
  await restore(fresh,backup)
  assert.deepEqual((await fresh.get(`/api/coffer/donors/${ana.id}`)).gifts[0].acknowledgment,history.gifts[0].acknowledgment)
 }finally{await fresh.close()}
 if(process.env.COFFER_ACK_BROWSER)await ackBrowser(h,process.env.COFFER_ACK_BROWSER)
 const erased=await h.command('donor.erase',{donorId:ana.id,confirm:'ERASE'})
 const anonymous=(await h.get(`/api/coffer/donors/${erased.donorId}`)).gifts[0].acknowledgment
 assert.equal(anonymous.status,'acknowledged');assert.equal(anonymous.acknowledged_on,sentOn);assert.equal(anonymous.method,'letter')
 assert.equal(anonymous.link,null);assert.equal(anonymous.batch_id,null);assert.equal(anonymous.letter_id,null);assert.equal(anonymous.reason,null)
}))

test('an appeal reaches only donors with current consent, and a withdrawal stops it',()=>run(async h=>{
 const {as}=await agentOf(h)
 const ana=await donor(h,'Ana Diaz'),ben=await donor(h,'Ben Cole'),cy=await donor(h,'Cy Park'),dee=await donor(h,'Dee Moss',{email:null})
 await consent(h,[ana.id,ben.id,dee.id]);await consent(h,[ben.id],'email','withdrawn')
 await consent(h,[cy.id],'mail')
 const appeal=await h.command('appeal.prepare',{name:'Fall 2026 appeal',channel:'email'},as)
 assert.equal(appeal.recipients,1)
 assert.deepEqual(appeal.excluded,{'no consent recorded':1,'consent withdrawn':1,'no email address':1,'no postal address':0})
 await h.command('appeal.approve',{appealId:appeal.id,version:1},{...as,status:403})
 await consent(h,[ana.id],'email','withdrawn')
 assert.equal((await h.command('appeal.approve',{appealId:appeal.id,version:1},{status:409})).error,'CONSENT_CHANGED')
 await h.command('appeal.discard',{appealId:appeal.id,version:1})
 assert.equal((await h.command('appeal.prepare',{name:'Fall 2026 appeal',channel:'email'},{status:409})).error,'NO_RECIPIENTS')
 await consent(h,[ana.id],'email','granted')
 const again=await h.command('appeal.prepare',{name:'Fall 2026 appeal',channel:'email'})
 let v=(await h.command('appeal.approve',{appealId:again.id,version:1})).version
 v=(await h.command('appeal.export',{appealId:again.id,version:v})).version
 const file=await (await h.request(`/app/appeals/${again.id}/recipients.csv`)).text()
 assert.deepEqual(csvRows(file),['name,email','Ana Diaz,ana.diaz@example.org'])
 const sentOn=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date())
 await h.command('appeal.markSent',{appealId:again.id,version:v,sentOn})
 const history=await h.get(`/api/coffer/donors/${ana.id}`)
 assert.deepEqual(history.appeals.map(a=>[a.name,a.status]),[['Fall 2026 appeal','sent']])
 assert.equal((await h.get(`/api/coffer/donors/${ben.id}`)).appeals.length,0)
 await prepareVerifiedMail(h)
 const mail=await h.command('appeal.prepare',{name:'Postcard',channel:'mail'});assert.equal(mail.recipients,1)
},{verifiedMail:true}))

test('IMPORT-001: saved Stripe refunds, every duplicate row, dry run, exact review, journal and undo',()=>run(async h=>{
 const input={...await stripe(),noGoodsOrServices:false}
 const charges=input.charges.flatMap(page=>page.data)
 Object.assign(charges.find(charge=>charge.amount_refunded===10000),{amount:10000,amount_refunded:2500})
 Object.assign(charges.find(charge=>charge.amount_refunded===20000),{amount:10000,amount_refunded:10000})
 const repeated=structuredClone(input)
 repeated.customers[0].data.push(structuredClone(input.customers[0].data[0]))
 repeated.charges[1].data.push(structuredClone(charges[0]),structuredClone(charges[1]))
 const duplicates=await h.api('/api/coffer/imports/preview',repeated,{status:409})
 assert.equal(duplicates.error,'IMPORT_DUPLICATE_ID')
 const repeatedIds=[input.customers[0].data[0].id,charges[0].id,charges[1].id]
 assert.deepEqual([...new Set(duplicates.details.map(d=>d.sourceId))].sort(),repeatedIds.sort())
 assert.equal(duplicates.details.length,6)
 for(const row of duplicates.details){assert.ok(row.artifact&&row.row>0);assert.ok(duplicates.message.includes(row.sourceId)&&duplicates.message.includes('row '+row.row))}
 assert.equal((await h.get('/api/coffer/donors')).total,0)
 assert.match(await (await h.request('/app/move-in')).text(),/Nothing imported yet/)
 const plan=await h.api('/api/coffer/imports/preview',input)
 assert.equal((await h.get('/api/coffer/donors')).total,0)
 assert.equal(plan.donors.length,8);assert.equal(plan.gifts.length,16)
 assert.deepEqual(plan.skipped.map(s=>s.reason).sort(),['No matching donor. Include its Stripe customer, or add the donor with this email in Coffer first.','Not a successful payment.','Not in US dollars.'])
 const byRef=Object.fromEntries(plan.gifts.map(g=>[g.reference,g]))
 assert.equal(plan.gifts.reduce((n,g)=>n+g.netCents,0),1345000)
 const partial=plan.gifts.find(g=>g.note==='Summer reading sponsor'),full=plan.gifts.find(g=>g.status==='refunded')
 assert.deepEqual([partial.amountCents,partial.grossCents,partial.refundedCents,partial.netCents,partial.status],[7500,10000,2500,7500,'partially_refunded'])
 assert.deepEqual([full.grossCents,full.refundedCents,full.netCents,full.status],[10000,10000,0,'refunded'])
 const page=await h.request('/app/move-in/preview',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({customers:JSON.stringify(input.customers),charges:JSON.stringify(input.charges)}).toString()})
 assert.equal(page.status,200);assert.match(await page.text(),/Gross[\s\S]*Refunded[\s\S]*Net[\s\S]*Partially refunded/)
 assert.equal(Object.values(byRef).find(g=>g.amountCents===100000).receivedOn,'2025-12-31')
 assert.equal(new Set(plan.gifts.filter(g=>g.note==='Monthly gift'||g.note==='Gift in memory of Ruth Okafor').map(g=>g.donorId)).size,2)
 await h.api('/api/coffer/imports/apply',{...input,fingerprint:'0'.repeat(64)},{status:409})
 let job=await h.api('/api/coffer/imports/apply',{...input,fingerprint:plan.fingerprint})
 while(job.state!=='completed')job=await h.api('/api/coffer/imports/resume',{id:job.id})
 assert.equal((await h.api('/api/coffer/imports/apply',{...input,fingerprint:plan.fingerprint})).id,job.id)
 const journal=await h.api('/api/coffer/imports/journal?id='+job.id)
 assert.equal(journal.originals.length,3);assert.ok(journal.batches.length)
 assert.deepEqual(journal.totals,{expectedCount:16,expectedCents:1345000,actualCount:16,actualCents:1345000,matches:true})
 const retained=journal.plan.entries.flatMap(entry=>entry.effects).map(effect=>effect.value)
 for(const gift of [partial,full])assert.deepEqual(retained.find(value=>value.id===gift.id),gift)
 for(const original of journal.originals){assert.equal(original.original.status,'retained');assert.deepEqual(JSON.parse(Buffer.from(original.original.base64,'base64')),original.name.includes('customers')?input.customers[0]:input.charges[Number(original.name.match(/(\d+)\.json/)[1])-1])}
 const fullHistory=await h.get('/api/coffer/donors/'+full.donorId)
 assert.equal(fullHistory.gifts.find(g=>g.reverses===full.id).amount_cents,-10000)
 const donors=await h.get('/api/coffer/donors');assert.equal(donors.total,8)
 const priya=donors.donors.find(d=>d.name==='Priya Shah');assert.equal(priya.total_cents,60000)
 assert.equal((await h.get('/api/coffer/letters')).due.filter(g=>g.goods==='unknown').length,9)
 const already=await h.api('/api/coffer/imports/preview',input,{status:409})
 assert.equal(already.error,'IMPORT_DUPLICATE_ID')
 const importedIds=[...plan.donors.map(d=>d.sourceRef),...plan.gifts.map(g=>g.reference)].sort()
 assert.deepEqual(already.details.map(d=>d.sourceId).sort(),importedIds)
 for(const row of already.details)assert.ok(already.message.includes(row.sourceId)&&already.message.includes('row '+row.row))
 assert.equal((await h.get('/api/coffer/donors')).total,8)
 const invalidRefund=structuredClone(input);invalidRefund.charges[0].data[0].id='ch_invalidRefund';invalidRefund.charges[0].data[0].amount_refunded=invalidRefund.charges[0].data[0].amount+1
 invalidRefund.customers=[];invalidRefund.charges=[{object:'list',data:[invalidRefund.charges[0].data[0]]}]
 await h.api('/api/coffer/imports/preview',invalidRefund,{status:400})
 let undone=await h.api('/api/coffer/imports/undo',{id:job.id})
 while(undone.state!=='undone')undone=await h.api('/api/coffer/imports/undo',{id:job.id})
 assert.equal((await h.get('/api/coffer/donors')).total,0)
 const freshPlan=await h.api('/api/coffer/imports/preview',input)
 let freshJob=await h.api('/api/coffer/imports/apply',{...input,fingerprint:freshPlan.fingerprint})
 while(freshJob.state!=='completed')freshJob=await h.api('/api/coffer/imports/resume',{id:freshJob.id})
 assert.notEqual(freshJob.id,job.id)
 assert.equal((await h.api('/api/coffer/imports/apply',{...input,fingerprint:freshPlan.fingerprint})).id,freshJob.id)
 let freshUndo=await h.api('/api/coffer/imports/undo',{id:freshJob.id})
 while(freshUndo.state!=='undone')freshUndo=await h.api('/api/coffer/imports/undo',{id:freshJob.id})
 assert.equal((await h.get('/api/coffer/donors')).total,0)
 if(process.env.COFFER_IMPORT_BROWSER){const {importRefundsBrowser}=await import('./import-refunds-journey.mjs');await importRefundsBrowser(h,input,process.env.COFFER_IMPORT_BROWSER)}
}))

test('IMPORT-001: undo stops at an imported donor a person has since built on',()=>run(async h=>{
 const {job}=await imported(h)
 const mayas=(await h.get('/api/coffer/donors?q=maya')).donors
 assert.deepEqual(mayas.map(d=>d.total_cents).sort((a,b)=>a-b),[20000,40000],'Distinct Stripe customers keep separate histories until reviewed')
 const maya=mayas[0],before=maya.total_cents
 await consent(h,[maya.id])
 let failed=await h.api('/api/coffer/imports/undo',{id:job.id},{status:409})
 for(let i=0;i<5&&failed.state;i++)failed=await h.api('/api/coffer/imports/undo',{id:job.id},{status:409})
 assert.ok(failed.error)
 const history=await h.get(`/api/coffer/donors/${maya.id}`)
 assert.equal(history.consents.length,1);assert.equal(history.totals.lifetimeCents,before)
}))

test('REPORT-006: connected Stripe move-in follows pages, previews monthly plans, checks actual totals and undoes without writing Stripe', async()=>{
 const created=Date.UTC(2026,0,2)/1000, calls=[]
 const customer={id:'cus_direct',name:'Ada Rivera',email:'ada@example.org',created}
 const charges=Array.from({length:101},(_,i)=>({id:`ch_direct${i}`,customer:customer.id,status:'succeeded',paid:true,currency:'usd',amount:2500,created,amount_refunded:i===0?500:0}))
 const sub={id:'sub_direct',customer:customer.id,created,status:'active',currency:'usd',cancel_at_period_end:false,items:{data:[{quantity:1,price:{type:'recurring',currency:'usd',unit_amount:2500,billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]}}
 const h=await installation({bindings:{STRIPE_SECRET_KEY:'sk_test_network_edge'},outbound:async request=>{
  const u=new URL(request.url);assert.equal(u.hostname,'api.stripe.com');assert.equal(request.method,'GET');calls.push(u)
  assert.equal(request.headers.get('authorization'),'Bearer sk_test_network_edge')
  let data=[]
  if(u.pathname==='/v1/customers/cus_direct')return Response.json(customer)
  if(u.pathname==='/v1/charges'){
   const after=u.searchParams.get('starting_after');data=after?charges.slice(100):charges.slice(0,100)
   return Response.json({object:'list',data,has_more:!after})
  }
  if(u.pathname==='/v1/invoice_payments')data=[]
  else if(u.pathname==='/v1/subscriptions')data=[sub]
  else if(u.pathname==='/v1/payment_intents')data=[{id:'pi_direct',created,status:'succeeded',latest_charge:'ch_direct0',amount:2500,currency:'usd',customer:customer.id,client_secret:'must-not-reach-review'}]
  else if(u.pathname==='/v1/invoices')data=[{id:'in_direct',created,status:'paid',amount_paid:2500,currency:'usd',customer:customer.id,parent:{subscription_details:{subscription:sub.id}}}]
  else assert.fail('Unexpected Stripe endpoint '+u.pathname)
  return Response.json({object:'list',data,has_more:false})
 }})
 try{
  await h.api('/api/coffer/imports/read-stripe',{start:'2026-01-01',end:'2026-01-31'},{as:'',status:401})
  const review=await h.api('/api/coffer/imports/read-stripe',{start:'2026-01-01',end:'2026-01-31',noGoodsOrServices:true})
  assert.equal(review.donors.length,1);assert.equal(review.gifts.length,101);assert.equal(review.subscriptions.length,1)
  assert.equal(review.gifts.reduce((n,g)=>n+g.amountCents,0),252000)
  assert.ok(calls.some(u=>u.searchParams.has('starting_after')))
  assert.ok(!JSON.stringify(review).includes('must-not-reach-review'))
  assert.equal((await h.get('/api/coffer/donors')).total,0)
  let job=await h.api('/api/coffer/imports/apply',{...review.input,fingerprint:review.fingerprint})
  while(job.state!=='completed')job=await h.api('/api/coffer/imports/resume',{id:job.id})
  const journal=await h.get('/api/coffer/imports/journal?id='+job.id)
  assert.deepEqual(journal.totals,{expectedCount:101,expectedCents:252000,actualCount:101,actualCents:252000,matches:true})
  const d=(await h.get('/api/coffer/donors')).donors[0]
  const detail=await h.get('/api/coffer/donors/'+d.id)
  assert.deepEqual(detail.subscriptions.map(s=>[s.id,s.amount_cents,s.status]),[['sub_direct',2500,'active']])
  const health=await h.get('/api/coffer/reports/recurring?from=2026-01')
  assert.equal(health.rows[0].newPlans,1)
  assert.equal(health.rows.at(-1).activeDonors,1)
  assert.equal(health.rows.at(-1).mrrCents,2500)
  assert.equal(health.rows[0].unknownStatePlans,1,'Import does not invent earlier monthly state')
  charges.push({...charges[1],id:'ch_direct101'})
  const next=await h.api('/api/coffer/imports/read-stripe',{start:'2026-01-01',end:'2026-01-31'})
  assert.equal(next.gifts.length,1);assert.equal(next.donors.length,0)
  assert.equal(next.skipped.filter(row=>row.kind==='charge').length,101)
  const tampered=structuredClone(next.input);tampered.charges[0].data.at(-1).amount=3000
  assert.equal((await h.api('/api/coffer/imports/preview',tampered,{status:409})).error,'IMPORT_DUPLICATE_ID')
  const malformed=structuredClone(next.input);malformed.invoices={object:'list',data:[]}
  assert.equal((await h.api('/api/coffer/imports/preview',malformed,{status:409})).error,'IMPORT_DUPLICATE_ID')
  const saved=structuredClone(next.input)
  for(const pages of Object.values(saved))if(Array.isArray(pages))for(const page of pages)delete page.cofferLiveReview
  assert.equal((await h.api('/api/coffer/imports/preview',saved,{status:409})).error,'IMPORT_DUPLICATE_ID')
  let undo=await h.api('/api/coffer/imports/undo',{id:job.id})
  while(undo.state!=='undone')undo=await h.api('/api/coffer/imports/undo',{id:job.id})
  assert.ok((await h.get('/api/coffer/reports/recurring?from=2026-01')).rows.every(r=>r.newPlans===0&&r.activeDonors===0))
  assert.equal((await h.get('/api/coffer/donors')).total,0)
  const db=await h.mf.getD1Database('DB')
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM cf_subscriptions').first()).n,0)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM cf_campaigns').first()).n,0)
 }finally{await h.close()}
})

test('backup restores donors, gifts, consent, approvals and import custody into an empty installation only',()=>run(async h=>{
 const {job}=await imported(h);await reviewed(h)
 const maya=(await h.get('/api/coffer/donors?q=maya')).donors[0];await consent(h,[maya.id])
 const batch=await h.command('ack.prepare',{});await h.command('ack.approve',{batchId:batch.id,version:1})
 const backup=await archive(h),fresh=await installation()
 try {
  await restore(fresh,backup)
  assert.deepEqual(await fresh.get('/api/coffer/donors'),await h.get('/api/coffer/donors'))
  assert.deepEqual(await fresh.get(`/api/coffer/donors/${maya.id}`),await h.get(`/api/coffer/donors/${maya.id}`))
  assert.equal((await fresh.get(`/api/coffer/letters/${batch.id}`)).approval.content_hash,batch.contentHash)
  assert.equal((await fresh.api('/api/coffer/imports/journal?id='+job.id)).originals.length,3)
  assert.ok((await restore(fresh,backup,{status:409})).error)
 } finally { await fresh.close() }
}))

test('erasing a donor removes their personal data and Stripe originals but keeps anonymous gifts',()=>run(async h=>{
 const {job,input}=await imported(h);await reviewed(h)
 const matches=(await h.get('/api/coffer/donors?q=maya')).donors;assert.equal(matches.length,2,'Distinct source identities wait for staff review')
 const maya=matches[0],source=matches[1],targetHistory=await h.get('/api/coffer/donors/'+maya.id),sourceHistory=await h.get('/api/coffer/donors/'+source.id)
 await h.command('donor.merge',{sourceDonorId:source.id,sourceVersion:sourceHistory.donor.version,donorId:maya.id,version:targetHistory.donor.version,reason:'duplicate_record'})
 const before=(await h.get('/api/coffer/donors/'+maya.id)).totals.lifetimeCents;assert.equal(before,60000)
 await consent(h,[maya.id])
 const batch=await h.command('ack.prepare',{});const old=await archive(h)
 const admin=await h.person('admin@example.test','admin')
 await h.command('donor.erase',{donorId:maya.id,confirm:'ERASE'},{as:admin.cookie,status:403})
 await h.command('donor.erase',{donorId:maya.id,confirm:'yes'},{status:400})
 const erased=await h.command('donor.erase',{donorId:maya.id,confirm:'ERASE'})
 const history=await h.get(`/api/coffer/donors/${erased.donorId}`)
 await h.get(`/api/coffer/donors/${maya.id}`,{status:404})
 assert.equal(history.donor.name,'Erased donor');assert.equal(history.donor.email,null);assert.equal(history.consents.length,0)
 assert.equal(history.totals.lifetimeCents,before);assert.ok(history.gifts.every(g=>g.note===null))
 const letters=(await h.get(`/api/coffer/letters/${batch.id}`)).letters.filter(l=>l.donor_id===erased.donorId)
 assert.ok(letters.length&&letters.every(l=>l.body==='[erased]'&&l.recipient_name==='Erased donor'))
 assert.equal((await h.command('ack.approve',{batchId:batch.id,version:1},{status:409})).error,'CONTENT_CHANGED')
 const journal=await h.api('/api/coffer/imports/journal?id='+job.id)
 assert.ok(journal.originals.length===3&&journal.originals.every(o=>o.original.status==='unavailable'))
 assert.ok(!JSON.stringify(journal).toLowerCase().includes('okafor'))
 const erasedOnly=structuredClone(input)
 erasedOnly.customers[0].data=erasedOnly.customers[0].data.filter(c=>['cus_RbLp0001','cus_RbLp0007'].includes(c.id))
 erasedOnly.charges=[{object:'list',data:[{...input.charges[0].data[0],id:'ch_afterErasure',customer:'cus_RbLp0001',billing_details:{email:'maya.okafor@example.org'}}]}]
 const again=await h.api('/api/coffer/imports/preview',erasedOnly,{status:409})
 assert.deepEqual(again.details.filter(s=>s.reason.startsWith('Belongs to a donor erased')).map(s=>s.sourceId).sort(),['ch_afterErasure','cus_RbLp0001','cus_RbLp0007'])
 const later=await archive(h),fresh=await installation()
 try { assert.ok((await restore(fresh,old,{status:400,laterJournal:{sourceIdentity:later[0].sourceIdentity,epoch:later[0].epoch,journal:later[0].journal}})).error) } finally { await fresh.close() }
}))

test('a donor entered by hand is erased before any import exists',()=>run(async h=>{
 const ana=await donor(h,'Ana Diaz');await consent(h,[ana.id])
 await h.command('gift.record',{donorId:ana.id,amount:'40',receivedOn:'2026-09-01',method:'cash',goods:'none',note:'Handed over by Ana at the book fair'})
 const erased=await h.command('donor.erase',{donorId:ana.id,confirm:'ERASE'})
 const history=await h.get(`/api/coffer/donors/${erased.donorId}`)
 assert.equal(history.donor.erased_at.length>0,true);assert.equal(history.gifts[0].note,null);assert.equal(history.totals.lifetimeCents,4000)
 await h.command('donor.erase',{donorId:ana.id,confirm:'ERASE'},{status:404})
 await h.command('donor.erase',{donorId:erased.donorId,confirm:'ERASE'},{status:404})
}))

test('DONOR-004: fast role-scoped timeline logging, complete current activity and inclusive filters',timelineJourney)
test('DATA-003: a donor’s own file holds every record type for them and nobody else, and the request is logged',donorFileJourney)
test('REPORT-008: giving by state assigns each gift to the address on its date and sums to the ledger',stateReportJourney)
test('GIFT-003: entry, a tracked-link form and a CRM import attribute gifts to funds, a campaign, appeals and channels whose totals sum to the ledger',attributionJourney)

test('DATA-002: live unpaged list exports reconcile all record types and protect custody',async()=>{const {exportsJourney}=await import('./exports-journey.mjs');await exportsJourney()})

test('GIFT-002: keyboard check batches balance once, preserve defaults and legacy lookup, and create a searchable deposit',async()=>{const {giftBatchesJourney}=await import('./gift-batches-journey.mjs');await giftBatchesJourney()})

test('DONOR-015: SMS asks honor restrictions while approved thank-yous and pledge reminders retain consent, quiet hours and STOP',async()=>{const {smsJourney}=await import('./sms-journey.mjs');await smsJourney()})

test('DONOR-015: incumbent restrictions retain source meaning, previews, reconciliation and undo across current CRM doors',async()=>{const {solicitationImportJourney}=await import('./solicitation-import-journey.mjs');await solicitationImportJourney()})

test('STEW-005: reviewed rules act once on live gifts and never on historical imports',async()=>{const {giftRulesJourney}=await import('./gift-rules-journey.mjs');await giftRulesJourney()})

test('DONOR-015: ask restrictions preserve transactional contact and deliberate audited exceptions',async()=>{const {solicitationJourney}=await import('./solicitation-journey.mjs');await solicitationJourney()})

test('GIFT-010: typed stock, DAF and IRA gifts preserve credit, receipt custody and tax-report totals',async()=>{const {contributionTypesJourney}=await import('./contribution-types-journey.mjs');await contributionTypesJourney()})

test('DONOR-009: verified entry and licensed scheduled address passes preserve moves and exclude undeliverable mail',async()=>{const {addressVerificationJourney}=await import('./state-report-journey.mjs');await addressVerificationJourney()})

test('DONOR-007: saved giving and consent lists stay live in appeals, retention and exports; audited bulk tags and managers undo atomically',async()=>{const {savedListsJourney}=await import('./saved-lists-journey.mjs');await savedListsJourney()})

test('DONOR-013: typed contact points, atomic primary receipts, all-contact lookup, household consent and custody',async()=>{const {contactPointsJourney}=await import('./contact-points-journey.mjs');await contactPointsJourney()})


test('DONOR-005: typed records, live tag segments, exact gift grouping and pick-list renames keep their values',async()=>{const {customFieldsJourney}=await import('./custom-fields-journey.mjs');await customFieldsJourney()})

test('MOBILE-001: phone lookup, call, meeting, gift and tasks use direct actions with visible restrictions and every staff screen fits',async()=>{const {mobileJourney}=await import('./mobile-journey.mjs');await mobileJourney()})

test('DEV-012: named and preparation grants enforce scope, template approval, atomic limits and immediate stops through HTTP, MCP and scheduled jobs',async()=>{const {agentGrantsJourney}=await import('./agent-grants-journey.mjs');const {automationGrantsJourney}=await import('./automation-grants-journey.mjs');await agentGrantsJourney();await automationGrantsJourney()})

test('API-002: signed native events retain failed delivery attempts, backoff and explicit replay',async()=>{const {webhooksJourney}=await import('./webhooks-journey.mjs');await webhooksJourney()})

test('API-001: scoped versioned records enforce acknowledgment authority and atomic idempotency', async () => { const {restApiJourney}=await import('./rest-api-journey.mjs'); await restApiJourney() })

test('TEAM-001: native read-only restrictions preserve ordinary views and refuse mutations, disclosure and stale authority', async () => {
 const {teamAccessJourney}=await import('./team-access-journey.mjs')
 await teamAccessJourney()
})

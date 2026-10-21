import assert from 'node:assert/strict'
import {createHash,createHmac,generateKeyPairSync,randomUUID,sign} from 'node:crypto'
import {run,donor,reviewed,archive,restore,installation} from './harness.mjs'
import {exportsBrowser} from './exports-browser.mjs'

const types=['constituents','gifts','pledges','plans','consent','interactions','tasks','opportunities']
const key='synthetic-coffer-90',secret='synthetic-coffer-91',researchKey='synthetic-coffer-92'
const headers={'x-test-now':'2026-10-18T16:00:00Z'}

// Parse quoted records, including multiline notes and embedded JSON allocations.
function parseCsv(input){
 const rows=[],row=[];let field='',quoted=false
 for(let i=0;i<input.length;i++){
  const ch=input[i]
  if(ch==='"'){if(quoted&&input[i+1]==='"'){field+='"';i++}else quoted=!quoted}
  else if(ch===','&&!quoted){row.push(field);field=''}
  else if(ch==='\r'&&input[i+1]==='\n'&&!quoted){row.push(field);rows.push([...row]);row.length=0;field='';i++}
  else field+=ch
 }
 assert.equal(quoted,false,'CSV quotes are balanced')
 const [columns,...records]=rows
 return records.map(values=>Object.fromEntries(columns.map((column,i)=>[column,values[i]])))
}

async function download(h,type,query,options={}){
 const response=await h.request(`/api/coffer/exports/${type}.csv?${query}`,{...options,headers:{...headers,...options.headers}})
 const body=await response.text();assert.equal(response.status,200,`${type} export: ${body}`)
 const rows=parseCsv(body);assert.equal(Number(response.headers.get('x-coffer-row-count')),rows.length)
 assert.ok(Date.parse(response.headers.get('x-coffer-as-of')))
 return {response,body,rows}
}

export async function exportsJourney(){
 let intent='';const sent=[],keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
 const publicKey=keys.publicKey.export({type:'spki',format:'der'}).toString('base64')
 const outbound=async request=>{
  const url=new URL(request.url)
  if(url.origin==='https://api.sendgrid.com'){sent.push(await request.json());return new Response(null,{status:202,headers:{'x-message-id':'synthetic-coffer-89'}})}
  if(url.origin==='https://api.wealthengine.com'){
   const body=await request.json()
   if(url.pathname==='/v1/session/create')return Response.json({_id:'synthetic-coffer-93'},{status:201})
   return Response.json({id:94,client_id:body.client_id,locations:[],wealth:{wealth_score:{text:'synthetic-coffer-private-research',value:70}},giving:{gift_capacity:{text:'synthetic-coffer-private-capacity'}}})
  }
  assert.equal(url.origin,'https://api.stripe.com')
  if(url.pathname==='/v1/customers')return Response.json({id:'synthetic-coffer-95'})
  if(url.pathname==='/v1/checkout/sessions'){
   const params=new URLSearchParams(await request.text());intent=params.get('subscription_data[metadata][coffer_intent]')
   return Response.json({id:'synthetic-coffer-96',url:'https://checkout.stripe.com/c/pay/synthetic-coffer-96'})
  }
  if(url.pathname==='/v1/subscriptions/synthetic-coffer-97')return Response.json({id:'synthetic-coffer-97',customer:'synthetic-coffer-95',metadata:{coffer_intent:intent},status:'active',cancel_at_period_end:false,items:{data:[{quantity:1,price:{unit_amount:2501}}]}})
  const charge=url.pathname.match(/^\/v1\/charges\/synthetic-coffer-(204|205)$/)
  if(charge)return Response.json({id:`synthetic-coffer-${charge[1]}`,paid:true,status:'succeeded',amount:100,currency:'usd',created:1735732800,
   billing_details:{name:`${charge[1]==='204'?'\t':'\r'}synthetic-coffer-${charge[1]}`,email:`synthetic-coffer-${charge[1]}@example.test`}})
  assert.fail(`Unexpected export fixture network edge: ${url.pathname}`)
 }
 await run(async h=>{
  const get=(path,options={})=>h.get(path,{...options,headers:{...headers,...options.headers}})
  const command=(name,input={},options={})=>h.command(name,input,{...options,headers:{...headers,...options.headers}})
  const person=async(email,role='member')=>{
   const invited=await h.request('/app/people/invite',{method:'POST',headers:{...headers,'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({email,role,displayName:email.split('@')[0]}).toString()})
   assert.equal(invited.status,303,await invited.text())
   const message=sent.findLast(m=>m.personalizations.some(p=>p.to.some(to=>to.email===email)))
   const link=message.content.find(c=>c.type==='text/plain').value.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]
   const confirmed=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:new URL(link).searchParams.get('token')},headers})
   assert.equal(confirmed.status,303);const cookie=confirmed.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
   return {cookie,id:(await get('/auth/session',{as:cookie})).operator.id}
  }
  const provider=async(id,type,objectId)=>{
   const raw=JSON.stringify({id,type,data:{object:{id:objectId}}}),timestamp=Math.floor(Date.parse(headers['x-test-now'])/1000)
   const signature=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')
   const response=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{...headers,'stripe-signature':`t=${timestamp},v1=${signature}`}})
   assert.equal(response.status,200,await response.text())
  }
  const owner=(await get('/auth/session')).operator
  const main=await donor(h,'synthetic-coffer-1 target',{email:'synthetic-coffer-1@example.test'})
  const outside=await donor(h,'synthetic-coffer-2',{email:'synthetic-coffer-2@example.test'})
  const merged=await donor(h,'synthetic-coffer-3 target',{email:'synthetic-coffer-3@example.test'})
  const erased=await donor(h,'synthetic-coffer-4 target',{email:'synthetic-coffer-4@example.test'})
  const member=await person('synthetic-coffer-5@example.test'),admin=await person('synthetic-coffer-6@example.test','admin')
  const agent=await command('agent.create',{label:'synthetic-coffer-7'}),asAgent={as:'',headers:{authorization:`Bearer ${agent.token}`}}
  const save={name:'synthetic-coffer-8',filters:{q:'target'}}
  await command('list.save',save,{as:'',status:401});await command('list.save',save,{as:member.cookie,status:403});await command('list.save',save,{...asAgent,status:403})
  const list=await command('list.save',save,{as:admin.cookie}),query=new URLSearchParams({list:`saved:${list.id}`})
  assert.deepEqual((await get('/api/coffer/lists')).lists.find(l=>l.id===list.id).filters,{q:'target',relationship:'',relatedTo:'',volunteer:''})
  await command('list.save',{...save,listId:list.id,version:0},{status:400})
  const revised=await command('list.save',{...save,listId:list.id,version:1})
  await command('list.save',{...save,listId:list.id,version:1},{status:409})
  const gift=(d,amount,receivedOn='2025-01-01',extra={})=>command('gift.record',{donorId:d.id,amount,receivedOn,method:'check',goods:'none',...extra})
  const split=await gift(main,'123.45','2024-02-01',{allocations:[{fund:'synthetic-coffer-10',amountCents:10001},{fund:'synthetic-coffer-11',amountCents:2344}]})
  await gift(main,'300.01','2025-02-01')
  const reversed=await gift(main,'10.01','2025-03-01');await command('gift.reverse',{giftId:reversed.id,reason:'synthetic-coffer-12',reversedOn:'2025-03-02'})
  const otherGift=await gift(outside,'999.99');await command('softCredit.record',{giftId:otherGift.id,donorId:main.id,amount:'999.99'})
  await gift(merged,'7.89');await gift(erased,'8.88')
  const property=await command('inKind.save',{donorId:main.id,description:'synthetic-coffer-13 property',quantity:'1',statedValue:'900.09',receivedOn:'2023-01-01',goods:'none'})
  const pledge=await command('pledge.create',{donorId:main.id,amount:'100.03',pledgedOn:'2025-01-01',fund:'Unrestricted',installments:[{dueOn:'2026-11-01',amount:'100.03'}]})
  await command('consent.record',{donorIds:[main.id],channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-14',capturedOn:'2025-01-01'})
  await command('consent.record',{donorIds:[main.id],channel:'email',status:'withdrawn',method:'other',evidence:'synthetic-coffer-15',capturedOn:'2026-01-01'})
  await command('interaction.record',{donorId:main.id,kind:'meeting',occurredOn:'2025-01-01',notes:'synthetic-coffer-16, a quoted "meeting"\nand a second line',openQuestion:'synthetic-coffer-17'})
  await command('interaction.record',{donorId:main.id,kind:'note',occurredOn:'2025-01-01',notes:'synthetic-coffer-18 ordinary note'})
  for(const [d,note] of [[main,'synthetic-coffer-19 confidential'],[merged,'synthetic-coffer-20 confidential']])await command('interaction.record',{donorId:d.id,kind:'note',occurredOn:'2025-01-01',notes:note,confidential:true})
  await command('task.repeatCreate',{donorId:main.id,title:'synthetic-coffer-21',ownerId:owner.id,dueOn:'2026-11-01',intervalMonths:1})
  const opportunity=await command('prospect.save',{donorId:main.id,label:'synthetic-coffer-22',ownerId:owner.id,stage:'cultivate',askAmount:'500.03',expectedAmount:'400.03',probability:50,expectedCloseOn:'2026-12-01',nextStep:'synthetic-coffer-23'})
  const template=await command('cultivation.template',{name:'synthetic-coffer-24',steps:[{offsetDays:1,title:'synthetic-coffer-25'}]})
  await command('cultivation.apply',{prospectId:opportunity.id,templateId:template.id,templateVersion:template.version,startOn:'2026-10-18',ownerId:owner.id})
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'synthetic-coffer-26',slug:'synthetic-coffer-26',description:'synthetic-coffer-26',fund:'Unrestricted',goal:'1000'})
  const checkout=await h.request('/give/synthetic-coffer-26/checkout',{method:'POST',headers:{...headers,'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({name:'synthetic-coffer-1 target',email:'synthetic-coffer-1@example.test',amount:'25.01',frequency:'monthly',requestId:randomUUID()}).toString()})
  assert.equal(checkout.status,303,await checkout.text());assert.ok(intent)
  await provider('synthetic-coffer-27','customer.subscription.created','synthetic-coffer-97')
  // Saved Stripe history uses the provider's required source-ID grammar.
  const input={customers:[{object:'list',data:[{id:'cus_syntheticcoffer101',name:'synthetic-coffer-101 target',email:'synthetic-coffer-101@example.test',created:1735732800}]}],charges:[{object:'list',data:[{id:'ch_syntheticcoffer101',customer:'cus_syntheticcoffer101',paid:true,status:'succeeded',amount:10003,amount_refunded:2345,currency:'usd',created:1735732800}]}],noGoodsOrServices:true}
  const preview=await h.api('/api/coffer/imports/preview',input,{headers})
  let job=await h.api('/api/coffer/imports/apply',{...input,fingerprint:preview.fingerprint},{headers})
  while(job.state!=='completed')job=await h.api('/api/coffer/imports/resume',{id:job.id},{headers})
  await command('research.connect',{provider:'wealthengine',apiKey:researchKey});await command('research.screen',{donorIds:[main.id]})
  const comparison=await get(`/api/coffer/duplicates/compare?source=${merged.id}&target=${main.id}`)
  await command('donor.merge',{sourceDonorId:merged.id,donorId:main.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  await command('donor.erase',{donorId:erased.id,confirm:'ERASE'})
  const annualSource=(await get('/api/coffer/reports/annual-lapses?year=2026')).groups.find(g=>g.kind==='lybunt').rows.find(r=>r.donorId===main.id)
  await command('task.generate',{sourceKey:annualSource.sourceKey,ownerId:owner.id,dueOn:'2026-10-19'})
  await command('fund.define',{name:'synthetic-coffer-30',restriction:'purpose',detail:'synthetic-coffer-31'})
  let grant=await command('grant.save',{donorId:main.id,program:'synthetic-coffer-32',requestedAmount:'50.02',loiDueOn:'2026-09-01',proposalDueOn:'2026-10-01',reportDueOn:'2026-11-01'})
  for(const [status,recordedOn]of [['loi_submitted','2026-09-01'],['proposal_submitted','2026-10-01']])grant=await command('grant.status',{grantId:grant.id,version:grant.version,status,recordedOn,evidence:'synthetic-coffer-33'})
  await command('grant.award',{grantId:grant.id,version:grant.version,awardedOn:'2026-10-02',fund:'synthetic-coffer-30',awardAmount:'50.02',evidence:'synthetic-coffer-34',ownerId:owner.id,installments:[{dueOn:'2026-11-01',amount:'50.02'}]})
  await reviewed(h)
  const batch=await command('ack.prepare');await command('ack.approve',{batchId:batch.id,version:1});await command('ack.send',{batchId:batch.id,version:2})
  const letter=(await get(`/api/coffer/letters/${batch.id}`)).letters.find(l=>l.donor_id===main.id)
  assert.equal(letter.delivery_status,'submitted')
  const replied=await h.request('/test-email',{method:'POST',headers,body:{from:'synthetic-coffer-1@example.test',to:'synthetic-coffer-36@example.test',headers:{subject:`Re: ${letter.subject}`,'message-id':'<synthetic-coffer-37@example.test>'},raw:'Content-Type: text/plain; charset=utf-8\r\n\r\nsynthetic-coffer-38 thanks'}})
  assert.equal(replied.status,200,await replied.text());assert.equal((await get('/api/coffer/replies')).length,1)
  const stamp=String(Math.floor(Date.parse(headers['x-test-now'])/1000)),bounce=JSON.stringify([{event:'bounce',sg_event_id:'synthetic-coffer-35',timestamp:Number(stamp),coffer_letter_id:letter.id,coffer_attempt_id:letter.attempt_id}])
  const bounced=await h.request('/api/coffer/mail/events',{method:'POST',as:'',raw:bounce,headers:{...headers,'x-twilio-email-event-webhook-timestamp':stamp,'x-twilio-email-event-webhook-signature':sign('sha256',Buffer.from(stamp+bounce),keys.privateKey).toString('base64')}})
  assert.equal(bounced.status,200,await bounced.text())
  const initial=await download(h,'constituents',query)
  assert.ok(!initial.rows.some(r=>r.id===outside.id))
  const updated=await get('/api/coffer/donors/'+outside.id)
  await command('donor.update',{donorId:outside.id,version:updated.donor.version,name:'synthetic-coffer-2 target',email:'synthetic-coffer-2@example.test'})
  assert.equal((await download(h,'constituents',query)).rows.length,initial.rows.length+1,'Saved membership grows without editing its filter')
  const result={};const agentHash=createHash('sha256').update(agent.token).digest('hex')
  for(const type of types){
   const file=await download(h,type,query,{as:admin.cookie});result[type]=file.rows
   assert.equal(file.response.headers.get('x-coffer-withheld'),'2 confidential staff notes withheld')
   for(const excluded of [key,secret,researchKey,agent.token,agentHash,'token_hash','customer_id','payment_method','synthetic-coffer-private-research','synthetic-coffer-private-capacity','synthetic-coffer-19 confidential','synthetic-coffer-20 confidential',merged.id,erased.id])assert.ok(!file.body.includes(excluded),`${type} excludes ${excluded.startsWith('synthetic')?excluded:'private material'}`)
   await get(`/api/coffer/exports/${type}.csv?${query}`,{as:member.cookie,status:403})
   await get(`/api/coffer/exports/${type}.csv?${query}`,{...asAgent,status:403})
   await get(`/api/coffer/exports/${type}.csv?${query}`,{as:'',status:401})
  }
  const memberIds=result.constituents.map(r=>r.id),histories=await Promise.all(memberIds.map(id=>get('/api/coffer/donors/'+id)))
  assert.equal(result.gifts.reduce((sum,r)=>sum+Number(r.amount_cents),0),histories.reduce((sum,h)=>sum+h.totals.lifetimeCents,0))
  assert.equal(result.gifts.filter(r=>r.id===split.id).length,1)
  assert.deepEqual(JSON.parse(result.gifts.find(r=>r.id===split.id).allocations).map(a=>a.amount_cents),[10001,2344])
  assert.equal(result.gifts.find(r=>r.id===reversed.id).amount_cents,'0')
  assert.deepEqual(['amount_cents','stated_value_cents'].map(k=>result.gifts.find(r=>r.id===property.id)[k]),['0','90009'])
  assert.ok(result.gifts.some(r=>r.gross_cents==='10003'&&r.amount_cents==='7658'&&r.refunded_cents==='2345'))
  assert.equal(result.pledges.length,histories.reduce((n,h)=>n+h.pledges.length,0));assert.equal(result.pledges.find(r=>r.id===pledge.id).remaining_cents,'10003')
  assert.equal(result.plans.length,histories.reduce((n,h)=>n+h.subscriptions.length,0));assert.equal(result.plans[0].amount_cents,'2501')
  assert.equal(result.consent.length,histories.reduce((n,h)=>n+['email','mail'].filter(k=>h.current[k]).length,0));assert.equal(result.consent[0].status,'withdrawn')
  assert.equal(result.interactions.length,histories.reduce((n,h)=>n+h.depth.interactions.length+h.notes.filter(r=>!r.confidential).length,0))
  assert.ok(result.interactions.some(r=>r.notes==='synthetic-coffer-18 ordinary note'));assert.ok(result.interactions.some(r=>r.notes.includes('\nand a second line')))
  assert.equal(result.tasks.length,6);assert.deepEqual(result.tasks.map(r=>r.task_kind).sort(),['call','cultivation','grant','receipt_address','recurring','reply'])
  const taskIds=[...(await get('/api/coffer/tasks')).tasks,...await get('/api/coffer/recurring-tasks'),...(await get('/api/coffer/opportunities/'+opportunity.id)).tasks,...(await get('/api/coffer/grants')).grants.flatMap(g=>g.tasks),...(await get('/api/coffer/donors/'+main.id)).receiptTasks,...await get('/api/coffer/replies')].filter(t=>!t.donor_id||memberIds.includes(t.donor_id)).map(t=>t.id)
  assert.deepEqual(result.tasks.map(t=>t.id).sort(),taskIds.sort())
  assert.equal(result.opportunities.length,1);assert.equal(result.opportunities[0].weighted_cents,'20002')
  assert.equal(result.opportunities.length,(await get('/api/coffer/prospects')).filter(p=>memberIds.includes(p.donor_id)).length)
  const audits=await get('/api/coffer/audit?action=export.csv'),entries=audits.rows.filter(r=>r.subject_id===list.id)
  for(const type of types){const event=entries.find(r=>r.actor_role==='admin'&&JSON.parse(r.detail).recordType===type);assert.ok(event);const detail=JSON.parse(event.detail);assert.equal(detail.rowCount,result[type].length);assert.equal(detail.selection.version,revised.version);assert.equal(detail.statement,'2 confidential staff notes withheld');assert.ok(Date.parse(detail.asOf));assert.ok(!event.detail.includes('target'))}
  assert.equal((await get('/api/coffer/audit?action=donor.dataRequest')).total,0)
  for(const [i,prefix]of ['=','+','-','@'].entries())await donor(h,`${prefix}synthetic-coffer-${200+i}`,{email:`synthetic-coffer-${200+i}@example.test`})
  for(const n of [204,205])await provider(`synthetic-coffer-${n+2}`,'charge.succeeded',`synthetic-coffer-${n}`)
  const escaped=await download(h,'constituents','list=search&q=synthetic-coffer-20')
  for(const [i,prefix]of ['=','+','-','@'].entries())assert.equal(escaped.rows.find(r=>r.email===`synthetic-coffer-${200+i}@example.test`).name,`'${prefix}synthetic-coffer-${200+i}`)
  for(const [n,prefix]of [[204,'\t'],[205,'\r']])assert.equal(escaped.rows.find(r=>r.email===`synthetic-coffer-${n}@example.test`).name,`'${prefix}synthetic-coffer-${n}`)
  for(let i=300;i<355;i++)await donor(h,`synthetic-coffer-${i}`,{email:`synthetic-coffer-${i}@example.test`})
  const unpaged=await download(h,'constituents','list=search&q=synthetic-coffer-3'),pages=[]
  for(let page=0;;page++){const value=await get(`/api/coffer/donors?q=synthetic-coffer-3&page=${page}`);pages.push(...value.donors.filter(d=>!d.erased_at));if(!value.more)break}
  assert.ok(unpaged.rows.length>50);assert.deepEqual(unpaged.rows.map(r=>r.id).sort(),pages.map(r=>r.id).sort())
  for(const kind of ['lybunt','sybunt']){const annual=await get('/api/coffer/reports/annual-lapses?year=2026'),file=await download(h,'constituents',`list=${kind}&year=2026`);assert.deepEqual(file.rows.map(r=>r.id).sort(),annual.groups.find(g=>g.kind===kind).rows.map(r=>r.donorId).sort())}
  await get('/api/coffer/exports/gifts.csv?list=saved:missing',{status:404});await get('/api/coffer/exports/unknown.csv',{status:400})
  await get('/api/coffer/exports/gifts.csv?list=unknown',{status:400})
  const backup=await archive(h),fresh=await installation({entry:'tests/advancing-clock-worker.ts'})
  try{await restore(fresh,backup);assert.ok((await fresh.get('/api/coffer/lists')).lists.some(l=>l.id===list.id));const restored=await download(fresh,'gifts',query);assert.deepEqual(restored.rows,result.gifts)}finally{await fresh.close()}
  if(process.env.COFFER_EXPORTS_BROWSER)await exportsBrowser(h,{listId:list.id,headers},process.env.COFFER_EXPORTS_BROWSER)
  const longNote='synthetic-coffer-400 '+'.'.repeat(7970)
  for(let i=0;i<520;i++)await command('interaction.record',{donorId:main.id,kind:'note',occurredOn:'2026-10-18',notes:longNote})
  const tooLarge=await get(`/api/coffer/exports/interactions.csv?${query}`,{status:413})
  assert.equal(tooLarge.error,'EXPORT_TOO_LARGE');assert.equal(tooLarge.details.rowCount,result.interactions.length+520)
  assert.equal((await get('/api/coffer/audit?action=export.csv')).rows.filter(r=>JSON.parse(r.detail).rowCount===tooLarge.details.rowCount).length,0,'A refused file is never logged as a successful CSV')
 },{entry:'tests/engagement-worker.ts',bindings:{STRIPE_SECRET_KEY:key,STRIPE_WEBHOOK_SECRET:secret,MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-coffer-39',MAIL_EVENT_PUBLIC_KEY:publicKey,COFFER_REPLY_ADDRESS:'synthetic-coffer-36@example.test'},outbound})
}

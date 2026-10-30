import {publicWebhookDns} from './webhook-dns-edge.mjs'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {apiPaymentSource} from './rest-api-payments.mjs'
import {restApiBrowser} from './rest-api-browser.mjs'
import {apiNativeEdges,addressEntry,consentSync} from './rest-api-native.mjs'

const prefix='/api/coffer/v1',day='2026-10-25',clock={entry:'tests/advancing-clock-worker.ts',triggerHandlers:true,bindings:{COFFER_TEST_NOW:'2026-10-27T12:00:00.000Z',SMARTY_AUTH_ID:'synthetic-coffer-4101',SMARTY_AUTH_TOKEN:'synthetic-coffer-4102',MELISSA_SMARTMOVER_KEY:'synthetic-coffer-4103'}}
const giftInput=donorId=>({donorId,amountCents:123456,receivedOn:day,method:'check',goods:'none',reference:'synthetic-coffer-4001'})
const bearer=key=>({as:'',headers:{authorization:'Bearer '+key.token}})
const types={null:v=>v===null,object:v=>v!==null&&typeof v==='object'&&!Array.isArray(v),array:Array.isArray,string:v=>typeof v==='string',integer:Number.isSafeInteger,boolean:v=>typeof v==='boolean',number:v=>typeof v==='number'&&Number.isFinite(v)}

/** Validate the actual public responses against the served OpenAPI schemas,
 * including nested projections and all referenced resource definitions. */
function validate(value,schema,document,path='response'){
 if(schema.$ref)return validate(value,document.components.schemas[schema.$ref.split('/').at(-1)],document,path)
 if(schema.anyOf){assert.ok(schema.anyOf.some(s=>{try{validate(value,s,document,path);return true}catch{return false}}),path+' matches a documented alternative');return}
 if(schema.type){const allowed=Array.isArray(schema.type)?schema.type:[schema.type];assert.ok(allowed.some(t=>types[t]?.(value)),path+' has documented type '+allowed.join(', '))}
 if(schema.enum)assert.ok(schema.enum.includes(value),path+' has documented value')
 if(typeof value==='number'){if(schema.minimum!==undefined)assert.ok(value>=schema.minimum,path);if(schema.maximum!==undefined)assert.ok(value<=schema.maximum,path)}
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  for(const key of schema.required??[])assert.ok(Object.hasOwn(value,key),path+' requires '+key)
  for(const [key,child] of Object.entries(schema.properties??{}))if(value[key]!==undefined)validate(value[key],child,document,path+'.'+key)
 }
 if(Array.isArray(value)&&schema.items)value.forEach((v,i)=>validate(v,schema.items,document,path+'['+i+']'))
}
function validateReferences(value,document){if(!value||typeof value!=='object')return;if(value.$ref)assert.ok(document.components.schemas[value.$ref.split('/').at(-1)],value.$ref);for(const child of Object.values(value))validateReferences(child,document)}

export async function restApiJourney(){
 const received=[],payments=apiPaymentSource(),native=apiNativeEdges()
 await run(async h=>{
  await reviewed(h)
  const d=await donor(h,'synthetic-coffer-4002',{email:'synthetic-coffer-4002@example.test'}),other=await donor(h,'synthetic-coffer-4003',{email:'synthetic-coffer-4003@example.test'})
  const member=await h.person('synthetic-coffer-4004@example.test'),admin=await h.person('synthetic-coffer-4005@example.test','admin')
  const call=async(path,{key,method='GET',body,status=200,headers={},...options}={})=>{
   const response=await h.request(prefix+path,{...(key?bearer(key):{}),method,...(body===undefined?{}:{body}),...options,headers:{...(key?bearer(key).headers:{}),...headers}})
   const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return {value,response}
  }
  await call('/donors',{as:'',status:401})
  await call('/keys',{as:member.cookie,status:403})
  await call('/keys',{as:member.cookie,method:'POST',body:{label:'synthetic-coffer-4006',scope:'full'},status:403})
  await call('/keys',{method:'POST',body:{label:'synthetic-coffer-4007',scope:'unknown'},status:400})
  await call('/keys',{method:'POST',body:{label:'synthetic-coffer-4008',scope:'full',expiresOn:'2020-01-01'},status:400})
  const create=async(scope,label,{expiresOn,...options}={})=>(await call('/keys',{method:'POST',body:{scope,label,...(expiresOn?{expiresOn}:{})},status:201,...options})).value
  const readOnly=await create('read-only','synthetic-coffer-4009'),entry=await create('gift-entry','synthetic-coffer-4010'),full=await create('full','synthetic-coffer-4011',{as:admin.cookie})
  const document=(await call('/openapi.json',{key:readOnly})).value
  validateReferences(document,document)
  for(const resource of ['Donor','Gift','Pledge','Plan','Interaction','Task','Opportunity','Fund','Campaign','SoftCredit'])assert.ok(document.components.schemas[resource],resource+' schema is documented')
  const checked=async(path,options={},template=path.split('?')[0])=>{
   const r=await call(path,options),method=(options.method??'GET').toLowerCase()
   const schema=document.paths[template]?.[method]?.responses[r.response.status]?.content?.['application/json']?.schema
   assert.ok(schema,'Documented response for '+method+' '+template);validate(r.value,schema,document);return r
  }
  const listed=await checked('/donors',{key:readOnly})
  assert.ok(listed.value.data.some(row=>row.id===d.id))
  await checked('/donors/'+d.id,{key:readOnly},'/donors/{id}')
  await call('/gifts',{key:readOnly,method:'POST',body:giftInput(d.id),headers:{'idempotency-key':'synthetic-coffer-4012'},status:403})
  await call('/keys',{key:full,status:403})
  await call('/keys',{key:full,method:'POST',body:{label:'synthetic-coffer-4013',scope:'full'},status:403})
  await call('/gifts',{key:entry,method:'POST',body:giftInput(d.id),status:400})
  const webhook=await h.command('webhook.subscribe',{name:'Riverbend API records',endpoint:'https://receiver.example.test/rest-events',events:['gift.created','donor.created','donor.updated'],reviewed:'yes'})
  const operation={key:entry,method:'POST',body:giftInput(d.id),headers:{'idempotency-key':'synthetic-coffer-4014'}}
  const concurrent=await Promise.all([checked('/gifts',operation),checked('/gifts',operation)])
  assert.equal(concurrent[0].value.id,concurrent[1].value.id)
  assert.ok(concurrent.some(r=>r.response.headers.get('idempotency-replayed')==='true'))
  const g=concurrent[0].value
  const queued=(await h.get('/api/coffer/webhooks')).deliveries
  assert.equal(queued.filter(row=>row.subject_id===g.id&&row.event_type==='gift.created').length,1,'Idempotent public gift entry enqueues exactly one approved native event')
  const webhookTick=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+Date.parse('2026-10-27T12:00:00.000Z'));assert.equal(webhookTick.status,200)
  const delivered=received.find(row=>row.event.data.id===g.id);assert.ok(delivered,'Public gift entry inherits the existing signed webhook delivery door')
  const signature=Object.fromEntries(delivered.signature.split(',').map(part=>part.split('=')))
  assert.equal(signature.v1,createHmac('sha256',webhook.secret).update(signature.t+'.'+delivered.body).digest('hex'))
  assert.deepEqual(Object.keys(delivered.event.data),['id'],'The new transport does not widen approved webhook disclosure')
  const replay=await checked('/gifts',operation);assert.equal(replay.value.id,g.id);assert.equal(replay.response.headers.get('idempotency-replayed'),'true')
  await call('/gifts',{...operation,body:{...operation.body,amountCents:1},status:409})
  const ledger=await checked('/gifts?donorId='+d.id,{key:readOnly},'/gifts')
  assert.deepEqual(ledger.value.data.map(row=>row.id),[g.id])
  assert.equal(ledger.value.data[0].amount_cents,123456)
  assert.equal(ledger.value.data[0].acknowledgment.status,'not acknowledged')
  const write=async(path,body,{as,key=full,status=200,method='PUT',keyName='synthetic-coffer-'+crypto.randomUUID()}={},template=path)=>checked(path,{key:as?undefined:key,as,method,body,status,headers:{'idempotency-key':keyName}},template)
  const donorInput={name:'synthetic-coffer-4104',email:'synthetic-coffer-4104@example.test',city:'synthetic-coffer-4105'}
  for(const key of [readOnly,entry])await write('/donors',donorInput,{key,method:'POST',status:403})
  const createdDonor=await write('/donors',donorInput,{method:'POST',keyName:'synthetic-coffer-4106'})
  const donorPath='/donors/'+createdDonor.value.id
  assert.equal((await write('/donors',donorInput,{method:'POST',keyName:'synthetic-coffer-4106'})).value.id,createdDonor.value.id)
  await write(donorPath,{...donorInput,name:'synthetic-coffer-4107',version:1},{},'/donors/{id}')
  const edited=await checked(donorPath,{key:readOnly},'/donors/{id}');assert.equal(edited.value.data.name,'synthetic-coffer-4107');assert.equal(edited.value.data.version,2)
  await write(donorPath,{...donorInput,version:1},{status:409},'/donors/{id}')
  await h.command('address.processing',{version:0,enabled:'yes',pafSigner:'synthetic-coffer-4108',pafSignedOn:day,pafLicensee:'synthetic-coffer-4109',pafReference:'synthetic-coffer-4110',reviewed:'yes'})
  await addressEntry(h,write,checked,native,{donorPath,donorInput})
  await h.command('address.processing',{version:1,enabled:false})
  const stop='/donors/'+d.id+'/solicitation'
  await write(stop,{version:0,type:'stop',startsOn:day},{key:entry,status:403},'/donors/{id}/solicitation')
  await write(stop,{version:0,type:'stop',startsOn:day},{},'/donors/{id}/solicitation')
  const restriction=await checked(stop,{key:readOnly},'/donors/{id}/solicitation');assert.equal(restriction.value.data.type,'stop');assert.equal(restriction.value.data.active,true)
  await write(stop,{version:0,type:'none'},{status:409},'/donors/{id}/solicitation')
  const giftAck='/gifts/'+g.id+'/acknowledgment'
  const interaction=await write('/interactions',{donorId:d.id,kind:'call',occurredOn:day,notes:'synthetic-coffer-4015',who:'synthetic-coffer-4016'},{method:'POST'},'/interactions')
  const unrelated=await h.command('interaction.record',{donorId:other.id,kind:'call',occurredOn:day,notes:'synthetic-coffer-4017'})
  await write(giftAck,{status:'acknowledged',version:0,acknowledgedOn:day,method:'phone call',interactionId:unrelated.id},{status:409},'/gifts/{id}/acknowledgment')
  await write(giftAck,{status:'acknowledged',version:0,acknowledgedOn:'2026-10-24',method:'handwritten note',notes:'synthetic-coffer-4120'},{as:member.cookie,status:400},'/gifts/{id}/acknowledgment')
  await write(giftAck,{status:'acknowledged',version:0,acknowledgedOn:day,method:'phone call',interactionId:interaction.value.id},{as:member.cookie},'/gifts/{id}/acknowledgment')
  let ack=await checked(giftAck,{key:readOnly},'/gifts/{id}/acknowledgment')
  assert.equal(ack.value.data.link.id,interaction.value.id);assert.equal(ack.value.data.method,'phone call');assert.equal(ack.value.data.acknowledged_on,day)
  assert.equal((await h.get('/api/coffer/letters')).due.some(row=>row.id===g.id),false)
  await write(giftAck,{status:'not acknowledged',version:0},{as:member.cookie,status:409},'/gifts/{id}/acknowledgment')
  await write(giftAck,{status:'not acknowledged',version:1},{as:member.cookie},'/gifts/{id}/acknowledgment')
  await write(giftAck,{status:'do not acknowledge',version:2,reason:'synthetic-coffer-4018'},{as:member.cookie,status:403},'/gifts/{id}/acknowledgment')
  await write(giftAck,{status:'do not acknowledge',version:2,reason:''},{status:400},'/gifts/{id}/acknowledgment')
  await write(giftAck,{status:'do not acknowledge',version:2,reason:'synthetic-coffer-4018'},{},'/gifts/{id}/acknowledgment')
  ack=await checked(giftAck,{key:readOnly},'/gifts/{id}/acknowledgment');assert.equal(ack.value.data.status,'do not acknowledge')
  const agent=await h.command('agent.create',{label:'synthetic-coffer-4019'})
  for(const status of ['acknowledged','not acknowledged','do not acknowledge'])await call(giftAck,{...bearer(agent),method:'PUT',body:{status,version:3},headers:{authorization:'Bearer '+agent.token,'idempotency-key':'synthetic-coffer-'+status.replaceAll(' ','-')},status:403})
  const credit=await write('/soft-credits',{giftId:g.id,donorId:other.id,amountCents:50000},{method:'POST'},'/soft-credits')
  const creditAck='/soft-credits/'+credit.value.id+'/acknowledgment'
  await write(creditAck,{status:'acknowledged',version:0,acknowledgedOn:'2026-10-24',method:'handwritten note',notes:'synthetic-coffer-4121'},{as:member.cookie,status:400},'/soft-credits/{id}/acknowledgment')
  await write(creditAck,{status:'acknowledged',version:0,acknowledgedOn:day,method:'handwritten note',notes:'synthetic-coffer-4020'},{as:member.cookie},'/soft-credits/{id}/acknowledgment')
  const creditNote=(await checked(creditAck,{key:readOnly},'/soft-credits/{id}/acknowledgment')).value.data.link.id
  assert.equal((await checked(creditAck,{key:readOnly},'/soft-credits/{id}/acknowledgment')).value.data.status,'acknowledged')
  assert.equal((await checked(giftAck,{key:readOnly},'/gifts/{id}/acknowledgment')).value.data.status,'do not acknowledge')
  await write(creditAck,{status:'not acknowledged',version:0},{as:member.cookie,status:409},'/soft-credits/{id}/acknowledgment')
  await write(creditAck,{status:'not acknowledged',version:1},{as:member.cookie},'/soft-credits/{id}/acknowledgment')
  await write(creditAck,{status:'do not acknowledge',version:2,reason:'synthetic-coffer-4021'},{as:member.cookie,status:403},'/soft-credits/{id}/acknowledgment')
  await write(creditAck,{status:'do not acknowledge',version:2,reason:'synthetic-coffer-4021'},{},'/soft-credits/{id}/acknowledgment')
  await consentSync(h,write,checked,native,{donorId:other.id,email:'synthetic-coffer-4003@example.test',day})
  await h.command('consent.record',{donorIds:[d.id],channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-4112',capturedOn:day})
  const pledge=await write('/pledges',{donorId:d.id,amountCents:10000,pledgedOn:day,installments:[{dueOn:day,amountCents:10000}]},{method:'POST'},'/pledges')
  assert.ok(pledge.value.id)
  const heldPledge=await checked('/pledges/'+pledge.value.id,{key:readOnly},'/pledges/{id}');assert.equal(heldPledge.value.data.api_review_required,1);assert.ok(heldPledge.value.data.api_review_note)
  const messageCount=h.messages.length
  assert.equal((await h.command('pledge.remind',{pledgeId:pledge.value.id})).submitted,0)
  const tick=await h.request('/cdn-cgi/local/scheduled?cron=0+13+*+*+*&time='+Date.parse('2026-10-27T13:00:00.000Z'));assert.equal(tick.status,200,await tick.text())
  assert.equal(h.messages.length,messageCount,'The reviewed API hold prevents scheduled pledge reminders and follow-ups')
  await write('/funds',{name:'synthetic-coffer-4022',restriction:'purpose',detail:'synthetic-coffer-4023'},{method:'POST'},'/funds')
  const owner=(await h.get('/auth/session')).operator.id
  const task=await write('/tasks',{donorId:d.id,ownerId:owner,dueOn:day,kind:'thank_you',title:'synthetic-coffer-4024',isAsk:false},{method:'POST'},'/tasks')
  await checked('/tasks/'+task.value.id,{key:readOnly},'/tasks/{id}')
  await write('/tasks',{donorId:d.id,ownerId:owner,dueOn:day,kind:'call',title:'synthetic-coffer-4025',isAsk:true},{method:'POST',status:409},'/tasks')
  const nativeStages=await h.get('/api/coffer/pipeline'),stage=nativeStages.stages.find(s=>s.outcome==='open').id
  const opportunity=await write('/opportunities',{donorId:d.id,ownerId:owner,stage,askAmountCents:100000,expectedCloseOn:day,nextStep:'synthetic-coffer-4026'},{method:'POST'},'/opportunities')
  await checked('/opportunities/'+opportunity.value.id,{key:readOnly},'/opportunities/{id}')
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'synthetic-coffer-4027',slug:'synthetic-coffer-4027',description:'synthetic-coffer-4028',fund:'Unrestricted',goalCents:100000})
  await checked('/campaigns/'+campaign.id,{key:readOnly},'/campaigns/{id}')
  const draft=await write('/campaigns',{name:'synthetic-coffer-4113',slug:'synthetic-coffer-4113',description:'synthetic-coffer-4114',fund:'Unrestricted',goalCents:100000,feeCoverEnabled:true,feeCoverRateBps:290,feeCoverFixedCents:30},{method:'POST'},'/campaigns')
  assert.equal((await checked('/campaigns/'+draft.value.id,{key:readOnly},'/campaigns/{id}')).value.data.active,0)
  assert.equal((await h.request('/give/synthetic-coffer-4113',{as:''})).status,404)
  assert.equal((await h.get('/api/coffer/giving/campaigns')).campaigns.some(row=>row.id===draft.value.id),false)
  const publication=await h.get('/api/coffer/giving/campaigns/'+draft.value.id)
  await h.api('/api/coffer/giving/campaigns/'+draft.value.id+'/publish',{version:publication.publicationVersion,reviewed:true},{...bearer(full),status:401})
  await h.api('/api/coffer/giving/campaigns/'+draft.value.id+'/publish',{version:publication.publicationVersion,reviewed:true},{as:member.cookie,status:403})
  await h.api('/api/coffer/giving/campaigns/'+draft.value.id+'/publish',{version:publication.publicationVersion},{status:400})
  await h.api('/api/coffer/giving/campaigns/'+draft.value.id+'/fee-cover',{version:publication.campaign.fee_cover_version,feeCoverEnabled:false})
  await h.api('/api/coffer/giving/campaigns/'+draft.value.id+'/publish',{version:publication.publicationVersion,reviewed:true},{status:409})
  const reviewedDraft=await h.get('/api/coffer/giving/campaigns/'+draft.value.id)
  await h.api('/api/coffer/giving/campaigns/'+draft.value.id+'/publish',{version:reviewedDraft.publicationVersion,reviewed:true})
  assert.equal((await checked('/campaigns/'+draft.value.id,{key:readOnly},'/campaigns/{id}')).value.data.active,1)
  assert.equal((await h.request('/give/synthetic-coffer-4113',{as:''})).status,200)
  const sourcePlan={id:'sub_syntheticcoffer4115',customer:'cus_syntheticcoffer4116',created:Date.parse(day+'T12:00:00Z')/1000,status:'active',currency:'usd',metadata:{},cancel_at_period_end:false,items:{data:[{quantity:1,price:{type:'recurring',currency:'usd',unit_amount:4000,billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]}}
  Object.assign(sourcePlan,{collection_method:'charge_automatically',billing_cycle_anchor:Date.parse(day+'T12:00:00Z')/1000,current_period_end:Date.parse('2026-11-25T12:00:00Z')/1000})
  Object.assign(sourcePlan.items.data[0],{id:'synthetic-coffer-4270'})
  sourcePlan.items.data[0].price.product='synthetic-coffer-4271'
  native.state.plans.set(sourcePlan.id,sourcePlan)
  const snapshot={customers:[{object:'list',data:[{id:sourcePlan.customer,name:'synthetic-coffer-4117',email:'synthetic-coffer-4117@example.test',created:sourcePlan.created}]}],charges:[{object:'list',data:[]}],subscriptions:[{object:'list',data:[sourcePlan]}],noGoodsOrServices:true}
  const preview=await h.api('/api/coffer/imports/preview',snapshot)
  let job=await h.api('/api/coffer/imports/apply',{...snapshot,fingerprint:preview.fingerprint})
  while(job.state!=='completed')job=await h.api('/api/coffer/imports/resume',{id:job.id})
  const plan=await checked('/plans/'+sourcePlan.id,{key:readOnly},'/plans/{id}')
  assert.equal(plan.value.data.amount_cents,4000);assert.equal(plan.value.data.status,'active');assert.equal(Object.hasOwn(plan.value.data,'customer_id'),false)
  const memberPlan=await checked('/plans/'+sourcePlan.id,{as:member.cookie},'/plans/{id}');assert.equal(memberPlan.value.data.id,sourcePlan.id)
  const planPath='/api/coffer/giving/plans/'+sourcePlan.id
  const planSource=await h.command('interaction.record',{donorId:plan.value.data.donor_id,kind:'call',occurredOn:day,notes:'synthetic-coffer-4272'})
  const planState=await h.get(planPath),planChange={action:'pause',requestId:crypto.randomUUID(),version:planState.version,sourceRef:'interaction:'+planSource.id,reason:'synthetic-coffer-4273',confirm:'yes'}
  await h.api(planPath,planChange,{...bearer(full),status:401})
  await h.api(planPath,planChange,{as:member.cookie,status:403})
  await h.api(planPath,{...planChange,confirm:'no'},{status:400})
  await h.api(planPath,planChange)
  await h.api(planPath,planChange)
  assert.equal(native.state.planWrites,1,'Native plan replay never repeats a provider mutation')
  assert.equal((await checked('/plans/'+sourcePlan.id,{key:readOnly},'/plans/{id}')).value.data.collection_paused,1)
  for(const [action,extra] of [['resume',{}],['amount',{amountCents:5000}],['cancel',{}]]){
   const current=await h.get(planPath)
   await h.api(planPath,{...planChange,...extra,action,version:current.version,requestId:crypto.randomUUID()})
  }
  const changedPlan=(await checked('/plans/'+sourcePlan.id,{key:readOnly},'/plans/{id}')).value.data
  assert.equal(changedPlan.collection_paused,0);assert.equal(changedPlan.amount_cents,5000);assert.equal(changedPlan.cancel_at_period_end,1)
  await write('/donors/'+d.id+'/consents',{channel:'mail',status:'granted',method:'paper form',evidence:'synthetic-coffer-4029',capturedOn:day},{method:'POST'},'/donors/{id}/consents')
  await checked('/donors/'+d.id+'/consents',{key:readOnly},'/donors/{id}/consents')
  await write('/donors/'+d.id+'/status',{version:1,constituentStatus:'inactive',statusReason:'synthetic-coffer-4030'},{},'/donors/{id}/status')
  assert.equal((await checked('/donors/'+d.id+'/status',{key:readOnly},'/donors/{id}/status')).value.data.constituent_status,'inactive')
  const property=await h.command('inKind.save',{donorId:other.id,description:'Books for Riverbend readers',quantity:'20',statedValue:'100',receivedOn:day,goods:'none'})
  const propertyRead=await checked('/gifts/'+property.id,{key:readOnly},'/gifts/{id}')
  assert.equal(propertyRead.value.data.kind,'in_kind');assert.equal(propertyRead.value.data.amount_cents,0);assert.equal(propertyRead.value.data.property_description,'Books for Riverbend readers')
  const processor=await payments.populate(h)
  const processorRows=(await checked('/gifts?donorId='+processor.donorId,{key:readOnly},'/gifts')).value.data
  assert.deepEqual(processorRows.map(row=>row.id).sort(),processor.gifts.map(row=>row.id).sort(),'Public gifts include every signed native ledger entry')
  assert.equal(processorRows.reduce((sum,row)=>sum+row.amount_cents,0),processor.netCents,'API monetary facts reconcile with native contributions after a provider refund')
  const adjustment=processorRows.find(row=>row.source==='stripe-adjustment');assert.ok(adjustment)
  await checked('/gifts/'+adjustment.id,{key:readOnly},'/gifts/{id}')
  for(const resource of ['donors','gifts','pledges','plans','interactions','tasks','opportunities','funds','campaigns','soft-credits'])await checked('/'+resource,{key:readOnly})
  const first=(await checked('/donors?limit=1',{key:readOnly},'/donors')).value
  const second=(await checked('/donors?limit=1&after='+first.page.next,{key:readOnly},'/donors')).value
  assert.notEqual(first.data[0].id,second.data[0].id)
  await call('/plans',{key:entry,status:403})
  for(const path of ['/commands','/donors/'+d.id+'/erase','/plans/synthetic-coffer-4031/cancel','/campaigns/'+draft.value.id+'/publish','/webhooks'])await call(path,{key:full,method:'POST',body:{},headers:{'idempotency-key':'synthetic-coffer-4032'},status:403})
  await call('/donors',{key:full,headers:{origin:'https://synthetic-coffer-4033.example.test'},status:403})
  const wrongHost=await h.mf.dispatchFetch('https://synthetic-coffer-4034.example.test'+prefix+'/donors',{headers:{authorization:'Bearer '+full.token}});assert.equal(wrongHost.status,403)
  const audit=await h.get('/api/coffer/audit?action=api.write')
  assert.ok(audit.rows.some(row=>JSON.parse(row.detail).apiKeyId===full.id&&row.actor_id===admin.id&&row.actor_role==='admin'&&row.actor_name.includes(full.label)))
  assert.equal(JSON.stringify(audit).includes(d.id),false)
  const ackAudit=await h.get('/api/coffer/audit?action=gift.acknowledgment')
  assert.ok(ackAudit.rows.some(row=>row.subject_id===g.id&&row.actor_id===member.id&&JSON.parse(row.detail).oldStatus==='acknowledged'))
  assert.equal(JSON.stringify(ackAudit).includes('synthetic-coffer-4018'),false)
  const safeAudit=(rows,{subject,actor,action,version,detail,keyLabel})=>{
   const row=rows.find(row=>row.subject_id===subject&&JSON.parse(row.detail).version===version)
   assert.ok(row,'The acknowledgment change has its own audit entry')
   assert.equal(row.actor_id,actor.id);assert.equal(row.actor_role,actor===member?'member':'admin')
   assert.equal(row.actor_name,(actor.session.operator.displayName??actor.session.operator.display_name)+(keyLabel?' (API: '+keyLabel+')':''))
   assert.equal(row.action,action)
   assert.deepEqual(JSON.parse(row.detail),detail,'Complete safe acknowledgment audit facts')
  }
  safeAudit(ackAudit.rows,{subject:g.id,actor:member,action:'gift.acknowledgment',version:1,detail:{oldStatus:'not acknowledged',status:'acknowledged',method:'phone call',acknowledgedOn:day,letterId:null,batchId:null,interactionId:interaction.value.id,noteId:null,communicationId:null,source:'manual',version:1}})
  safeAudit(ackAudit.rows,{subject:g.id,actor:member,action:'gift.acknowledgment',version:2,detail:{oldStatus:'acknowledged',status:'not acknowledged',method:null,acknowledgedOn:null,letterId:null,batchId:null,interactionId:null,noteId:null,communicationId:null,source:'manual',version:2}})
  safeAudit(ackAudit.rows,{subject:g.id,actor:admin,keyLabel:full.label,action:'gift.acknowledgment',version:3,detail:{oldStatus:'not acknowledged',status:'do not acknowledge',method:null,acknowledgedOn:null,letterId:null,batchId:null,interactionId:null,noteId:null,communicationId:null,source:'manual',version:3}})
  const creditAudit=await h.get('/api/coffer/audit?record='+credit.value.id)
  safeAudit(creditAudit.rows.filter(row=>row.action==='softCredit.acknowledge'),{subject:credit.value.id,actor:member,action:'softCredit.acknowledge',version:1,detail:{oldStatus:'not acknowledged',source:'manual',status:'acknowledged',acknowledgedOn:day,method:'handwritten note',interactionId:null,noteId:creditNote,version:1}})
  safeAudit(creditAudit.rows.filter(row=>row.action==='softCredit.resetAcknowledgment'),{subject:credit.value.id,actor:member,action:'softCredit.resetAcknowledgment',version:2,detail:{oldStatus:'acknowledged',source:'manual',status:'not acknowledged',acknowledgedOn:null,method:null,interactionId:null,noteId:null,version:2}})
  safeAudit(creditAudit.rows.filter(row=>row.action==='softCredit.doNotAcknowledge'),{subject:credit.value.id,actor:admin,keyLabel:full.label,action:'softCredit.doNotAcknowledge',version:3,detail:{oldStatus:'not acknowledged',source:'manual',status:'do not acknowledge',acknowledgedOn:null,method:null,interactionId:null,noteId:null,version:3,apiKeyId:full.id,apiKeyScope:'full'}})
  assert.equal(JSON.stringify(creditAudit).includes('synthetic-coffer-4020'),false)
  assert.equal(JSON.stringify(creditAudit).includes('synthetic-coffer-4021'),false)

  const keyState=(await call('/keys')).value;assert.equal(JSON.stringify(keyState).includes(readOnly.token),false);assert.equal(JSON.stringify(keyState).includes('token_hash'),false)
  const db=await h.mf.getD1Database('DB'),receipts=await db.prepare('SELECT * FROM cf_api_idempotency').all()
  assert.ok(receipts.results.length>0);assert.equal(JSON.stringify(receipts).includes(d.email??'@example.test'),false)
  assert.equal(JSON.stringify(receipts).includes('synthetic-coffer-4029'),false)
  const erasedGiftOperation={key:entry,method:'POST',body:{...giftInput(createdDonor.value.id),reference:'synthetic-coffer-4118'},headers:{'idempotency-key':'synthetic-coffer-4119'}}
  const erasedGift=(await checked('/gifts',erasedGiftOperation)).value
  await h.command('donor.erase',{donorId:createdDonor.value.id,confirm:'ERASE'})
  await call(donorPath,{key:readOnly,status:404})
  await call('/gifts/'+erasedGift.id,{key:readOnly,status:404})
  const erasedReplay=await call('/gifts',{...erasedGiftOperation,status:409});assert.equal(JSON.stringify(erasedReplay.value).includes(erasedGift.id),false)
  if(process.env.COFFER_REST_API_BROWSER)await restApiBrowser(h,process.env.COFFER_REST_API_BROWSER,{donorId:d.id,pledgeId:pledge.value.id})
  const saved=await archive(h)
  await run(async fresh=>{
   await restore(fresh,saved)
   const revoked=await fresh.request(prefix+'/donors',{...bearer(readOnly)});assert.equal(revoked.status,401)
   const restored=await fresh.get(prefix+'/gifts/'+g.id);assert.equal(restored.data.amount_cents,123456);assert.equal(restored.data.acknowledgment.status,'do not acknowledge')
   assert.equal((await fresh.get(prefix+'/keys')).keys.length,0)
  },clock)
  await call('/keys/'+entry.id+'/revoke',{method:'POST',body:{}})
  await call('/donors',{key:entry,status:401})
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await call('/donors',{key:full,status:401})
  const expired=await create('read-only','synthetic-coffer-4035',{expiresOn:'2026-10-27'})
  await call('/donors',{key:expired,headers:{'x-test-now':'2026-10-28T12:00:00.000Z'},status:401})
  const published=await h.command('giftRule.save',{name:'synthetic-coffer-4036',kind:'first_tag',tag:'synthetic-coffer-4037'})
  await h.command('giftRule.publish',{ruleId:published.id,version:published.version,reviewed:true})
  const nativeOwner=(await h.get('/auth/session')).operator.id
  const callRule=await h.command('giftRule.save',{name:'synthetic-coffer-4280',kind:'amount_call',minimumCents:1,ownerId:nativeOwner})
  const noticeRule=await h.command('giftRule.save',{name:'synthetic-coffer-4281',kind:'fund_notify',fund:'Unrestricted',provider:'slack'})
  for(const rule of [callRule,noticeRule])await h.command('giftRule.publish',{ruleId:rule.id,version:rule.version,reviewed:true})
  const guarded=await create('gift-entry','synthetic-coffer-4038'),ruleDonor=await donor(h,'synthetic-coffer-4282',{email:'synthetic-coffer-4282@example.test'})
  const ruleOperation={key:guarded,method:'POST',body:{...giftInput(ruleDonor.id),reference:'synthetic-coffer-4039'},headers:{'idempotency-key':'synthetic-coffer-4040'}}
  const ruleGifts=await Promise.all([call('/gifts',ruleOperation),call('/gifts',ruleOperation)])
  assert.equal(ruleGifts[0].value.id,ruleGifts[1].value.id)
  await call('/gifts',ruleOperation)
  const ruleState=await h.get('/api/coffer/gift-rules'),firings=ruleState.firings.filter(row=>row.gift_id===ruleGifts[0].value.id)
  assert.equal(firings.length,3);assert.equal(new Set(firings.map(row=>row.rule_id)).size,3)
  assert.equal(ruleState.tags.filter(row=>row.donor_id===ruleDonor.id).length,1)
  assert.equal(native.state.notices.length,1,'Concurrent API entry and replay use the native once-only notice claim')
  assert.equal(firings.find(row=>row.action==='fund_notify').status,'submitted')
  const thankYou=(await checked('/tasks?donorId='+ruleDonor.id,{key:readOnly},'/tasks')).value.data
  assert.equal(thankYou.length,1);assert.equal(thankYou[0].is_ask,0)
  native.state.noticeFailure=true
  const uncertain={...ruleOperation,body:{...giftInput(ruleDonor.id),reference:'synthetic-coffer-4283'},headers:{'idempotency-key':'synthetic-coffer-4284'}}
  const uncertainGift=await call('/gifts',uncertain);await call('/gifts',uncertain)
  assert.equal(native.state.notices.length,2,'An unconfirmed provider notice is never resent by idempotency replay')
  assert.equal((await h.get('/api/coffer/gift-rules')).firings.find(row=>row.gift_id===uncertainGift.value.id&&row.action==='fund_notify').status,'rejected')
  const limited=await create('read-only','synthetic-coffer-4041')
  let throttled
  for(let i=0;i<200;i++){const response=await h.request(prefix+'/openapi.json',{...bearer(limited)});if(response.status===429){throttled=response;break}assert.equal(response.status,200);await response.arrayBuffer()}
  assert.ok(throttled,'Repeated requests reach the durable rate limit');assert.ok(Number(throttled.headers.get('retry-after'))>0)
 },{...clock,bindings:{...clock.bindings,...payments.bindings,GIFT_RULE_SLACK_URL:'https://hooks.slack.com/services/synthetic-coffer-4290/synthetic-coffer-4291/synthetic-coffer-4292'},outbound:async request=>{
  const dns=publicWebhookDns(request);if(dns)return dns
  const nativeResult=await native.outbound(request);if(nativeResult)return nativeResult
  if(new URL(request.url).hostname==='api.stripe.com')return payments.outbound(request)
  assert.equal(new URL(request.url).hostname,'receiver.example.test','Public API local writes do not make unapproved provider calls')
  const body=await request.text();received.push({body,event:JSON.parse(body),signature:request.headers.get('coffer-signature')})
  return new Response(null,{status:204})
 }})
}

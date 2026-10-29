import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer,Agent} from 'node:https'
import {execFileSync} from 'node:child_process'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {run,donor,archive,restore} from './harness.mjs'
import {webhookSourcesJourney} from './webhook-sources-journey.mjs'

const require=createRequire(new URL('../integrations/zapier/index.js',import.meta.url))
const App=require('./index.js')
const {createAppTester}=require('zapier-platform-core')
const prefix='/api/coffer/v1',instant='2030-06-10T12:00:00.000Z'

// Only TLS trust and the loopback transport are adapted. Every request executes
// the actual Coffer Worker, native authorization, migrations and transactions.
async function connector(h,journey,initialNow=instant){
 const directory=await mkdtemp(join(tmpdir(),'coffer-zapier-'))
 let server,agent
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'})
  const cert=await readFile(join(directory,'cert.pem')),requests=[]
  let now=initialNow,dropNext=false,redirectNext=false
  server=createServer({key:await readFile(join(directory,'key.pem')),cert},async(req,res)=>{
   try{
    const headers=new Headers(Object.entries(req.headers).filter(([,v])=>typeof v==='string'))
    headers.set('host',new URL(h.origin).host);headers.set('x-test-now',now)
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    const raw=Buffer.concat(chunks)
    const recorded={method:req.method,path:req.url,key:headers.get('idempotency-key'),body:raw.length?JSON.parse(raw):null};requests.push(recorded)
    if(redirectNext){redirectNext=false;res.writeHead(302,{location:'https://127.0.0.1:'+server.address().port+'/unapproved'});res.end();return}
    const response=await h.mf.dispatchFetch(h.origin+req.url,{method:req.method,headers,redirect:'manual',...(raw.length?{body:raw}:{})})
    const bytes=Buffer.from(await response.arrayBuffer())
    if(response.status>=400)recorded.error=JSON.parse(bytes)
    if(dropNext){dropNext=false;res.destroy();return}
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes)
   }catch{res.writeHead(500);res.end()}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const baseUrl='https://127.0.0.1:'+server.address().port
  agent=new Agent({ca:cert})
  const runtimeTest=createAppTester({...App,beforeRequest:[request=>({...request,agent})]})
  const test=async(...args)=>{try{return await runtimeTest(...args)}catch(error){error.cofferRequest=requests.filter(row=>row.error).at(-1);throw error}}
  await journey({baseUrl,requests,test,setNow(value){now=value},drop(){dropNext=true},redirect(){redirectNext=true}})
 }finally{
  agent?.destroy()
  if(server)await new Promise(resolve=>server.close(resolve))
  await rm(directory,{recursive:true,force:true})
 }
}

export async function zapierJourney(){
 await run(async h=>connector(h,async transport=>{
  const {baseUrl,test,requests}=transport
  const owner=(await h.get('/auth/session')).operator.id
  const assigned=await h.person(['synthetic-coffer-7102','example.test'].join('@'))
  const admin=await h.person(['synthetic-coffer-7103','example.test'].join('@'),'admin')
  const d=await donor(h,'synthetic-coffer-7104',{email:null})
  await h.command('solicitation.set',{donorId:d.id,version:0,type:'stop',startsOn:'2030-06-01'})
  const key=async(scope,options={})=>h.api(prefix+'/keys',{scope,label:'synthetic-coffer-7105',...options.input},{status:201,...(options.as?{as:options.as}:{})})
  const full=await key('full'),readOnly=await key('read-only'),entry=await key('gift-entry')
  const input={invocationId:'synthetic-coffer-7106',donorId:d.id,ownerId:assigned.id,dueOn:'2030-06-12',kind:'follow_up',title:'synthetic-coffer-7107'}
  const bundle=(key,inputData=input)=>({authData:{baseUrl,apiKey:key.token},inputData})
  const action=(key=full,values={})=>test(App.creates.create_task.operation.perform,bundle(key,{...input,...values}))
  const refused=async(fn,status,code)=>assert.rejects(fn,error=>{
   const detail=JSON.parse(error.message)
   assert.equal(detail.status,status,String(error));if(code)assert.equal(detail.code,code,String(error));return true
  })
  assert.deepEqual(await test(App.authentication.test,bundle(full)),{id:baseUrl})
  for(const limited of [readOnly,entry])await refused(()=>action(limited),403)
  assert.equal((await h.get(prefix+'/tasks')).data.length,0,'Refused scopes create no task')
  const concurrent=await Promise.all(Array.from({length:4},()=>action()))
  const created=concurrent[0]
  assert.ok(created.id);assert.ok(concurrent.every(value=>value.id===created.id))
  assert.deepEqual(await action(),created,'An unchanged retry returns the original receipt')
  const tasks=(await h.get(prefix+'/tasks?donorId='+d.id)).data
  assert.equal(tasks.length,1,'Concurrent invocations and retries create one native task')
  const task=(await h.get(prefix+'/tasks/'+created.id)).data
  assert.deepEqual({donor:task.donor_id,owner:task.owner_id,due:task.due_on,kind:task.task_kind,title:task.reason,ask:task.is_ask,status:task.status},
   {donor:d.id,owner:assigned.id,due:input.dueOn,kind:input.kind,title:input.title,ask:0,status:'open'})
  const events=(await h.get('/api/coffer/audit?record='+created.id)).rows.filter(row=>row.action==='task.create')
  assert.equal(events.length,1);assert.equal(events[0].actor_id,owner);assert.equal(events[0].donor_id,d.id)
  assert.ok(events[0].actor_name.includes(full.label))
  assert.deepEqual(JSON.parse(events[0].detail),{kind:input.kind,ownerId:assigned.id,dueOn:input.dueOn,apiKeyId:full.id,apiKeyScope:'full'})
  const beforeConflict=requests.length
  await refused(()=>action(full,{title:'synthetic-coffer-7108'}),409)
  assert.equal(requests.length,beforeConflict+1,'Changed inputs reach the native replay conflict')
  const writes=requests.filter(row=>row.path===prefix+'/tasks'&&row.key==='zapier:task:'+input.invocationId)
  assert.ok(writes.length>=6);assert.ok(writes.every(row=>row.body.isAsk===false))

  transport.drop()
  await assert.rejects(()=>action(full,{invocationId:'synthetic-coffer-7109'}))
  const recovered=await action(full,{invocationId:'synthetic-coffer-7109'})
  assert.ok(recovered.id&&recovered.id!==created.id)
  assert.equal((await h.get(prefix+'/tasks?donorId='+d.id)).data.length,2,'A lost response retry does not duplicate the committed task')
  const beforeInvalid=(await h.get(prefix+'/tasks')).data.length
  for(const values of [{ownerId:'synthetic-coffer-7110'},{dueOn:'2030-02-30'},{kind:'arbitrary_command'},{donorId:'synthetic-coffer-7111'},{title:''}]){
   await assert.rejects(()=>action(full,{...values,invocationId:'synthetic-coffer-'+crypto.randomUUID()}))
  }
  await refused(()=>action(full,{invocationId:''}),400,'INVOCATION_REQUIRED')
  assert.equal((await h.get(prefix+'/tasks')).data.length,beforeInvalid,'Native task validation refuses invalid requests without writes')
  const beforeRedirect=requests.length;transport.redirect()
  await refused(()=>action(full,{invocationId:'synthetic-coffer-7112'}),302)
  assert.equal(requests.length,beforeRedirect+1,'Redirects are not followed with credentials')
  const invalidConnection={...bundle(full),authData:{...bundle(full).authData,baseUrl:baseUrl+'/other'}}
  await refused(()=>test(App.authentication.test,invalidConnection),400,'INVALID_ORIGIN')

  // A new principal is a new replay boundary, never a cross-key lookup.
  const replacement=await key('full')
  const otherPrincipal=await action(replacement)
  assert.notEqual(otherPrincipal.id,created.id)
  await h.api(prefix+'/keys/'+replacement.id+'/revoke',{})
  await refused(()=>action(replacement),401,'INVALID_API_KEY')
  await refused(()=>test(App.authentication.test,bundle(replacement)),401,'INVALID_API_KEY')
  const expired=await key('full',{input:{expiresOn:'2030-06-11'}})
  transport.setNow('2030-06-12T00:00:00.000Z')
  await refused(()=>action(expired),401,'INVALID_API_KEY')
  transport.setNow(instant)
  const creatorKey=await key('full',{as:admin.cookie})
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await refused(()=>action(creatorKey),401,'INVALID_API_KEY')

  const source=await donor(h,'synthetic-coffer-7113',{email:null}),target=await donor(h,'synthetic-coffer-7114',{email:null})
  await h.command('donor.merge',{sourceDonorId:source.id,sourceVersion:1,donorId:target.id,version:1,reason:'duplicate_record'})
  await assert.rejects(()=>action(full,{donorId:source.id,invocationId:'synthetic-coffer-7115'}))
  const erased=await donor(h,'synthetic-coffer-7116',{email:null})
  const erasedInput={donorId:erased.id,invocationId:'synthetic-coffer-7117'}
  const erasedTask=await action(full,erasedInput)
  await h.command('donor.erase',{donorId:erased.id,confirm:'ERASE'})
  await assert.rejects(()=>action(full,erasedInput),'An erased receipt cannot expose the earlier task')
  await assert.rejects(()=>action(full,{...erasedInput,invocationId:'synthetic-coffer-7118'}))
  await h.get(prefix+'/tasks/'+erasedTask.id,{status:404})
  const saved=await archive(h)
  await run(async fresh=>{
   await restore(fresh,saved)
   await fresh.get(prefix+'/tasks/'+created.id)
   await fresh.get(prefix+'/tasks/'+erasedTask.id,{status:404})
   await connector(fresh,async restored=>{
    await refused(()=>restored.test(App.creates.create_task.operation.perform,{authData:{baseUrl:restored.baseUrl,apiKey:full.token},inputData:input}),401,'INVALID_API_KEY')
   })
  },{entry:'tests/advancing-clock-worker.ts',bindings:{COFFER_TEST_NOW:instant}})
  assert.equal(h.messages.filter(message=>!String(message.subject).includes('invit')).length,0,'Creating tasks submits no provider messages')
 }),{entry:'tests/advancing-clock-worker.ts',bindings:{COFFER_TEST_NOW:instant}})
 await zapierRecordsJourney()
 await zapierHooksJourney()
}

const denied=(operation,status)=>assert.rejects(operation,error=>{
 assert.equal(JSON.parse(error.message.split(' action=')[0]).status,status,String(error));return true
})

export async function zapierRecordsJourney(){
 await run(async h=>connector(h,async({test,baseUrl,requests})=>{
  const full=await h.api(prefix+'/keys',{label:'synthetic-coffer-7520',scope:'full'},{status:201})
  const readOnly=await h.api(prefix+'/keys',{label:'synthetic-coffer-7521',scope:'read-only'},{status:201})
  const entry=await h.api(prefix+'/keys',{label:'synthetic-coffer-7522',scope:'gift-entry'},{status:201})
  const bundle=(inputData,key=full)=>({authData:{baseUrl,apiKey:key.token},inputData})
  const perform=async(name,input,key=full)=>{console.log('Zapier journey action:',name);try{return await test(App.creates[name].operation.perform,bundle({invocationId:'synthetic-coffer-7523-'+name,...input},key))}catch(error){error.message+=' action='+name+' native='+JSON.stringify(requests.filter(row=>row.error).at(-1)?.error);throw error}}
  const find=async(resource,id,key=full)=>(await test(App.searches['find_'+resource.replace('-','_')].operation.perform,bundle({recordId:id},key)))[0]
  const owner=(await h.get('/auth/session')).operator.id
  const member=await h.person(['synthetic-coffer-7524','example.test'].join('@'))
  const d=await perform('create_donor',{name:'synthetic-coffer-7525'})
  assert.equal((await find('donors',d.id,readOnly)).name,'synthetic-coffer-7525')
  assert.deepEqual(await perform('create_donor',{name:'synthetic-coffer-7525'}),d)
  await denied(()=>perform('create_donor',{name:'synthetic-coffer-7526'}),409)
  await denied(()=>perform('create_donor',{name:'synthetic-coffer-7526'},entry),403)
  const second=await donor(h,'synthetic-coffer-7527',{email:null})
  const fields=await test(App.creates.create_gift.operation.inputFields.at(-1),bundle({}))
  assert.ok(fields.some(f=>f.key==='amountCents'&&f.type==='integer'&&f.required),'Installation schema produces explicit typed native fields')
  await perform('create_fund',{name:'synthetic-coffer-7528',restriction:'purpose',detail:'synthetic-coffer-7529'})
  assert.equal((await find('funds','synthetic-coffer-7528')).restriction,'purpose')
  const campaign=await perform('create_campaign',{name:'synthetic-coffer-7530',slug:'synthetic-coffer-7530',description:'synthetic-coffer-7531',fund:'Unrestricted',goalCents:500000})
  const draft=await find('campaigns',campaign.id)
  assert.equal(draft.active,0);assert.equal(draft.goal_cents,500000)
  assert.equal((await h.request('/give/synthetic-coffer-7530',{as:''})).status,404,'API draft creation does not publish a giving form')
  const giftInput={donorId:d.id,amountCents:12500,receivedOn:'2030-06-10',method:'check',goods:'none',allocations:JSON.stringify([{fund:'Unrestricted',amountCents:7500},{fund:'synthetic-coffer-7528',amountCents:5000}])}
  const gifts=await Promise.all([perform('create_gift',giftInput,entry),perform('create_gift',giftInput,entry)])
  assert.equal(gifts[0].id,gifts[1].id)
  const gift=await find('gifts',gifts[0].id,readOnly)
  assert.equal(gift.amount_cents,12500);assert.deepEqual(gift.allocations.map(a=>[a.fund,a.amount_cents]),[['Unrestricted',7500],['synthetic-coffer-7528',5000]])
  await denied(()=>perform('create_gift',{...giftInput,amountCents:13000},entry),409)
  await denied(()=>perform('create_gift',giftInput,readOnly),403)
  const pledge=await perform('create_pledge',{donorId:d.id,amountCents:10000,pledgedOn:'2030-06-10',fund:'Unrestricted',installments:JSON.stringify([{dueOn:'2030-07-10',amountCents:10000}])})
  const held=await find('pledges',pledge.id);assert.equal(held.api_review_required,1);assert.equal(held.amount_cents,10000);assert.equal(held.installments[0].amount_cents,10000)
  const interaction=await perform('create_interaction',{donorId:d.id,kind:'call',occurredOn:'2030-06-10',notes:'synthetic-coffer-7532'})
  assert.equal((await find('interactions',interaction.id)).notes,'synthetic-coffer-7532')
  await perform('gift_acknowledgment',{recordId:gift.id,status:'acknowledged',version:0,acknowledgedOn:'2030-06-10',method:'phone call',interactionId:interaction.id})
  assert.equal((await find('gifts',gift.id)).acknowledgment.link.id,interaction.id)
  const credit=await perform('create_soft_credit',{giftId:gift.id,donorId:second.id,amountCents:5000})
  assert.equal((await find('soft-credits',credit.id)).amount_cents,5000)
  await perform('soft_credit_acknowledgment',{recordId:credit.id,status:'do not acknowledge',version:0,reason:'synthetic-coffer-7533'})
  assert.equal((await find('soft-credits',credit.id)).acknowledgment.status,'do not acknowledge')
  const stage=(await h.get('/api/coffer/pipeline')).stages.find(s=>s.outcome==='open').id
  const opportunityInput={donorId:d.id,ownerId:owner,stage,askAmountCents:100000,expectedCloseOn:'2030-08-01',nextStep:'synthetic-coffer-7534'}
  const opportunity=await perform('create_opportunity',opportunityInput)
  const prospect=await find('opportunities',opportunity.id);assert.equal(prospect.ask_amount_cents,100000)
  await perform('update_opportunity',{...opportunityInput,recordId:opportunity.id,version:prospect.version,nextStep:'synthetic-coffer-7535'})
  assert.equal((await find('opportunities',opportunity.id)).next_step,'synthetic-coffer-7535')
  await perform('set_solicitation',{recordId:d.id,version:0,type:'stop',startsOn:'2030-06-10'})
  assert.equal((await find('donors',d.id)).solicitation.active,true)
  await perform('record_consent',{recordId:d.id,channel:'phone',status:'withdrawn',method:'verbal',evidence:'synthetic-coffer-7536',capturedOn:'2030-06-10'})
  assert.ok((await find('donors',d.id)).consents.some(c=>c.channel==='phone'&&c.status==='withdrawn'))
  let task=await perform('create_task',{donorId:d.id,ownerId:owner,dueOn:'2030-06-11',kind:'data_fix',title:'synthetic-coffer-7537'})
  await perform('assign_task',{recordId:task.id,version:1,ownerId:member.id,dueOn:'2030-06-12'})
  assert.equal((await find('tasks',task.id)).owner_id,member.id)
  await denied(()=>perform('snooze_task',{recordId:task.id,version:1,dueOn:'2030-06-13'}),409)
  await perform('snooze_task',{recordId:task.id,version:2,dueOn:'2030-06-13'})
  assert.equal((await find('tasks',task.id)).status,'snoozed')
  await perform('complete_task',{recordId:task.id,version:3,notes:'synthetic-coffer-7538'})
  assert.equal((await find('tasks',task.id)).status,'done')
  const current=await find('donors',d.id)
  await perform('update_donor',{recordId:d.id,version:current.version,name:'synthetic-coffer-7539'})
  const updated=await find('donors',d.id);assert.equal(updated.name,'synthetic-coffer-7539')
  await perform('set_status',{recordId:d.id,version:updated.version,constituentStatus:'inactive',statusReason:'synthetic-coffer-7540'})
  assert.equal((await find('donors',d.id)).constituent_status,'inactive')
  await denied(()=>perform('create_interaction',{donorId:d.id,kind:'call',notes:'synthetic-coffer-7541'},readOnly),403)
  assert.equal(h.messages.filter(m=>!String(m.subject).includes('invit')).length,0,'Local record actions perform no direct provider sending')
 }),{entry:'tests/advancing-clock-worker.ts',bindings:{COFFER_TEST_NOW:instant}})
}

export async function zapierHooksJourney(){
 await webhookSourcesJourney(async({phase,h,signed,messages,erasedIds})=>connector(h,async transport=>{
  const {test,baseUrl}=transport
  const keyOptions={status:201}
  const full=await h.api(prefix+'/keys',{label:'synthetic-coffer-7550',scope:'full'},keyOptions)
  const targetUrl='https://receiver.example.test/events'
  const capture=message=>({authData:{baseUrl,apiKey:full.token},inputData:{subscriptionId:signed.id,targetUrl},
   rawRequest:{content:message.body,headers:{'Http-Coffer-Signature':message.signature,'Http-Coffer-Delivery-Id':message.deliveryId}}})
  const trigger=(message,changes={})=>test(App.triggers[message.event.type.replace('.','_')].operation.perform,{...capture(message),...changes})
  const first=messages.find(m=>m.event.type==='gift.created')
  if(phase==='erased'){
   const erased=messages.find(m=>erasedIds.includes(m.event.data.id));assert.ok(erased)
   transport.setNow(new Date(Number(erased.signature.match(/^t=(\d+)/)[1])*1000).toISOString())
   await denied(()=>trigger(erased),403)
   return
  }
  const kinds=new Set()
  for(const message of messages){
   if(kinds.has(message.event.type))continue
   kinds.add(message.event.type)
   transport.setNow(new Date(Number(message.signature.match(/^t=(\d+)/)[1])*1000).toISOString())
   const accepted=await trigger(message)
   assert.deepEqual(accepted,[message.event],'The packaged trigger exposes exactly the actual signed identifier-only native event')
   assert.deepEqual(Object.keys(accepted[0].data),['id'])
  }
  assert.equal(kinds.size,8,'All eight current native webhook event kinds execute the packaged triggers')
  const stamp=Number(first.signature.match(/^t=(\d+)/)[1])*1000
  transport.setNow(new Date(stamp).toISOString())
  assert.deepEqual(await trigger(first),[first.event],'Repeated delivery retains the event identity used by downstream idempotency')
  const donorId=(await h.get(prefix+'/gifts/'+first.event.data.id)).data.donor_id
  const owner=(await h.get('/auth/session')).operator.id
  const taskInput={invocationId:first.event.id,donorId,ownerId:owner,dueOn:'2026-11-01',kind:'follow_up',title:'synthetic-coffer-7551'}
  const action=()=>test(App.creates.create_task.operation.perform,{authData:{baseUrl,apiKey:full.token},inputData:taskInput})
  const tasks=await Promise.all([action(),action()]);assert.equal(tasks[0].id,tasks[1].id)
  assert.equal((await h.get(prefix+'/tasks/'+tasks[0].id)).data.is_ask,0,'Gift trigger to packaged action creates the exact owned non-ask native task')
  const forged=capture(first);forged.rawRequest.content=first.body+' '
  await denied(()=>trigger(first,forged),403)
  await denied(()=>trigger(first,{inputData:{subscriptionId:signed.id,targetUrl:targetUrl+'/unapproved'}}),403)
  const mismatched=capture(first);mismatched.rawRequest.headers['Http-Coffer-Delivery-Id']='synthetic-coffer-7552'
  await denied(()=>trigger(first,mismatched),403)
  await denied(()=>test(App.triggers.donor_created.operation.perform,capture(first)),400)
  transport.setNow(new Date(stamp+301000).toISOString())
  await denied(()=>trigger(first),403)
  transport.setNow(new Date(stamp).toISOString())
  const limited=await h.api(prefix+'/keys',{label:'synthetic-coffer-7553',scope:'read-only'},keyOptions)
  await denied(()=>trigger(first,{authData:{baseUrl,apiKey:limited.token}}),403)
  const admin=await h.person(['synthetic-coffer-7554','example.test'].join('@'),'admin')
  const foreignKey=await h.api(prefix+'/keys',{label:'synthetic-coffer-7555',scope:'full'},{...keyOptions,as:admin.cookie})
  await denied(()=>trigger(first,{authData:{baseUrl,apiKey:foreignKey.token}}),403)
  const replay=await h.command('webhook.replay',{deliveryId:first.deliveryId,reviewed:'yes'})
  const replayTick=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+String(stamp+1000));assert.equal(replayTick.status,200)
  const repeated=messages.find(message=>message.deliveryId===replay.id);assert.ok(repeated)
  assert.equal(repeated.event.id,first.event.id)
  assert.deepEqual(await trigger(repeated),[first.event],'Reviewed replay keeps stable identity while retaining a distinct native delivery')
  assert.deepEqual(await action(),tasks[0],'Trigger replay cannot duplicate the downstream task under the same principal')
  const state=(await h.get('/api/coffer/webhooks')).subscriptions.find(s=>s.id===signed.id)
  await h.command('webhook.pause',{subscriptionId:signed.id,version:state.version})
  await denied(()=>trigger(first),403)
  await h.command('webhook.resume',{subscriptionId:signed.id,version:state.version+1,reviewed:'yes'})
  // Resume never releases held history. A new event has a fresh delivery.
  const current=(await h.get('/api/coffer/webhooks')).subscriptions.find(s=>s.id===signed.id)
  await h.command('webhook.rotate',{subscriptionId:signed.id,version:current.version,overlapMinutes:0,reviewed:'yes'})
  await denied(()=>trigger(first),403)
  const freshDonor=await donor(h,'synthetic-coffer-7556',{email:null})
  const freshTick=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+String(stamp+2000));assert.equal(freshTick.status,200)
  const fresh=messages.find(message=>message.event.data.id===freshDonor.id);assert.ok(fresh)
  assert.deepEqual(await trigger(fresh),[fresh.event],'Current signing authority accepts a fresh post-rotation event')
  const expired=await h.api(prefix+'/keys',{label:'synthetic-coffer-7557',scope:'full',expiresOn:'2026-11-01'},keyOptions)
  assert.deepEqual(await trigger(fresh,{authData:{baseUrl,apiKey:expired.token}}),[fresh.event])
  transport.setNow('2026-11-02T00:00:00.000Z')
  await denied(()=>trigger(fresh,{authData:{baseUrl,apiKey:expired.token}}),401)
  transport.setNow(new Date(stamp+2000).toISOString())
  await h.api(prefix+'/keys/'+full.id+'/revoke',{})
  await denied(()=>trigger(first),401)
 }, '2026-10-27T12:00:00.000Z'))
}

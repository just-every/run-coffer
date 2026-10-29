import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer,Agent} from 'node:https'
import {execFileSync} from 'node:child_process'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {run,donor,archive,restore} from './harness.mjs'

const require=createRequire(new URL('../integrations/zapier/index.js',import.meta.url))
const App=require('./index.js')
const {createAppTester}=require('zapier-platform-core')
const prefix='/api/coffer/v1',instant='2030-06-10T12:00:00.000Z'

// Only TLS trust and the loopback transport are adapted. Every request executes
// the actual Coffer Worker, native authorization, migrations and transactions.
async function connector(h,journey){
 const directory=await mkdtemp(join(tmpdir(),'coffer-zapier-'))
 let server,agent
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'})
  const cert=await readFile(join(directory,'cert.pem')),requests=[]
  let now=instant,dropNext=false,redirectNext=false
  server=createServer({key:await readFile(join(directory,'key.pem')),cert},async(req,res)=>{
   try{
    const headers=new Headers(Object.entries(req.headers).filter(([,v])=>typeof v==='string'))
    headers.set('host',new URL(h.origin).host);headers.set('x-test-now',now)
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    const raw=Buffer.concat(chunks)
    requests.push({method:req.method,path:req.url,key:headers.get('idempotency-key'),body:raw.length?JSON.parse(raw):null})
    if(redirectNext){redirectNext=false;res.writeHead(302,{location:'https://127.0.0.1:'+server.address().port+'/unapproved'});res.end();return}
    const response=await h.mf.dispatchFetch(h.origin+req.url,{method:req.method,headers,redirect:'manual',...(raw.length?{body:raw}:{})})
    const bytes=Buffer.from(await response.arrayBuffer())
    if(dropNext){dropNext=false;res.destroy();return}
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes)
   }catch{res.writeHead(500);res.end()}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const baseUrl='https://127.0.0.1:'+server.address().port
  agent=new Agent({ca:cert})
  const test=createAppTester({...App,beforeRequest:[request=>({...request,agent})]})
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
}

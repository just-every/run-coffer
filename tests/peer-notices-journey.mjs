import assert from 'node:assert/strict'
import {archive,restore,run} from './harness.mjs'

/** Existing peer journey supplies actual captured gifts, authenticated supporters
 * and the Mailchimp network edge. All writes use ordinary public commands. */
export async function peerNoticesJourney(h,mail,{first,second,firstCookie,secondCookie,p1,p2,team,campaign,portalPost,create}){
 const records=[{...p1,type:'page',donor:first,as:firstCookie,total:2500},{...p2,type:'page',donor:second,as:secondCookie,total:5500},{...team,type:'team',donor:first,as:firstCookie,total:8000}]
 const send=(r,notice='thank',extra={},options={})=>h.command('peer.sendNotice',{recordId:r.id,recordType:r.type,version:r.version,notice,confirm:'SEND',...extra},options)
 const before=()=>mail.handoffs.length
 for(const r of records){
  const state=await h.get('/giving/peer/state',{as:r.as}),saved=state[r.type==='page'?'pages':'teams'].find(p=>p.id===r.id)
  r.version=saved.version
  if(!saved.published){
   await send(r,'thank',{}, {status:409})
   r.version=(await portalPost(h,r.type==='page'?'pages':'teams',{...create,id:r.id,version:r.version,title:saved.title,goal:(saved.goal_cents/100).toFixed(2)},r.as)).version
  }
 }
 await send(records[0],'thank',{}, {status:409})
 assert.equal(before(),0,'No configured sender means no submission')
 await h.command('marketing.connectMailchimp',{apiKey:['syntheticcoffer9100','us21'].join('-')})
 const at=String.fromCharCode(64)
 await h.command('marketing.chooseAudience',{listId:'synthetic-coffer-2451',fromName:'Readers',fromEmail:'synthetic-coffer-9100'+at+'example.test'})
 await send(records[0],'thank',{}, {status:409})
 assert.equal(before(),0,'Authentication alone never grants email consent')
 for(const d of [first,second])await h.command('consent.record',{donorIds:[d.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic fundraiser email permission',capturedOn:'2026-09-01'})
 const member=await h.person('synthetic-coffer-9191'+at+'example.test')
 await send(records[0],'thank',{}, {as:member.cookie,status:403})
 await send(records[0],'thank',{}, {as:firstCookie,status:401})
 await send(records[0],'thank',{}, {as:'',status:401})
 await send(records[0],'thank',{confirm:'no'}, {status:400})
 await send(records[0],'thank',{version:999}, {status:409})
 for(const r of records)await send(r,'milestone',{}, {status:409})
 assert.equal(before(),0,'No milestone mail before any goal is reached')
 const prefs=async(d,topics,frequency='monthly')=>h.command('communication.preferences',{donorId:d.id,channel:'email',version:(await h.get('/api/coffer/donors/'+d.id+'/preferences')).channels.find(p=>p.channel==='email').version,topics,frequency,confirm:'yes'})
 await prefs(first,['appeals']);await send(records[0],'thank',{}, {status:409});assert.equal(before(),0)
 await prefs(first,['newsletter'])
 await h.command('solicitation.set',{donorId:first.id,version:0,type:'stop',startsOn:'2026-09-01'})
 for(const r of records){
  const result=await send(r)
  assert.equal(result.status,'submitted');assert.equal(result.recipient_email,r.donor.id===first.id?'first.peer'+at+'example.test':'second.peer'+at+'example.test')
  assert.equal((await send(r)).id,result.id,'An explicit repeat returns the saved outcome')
 }
 assert.equal(before(),3)
 assert.ok(mail.handoffs.every(m=>m.settings.from_name==='Readers'&&m.settings.reply_to==='synthetic-coffer-9100'+at+'example.test'))
 // Goal edits use the same authenticated forms as page creation. The milestone
 // reads signed cash, never fundraiser recognition or pledged amounts.
 for(const r of records){
  const state=await h.get('/giving/peer/state',{as:r.as}),saved=state[r.type==='page'?'pages':'teams'].find(p=>p.id===r.id)
  const changed=await portalPost(h,r.type==='page'?'pages':'teams',{...create,id:r.id,version:saved.version,title:saved.title,goal:(r.total/100).toFixed(2),...(r.type==='page'?{teamId:team.id}:{})},r.as)
  r.version=changed.version
  const result=await send(r,'milestone');assert.equal(result.status,'submitted')
  assert.ok(result.body.includes('$'+(r.total/100).toFixed(2)))
  assert.equal((await send(r,'milestone')).id,result.id)
 }
 assert.equal(before(),6)
 const detail=await h.get('/api/coffer/donors/'+first.id)
 assert.equal(detail.solicitation.type,'stop','Pure thank-you and achievement notices do not weaken ask restrictions')
 assert.equal((await h.get('/api/coffer/donors/'+first.id+'/preferences')).channels.find(p=>p.channel==='email').frequency,'monthly')
 assert.equal(detail.communications.filter(m=>m.message_key.startsWith('peer:')).length,4)
 const data=await h.api('/api/coffer/donors/'+first.id+'/data-request',{requestedOn:'2026-09-15',method:'email'})
 assert.equal(data.records.communications.filter(m=>m.message_key.startsWith('peer:')).length,4)
 const saved=await archive(h)
 await run(async fresh=>{
  await restore(fresh,saved)
  const messages=(await fresh.get('/api/coffer/donors/'+first.id)).communications.filter(m=>m.message_key.startsWith('peer:'))
  assert.equal(messages.length,4)
  assert.equal((await fresh.command('peer.sendNotice',{recordId:records[0].id,version:records[0].version,notice:'thank',confirm:'SEND'})).id,messages.find(m=>m.message_key.endsWith(':thank')&&m.message_key.includes(records[0].id)).id,'Restore retains submitted history without restoring sender credentials')
 })
 // An interrupted provider answer and a revoked connection both retain the
 // claim. Neither later approval nor a repeated command submits it again.
 const extra=async title=>({...await portalPost(h,'pages',{...create,title,goal:'25'},secondCookie),type:'page',donor:second})
 const uncertain=await extra('Synthetic notice uncertainty')
 mail.state.fail=true
 const unknown=await send(uncertain);assert.equal(unknown.status,'uncertain')
 const claimed=before();mail.state.fail=false
 assert.equal((await send(uncertain)).id,unknown.id);assert.equal(before(),claimed)
 const revoked=await extra('Synthetic notice revoked sender')
 mail.beforeContent=()=>h.command('marketing.disconnect')
 const held=await send(revoked);assert.equal(held.status,'uncertain')
 assert.equal(before(),claimed,'Revoked sending authority refuses the last provider handoff')
 assert.equal((await send(revoked)).id,held.id);assert.equal(before(),claimed)
 const suppressed=await extra('Synthetic notice suppressed mode')
 await h.replaceBindings({RER_DEMO:'1'})
 await send(suppressed,'thank',{}, {status:503});assert.equal(before(),claimed)
 await h.replaceBindings({RER_DEMO:'0'})
 return {records,send,prefs,handoffs:before()}
}

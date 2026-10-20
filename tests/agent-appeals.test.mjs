import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import {run,donor} from './harness.mjs'
const fixture=JSON.parse(await readFile(new URL('./fixtures/mailchimp/responses.json',import.meta.url),'utf8'))

test('DEV-009: reconcile five dropped appeal recipients against the frozen audience and signed gifts, then prepare a human-approved resend',async()=>{
 const segments=new Map(),campaigns=new Map(),contacts=new Map();let sends=0,resultMode='normal'
 await run(async h=>{
  const donors=[]
  for(const name of ['Avery Chen','Bill Carter','Cora Diaz','Dalia Evans','Eli Fox','Farah Green','Grace Hill']){
   const d=await donor(h,name);donors.push(d)
   await h.command('consent.record',{donorIds:[d.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic written permission',capturedOn:'2026-01-01'})
  }
  await h.command('marketing.connectMailchimp',{apiKey:['syntheticedge','us21'].join('-')})
  await h.command('marketing.chooseAudience',{listId:'fixture-list',fromName:'Riverbend Food Bank',fromEmail:'replies@example.test'})
  const frozen=await h.command('appeal.prepare',{name:'Autumn pantry appeal',channel:'email',subject:'Thank you {{donor_name}}',body:'Your {{gift_count}} gifts total {{total_given}}.'})
  await h.command('appeal.approve',{appealId:frozen.id,version:1})
  await h.command('appeal.send',{appealId:frozen.id,version:2})
  assert.equal(sends,7,JSON.stringify((await h.get('/api/coffer/appeals/'+frozen.id)).messages.map(m=>({status:m.status,note:m.note}))))
  const gift=await h.command('gift.record',{donorId:donors[5].id,amount:'125.25',receivedOn:'2026-09-01',method:'check',fund:'Food',goods:'none',appeal:frozen.code})
  const returned=await h.command('gift.record',{donorId:donors[6].id,amount:'25',receivedOn:'2026-09-01',method:'cash',fund:'Food',goods:'none',appeal:frozen.code})
  await h.command('gift.reverse',{giftId:returned.id,reason:'Returned in full'})
  // A changed contact email must not turn an old handoff into a dropped send.
  const original=(await h.get(`/api/coffer/donors/${donors[6].id}`)).donor
  await h.command('donor.update',{donorId:original.id,version:original.version,name:original.name,email:'grace.changed@example.org'})
  let result=await h.api('/api/coffer/agent/appeals/run',{appealId:frozen.id})
  assert.equal(result.checked,7);assert.equal(result.reconciled,true);assert.equal(result.deliveryComplete,false)
  assert.equal(result.flagged,5)
  assert.deepEqual(result.rows.filter(r=>r.flagged).map(r=>r.donorId).sort(),donors.slice(0,5).map(d=>d.id).sort())
  assert.deepEqual(result.rows.slice(0,5).map(r=>r.state),['not sent','not sent','not sent','not sent','bounced'])
  assert.ok(result.rows.slice(5).every(r=>r.state==='handoff confirmed; delivery unknown'))
  assert.deepEqual([result.results.gifts,result.results.dollarsCents,result.results.responded],[1,12525,1])
  const prepared=await h.api('/api/coffer/agent/appeals/prepare',{appealId:frozen.id})
  const detail=await h.get('/api/coffer/appeals/'+prepared.id)
  assert.equal(detail.appeal.status,'prepared');assert.equal(detail.approval,null)
  assert.equal(detail.appeal.prepared_by_role,'agent')
  assert.deepEqual(detail.recipients.map(r=>r.donor_id).sort(),donors.slice(0,5).map(d=>d.id).sort())
  assert.deepEqual([detail.message.subject,detail.message.body],['Thank you {{donor_name}}','Your {{gift_count}} gifts total {{total_given}}.'])
  assert.equal((await h.api('/api/coffer/agent/appeals/prepare',{appealId:frozen.id})).id,prepared.id)
  await h.command('appeal.send',{appealId:prepared.id,version:1},{status:409})
  assert.equal(sends,7,'Preparing and an unapproved send never contact donors')
  const member=await h.person('helper@example.test')
  await h.api('/api/coffer/agent/appeals/run',{appealId:frozen.id},{as:member.cookie,status:403})
  await h.api('/api/coffer/agent/appeals/prepare',{appealId:frozen.id},{as:'',status:401})
  if(process.env.COFFER_APPEAL_AGENT_BROWSER){
   const {appealAgentBrowser}=await import('./agent-appeals-browser.mjs')
   await appealAgentBrowser(h,frozen,prepared,process.env.COFFER_APPEAL_AGENT_BROWSER)
  }else await h.command('appeal.approve',{appealId:prepared.id,version:1})
  await h.command('appeal.send',{appealId:prepared.id,version:2})
  assert.equal(sends,12)
  assert.equal((await h.get('/api/coffer/appeals/'+prepared.id)).approval.prepared_by_role,'agent')
  assert.equal((await h.get('/api/coffer/appeals/'+frozen.id)).messages.length,7,'Original submission history is retained')
  assert.equal((await h.get('/api/coffer/donors/'+donors[5].id)).gifts.find(g=>g.id===gift.id).amount_cents,12525)
  // A new audience has no sender records: absence remains visible from the audience side.
  const unsent=await h.command('appeal.prepare',{name:'Not submitted yet',channel:'email',subject:'Hello',body:'Hello {{donor_name}}'})
  await h.command('appeal.approve',{appealId:unsent.id,version:1})
  result=await h.api('/api/coffer/agent/appeals/run',{appealId:unsent.id})
  assert.equal(result.flagged,7);assert.ok(result.rows.every(r=>r.state==='not submitted'))
  assert.ok(result.rows.every(r=>!r.resend),'Missing submissions continue through the original approved send, never a parallel resend')
  await h.api('/api/coffer/agent/appeals/prepare',{appealId:unsent.id},{status:409})
  await h.command('appeal.send',{appealId:unsent.id,version:2})
  resultMode='mismatch'
  result=await h.api('/api/coffer/agent/appeals/run',{appealId:unsent.id})
  assert.ok(result.rows.every(r=>r.flagged&&!r.resend&&r.state==='submission or delivery unknown'))
  await h.api('/api/coffer/agent/appeals/prepare',{appealId:unsent.id},{status:409})
  resultMode='dropped'
  await h.api('/api/coffer/agent/appeals/run',{appealId:unsent.id})
  await h.command('consent.record',{donorIds:[donors[0].id],channel:'email',status:'withdrawn',method:'email reply',evidence:'Synthetic withdrawal',capturedOn:'2026-09-02'})
  const subset=await h.api('/api/coffer/agent/appeals/prepare',{appealId:unsent.id})
  assert.equal((await h.get('/api/coffer/appeals/'+subset.id)).recipients.length,6,'New resend excludes current opt-outs')
 },{outbound:async request=>{
  const u=new URL(request.url),path=u.pathname.replace('/3.0',''),raw=request.method==='GET'?'':await request.text(),body=raw?JSON.parse(raw):null
  assert.equal(u.hostname,'us21.api.mailchimp.com')
  if(path==='/lists')return Response.json(fixture.lists??{lists:[{id:'fixture-list',name:'Fixture audience',stats:{member_count:7}}]})
  if(path.includes('/members/')&&path.startsWith('/lists/fixture-list')){
   const d=[...contacts.values()].find(x=>x.hash===path.split('/').at(-1))
   if(request.method==='PUT'){if(d)d.status=body.status;return Response.json(d??fixture.member_unsubscribed)}
   return Response.json(d??{...fixture.member_subscribed,email_address:await emailForHash(path.split('/').at(-1))})
  }
  if(path==='/lists/fixture-list/segments'&&request.method==='POST'){
   const id=segments.size+1,email=body.static_segment[0];segments.set(id,email)
   const {createHash}=await import('node:crypto');contacts.set(email,{...fixture.member_subscribed,email_address:email,hash:createHash('md5').update(email).digest('hex')})
   return Response.json({...fixture.static_segment,id})
  }
  if(path.match(/^\/lists\/fixture-list\/segments\/\d+\/members$/))return Response.json({members:[{...fixture.member_subscribed,email_address:segments.get(Number(path.split('/')[4]))}],total_items:1})
  if(path==='/campaigns'&&request.method==='POST'){
   const id='campaign-'+(campaigns.size+1);campaigns.set(id,{...body,id,status:'save',recipients:{...body.recipients,recipient_count:1}});return Response.json({id})
  }
  const m=path.match(/^\/campaigns\/([^/]+)(.*)$/)
  if(m){const campaign=campaigns.get(m[1]);assert.ok(campaign,path)
   if(m[2]==='/actions/send'){campaign.status='sent';sends++;return new Response(null,{status:204})}
   if(request.method==='PATCH')Object.assign(campaign,body)
   return Response.json(campaign)
  }
  const report=path.match(/^\/reports\/campaign-(\d+)\/sent-to$/)
  if(report){const n=Number(report[1]),campaign=campaigns.get('campaign-'+n),email=segments.get(campaign.recipients.segment_opts.saved_segment_id)
   const dropped=resultMode==='dropped'||resultMode==='normal'&&n<=4
   return Response.json({total_items:dropped?0:1,sent_to:dropped?[]:[{email_address:resultMode==='mismatch'?'other@example.test':email,status:n===5?'hard':'sent'}]})
  }
  assert.fail(request.method+' '+path)
 }})
 async function emailForHash(hash){
  const {createHash}=await import('node:crypto')
  const emails=['avery.chen','bill.carter','cora.diaz','dalia.evans','eli.fox','farah.green','grace.hill','grace.changed'].map(n=>n+'@example.org')
  return emails.find(e=>createHash('md5').update(e).digest('hex')===hash)
 }
})

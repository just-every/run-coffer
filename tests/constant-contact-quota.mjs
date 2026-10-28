import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'
import {constantContactEdge,ccAddress} from './constant-contact-edge.mjs'

export async function constantContactQuotaJourney(){
 const edge=constantContactEdge(),start=Date.parse('2026-10-16T12:00:00Z'),count=Number(process.env.COFFER_CC_RECIPIENTS??8)
 await run(async h=>{
  const headers={'x-test-now':new Date(start).toISOString()},cmd=(name,p={})=>h.command(name,p,{headers})
  await reviewed(h)
  await cmd('marketing.connectConstantContact',{accessToken:'synthetic-coffer-3602',fromName:'Riverbend Literacy Project',fromEmail:edge.sender,replyToEmail:edge.reply,trackingDisabled:'yes',trackingEvidence:'Support confirmed tracking Off',confirm:'yes'})
  const donors=[]
  for(let n=0;n<count;n++){
   const email=ccAddress(4000+n),d=await donor(h,'Reading supporter '+n,{email},{headers});donors.push(d)
   edge.contacts.set(email,{contact_id:'synthetic-coffer-contact-'+n,email_address:{address:email,permission_to_send:'explicit'},list_memberships:[]})
   await cmd('consent.record',{donorId:d.id,channel:'email',status:'granted',method:'paper form',evidence:'Donor choice',capturedOn:'2026-10-16'})
  }
  for(let n=0;n<2;n++){
   if(n===1)edge.state.scheduleStatus='SCHEDULED'
   const appeal=await cmd('appeal.prepare',{name:'Reading update '+n,channel:'email',purpose:'newsletter',isAsk:'no',subject:'Reading room news',body:'Your support keeps the reading room open.'})
   assert.equal(appeal.recipients,count)
   await cmd('appeal.approve',{appealId:appeal.id,version:1})
   let result;do{result=await cmd('appeal.send',{appealId:appeal.id,version:2});assert.equal(result.uncertain,0);assert.equal(result.suppressed,0)}while(result.remaining)
  }
  assert.equal(edge.sends.length,count*2,'Repeated appeals send every approved recipient')
  assert.ok(edge.state.peakLists<=count,'Repeated appeals do not accumulate permanent recipient lists')
  const before=edge.requests.length,writes=edge.writes.length
  for(let minute=1;minute<=24*60;minute++){
   if(minute===30){for(const activity of edge.campaigns.values())activity.current_status='DONE';edge.state.holdDelete=true}
   if(minute===45)edge.state.holdDelete=false
   const response=await h.request('/cdn-cgi/local/scheduled?time='+(start+minute*60000)+'&format=json');assert.equal(response.status,200,await response.text())
   if(minute===15)assert.equal(edge.lists.size,count,'Pending campaigns retain all their isolated audiences')
   if(minute===30){assert.equal(edge.lists.size,count,'Asynchronous deletion retains the cleanup receipt')}
   if(minute===45){const deletions=edge.requests.filter(r=>r.startsWith('DELETE '));assert.equal(new Set(deletions).size,deletions.length,'Pending deletion activities are followed without resubmission')}
   assert.ok(edge.requests.length-before<10000,'A day of minute scheduling stays inside the standard provider request allowance')
  }
  assert.equal(edge.writes.length,writes,'Unchanged profile checks do not rewrite contacts')
  assert.equal(edge.lists.size,0,'Completed audiences are reclaimed without a manual refresh')
  const last={headers:{'x-test-now':new Date(start+24*60*60000).toISOString()}}
  await h.command('consent.record',{donorId:donors[0].id,channel:'email',status:'withdrawn',method:'paper form',evidence:'New donor stop',capturedOn:'2026-10-17'},last)
  assert.equal(edge.contacts.get(ccAddress(4000)).email_address.permission_to_send,'unsubscribed','A withdrawal bypasses the background cooldown')
  console.log(JSON.stringify({recipients:count,campaignSubmissions:edge.sends.length,peakLists:edge.state.peakLists,scheduledDayRequests:edge.requests.length-before,remainingLists:edge.lists.size}))
 },{entry:'tests/constant-contact-worker.ts',triggerHandlers:true,outbound:edge.outbound,bindings:{COFFER_REPLY_ADDRESS:edge.reply,COFFER_TEST_NOW:new Date(start).toISOString()}})
}

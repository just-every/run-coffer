import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {run,donor} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function smsJourney(){
 const account='synthetic-coffer-1',token='synthetic-coffer-2',sender='+12025550101',requests=[]
 let unknown=false
 const outbound=async request=>{
  const url=new URL(request.url)
  assert.equal(url.origin,'https://api.twilio.com')
  assert.equal(url.pathname,`/2010-04-01/Accounts/${account}/Messages.json`)
  assert.equal(request.method,'POST')
  const body=new URLSearchParams(await request.text());assert.equal(body.get('From'),sender)
  requests.push(Object.fromEntries(body))
  if(unknown)throw new Error('Synthetic network interruption after submission')
  return Response.json({sid:'synthetic-coffer-'+(requests.length+10),status:'queued'},{status:201})
 }
 await run(async h=>{
  const at='2026-10-15T16:00:00Z',dayHeaders={'x-test-now':at},nightHeaders={'x-test-now':'2026-10-15T02:00:00Z'}
  const command=(name,input,options={})=>h.command(name,input,{headers:dayHeaders,...options})
  const get=(id)=>h.get('/api/coffer/texts?runId='+id,{headers:dayHeaders})
  const a=await donor(h,'Synthetic SMS One',{phone:'+12025550111'}),b=await donor(h,'Synthetic SMS Two',{phone:'+12025550112'}),missing=await donor(h,'Synthetic SMS No Phone'),unconsented=await donor(h,'Synthetic SMS No Permission',{phone:'+12025550113'})
  const preference=async(d,status='granted',version=0)=>command('sms.preference',{donorId:d.id,phone:d.id===a.id?'+12025550111':'+12025550112',timezone:'America/New_York',status,version,evidence:'Synthetic donor request recorded by staff',capturedOn:'2026-10-15'})
  const pa=await preference(a),pb=await preference(b)
  assert.equal(pa.preference.source,'person');assert.equal(pb.preference.status,'granted')
  const prepare=(purpose,donorIds=[a.id],body='Thank you for supporting the reading room.')=>command('sms.prepare',{name:'Synthetic text run',purpose,donorIds,body})
  await command('solicitation.set',{donorId:a.id,version:0,type:'stop',startsOn:'2026-10-15',source:'person'})
  const appeal=await prepare('appeal',[a.id,missing.id,unconsented.id])
  assert.deepEqual(appeal.excluded.map(x=>x.reason).sort(),['do not solicit','no SMS consent recorded','no phone'])
  assert.equal(appeal.recipients,0)
  const thanks=await prepare('thank-you')
  assert.equal(thanks.recipients,1,'A restricted donor can receive a non-ask text')
  await command('sms.send',{runId:thanks.id,version:1},{status:409})
  assert.equal(requests.length,0,'Preparation never sends')
  const approved=await command('sms.approve',{runId:thanks.id,version:1})
  const held=await command('sms.send',{runId:thanks.id,version:approved.version},{headers:nightHeaders})
  assert.equal(held.held,1);assert.equal(requests.length,0)
  assert.equal((await get(thanks.id)).recipients[0].state,'held')
  const sent=await command('sms.send',{runId:thanks.id,version:approved.version})
  assert.equal(sent.submitted,1);assert.equal(requests.length,1)
  assert.equal(requests[0].Body,'Thank you for supporting the reading room.')
  assert.equal((await get(thanks.id)).recipients[0].provider_status,'queued')
  assert.equal((await command('sms.send',{runId:thanks.id,version:approved.version})).submitted,0)
  assert.equal(requests.length,1,'Repeated human send cannot submit the same text twice')
  const stale=await prepare('thank-you',[b.id]);await command('sms.approve',{runId:stale.id,version:1})
  const withdrawn=await preference(b,'withdrawn',pb.preference.id)
  await command('sms.send',{runId:stale.id,version:2},{status:409})
  assert.equal(requests.length,1,'Withdrawal fences an already approved message')
  await preference(b,'granted',withdrawn.preference.id)
  const changed=await prepare('appeal',[b.id]);await command('sms.approve',{runId:changed.id,version:1})
  await command('solicitation.set',{donorId:b.id,version:0,type:'stop',startsOn:'2026-10-15',source:'person'})
  await command('sms.send',{runId:changed.id,version:2},{status:409})
  assert.equal(requests.length,1,'A new restriction fences an approved ask')
  const uncertain=await prepare('thank-you',[b.id]);await command('sms.approve',{runId:uncertain.id,version:1})
  unknown=true
  assert.equal((await command('sms.send',{runId:uncertain.id,version:2})).uncertain,1)
  await command('sms.send',{runId:uncertain.id,version:2});assert.equal(requests.length,2)
  assert.equal((await get(uncertain.id)).recipients[0].state,'uncertain')
  unknown=false
  await command('pledge.create',{donorId:a.id,amount:'100',pledgedOn:'2026-10-15',installments:[{dueOn:'2026-11-01',amount:'100'}]})
  const reminder=await prepare('pledge-reminder',[a.id],'Your promised reading room installment is due November 1.')
  assert.equal(reminder.recipients,1)
  await command('sms.approve',{runId:reminder.id,version:1})
  assert.equal((await command('sms.send',{runId:reminder.id,version:2})).submitted,1,'Restricted donors still receive their own pledge reminders')
  const member=await h.person('synthetic.sms.member@example.test')
  await command('sms.prepare',{name:'Refused',purpose:'thank-you',donorIds:[a.id],body:'Thanks'},{as:member.cookie,status:403})
  const hook='/api/coffer/sms/webhook',fields=new URLSearchParams({AccountSid:account,MessageSid:'synthetic-coffer-30',From:'+12025550111',To:sender,Body:'STOP',ExtraFutureField:'retained in signature'})
  const payload=h.origin+hook+[...fields.keys()].sort().map(k=>k+fields.get(k)).join(''),signature=createHmac('sha1',token).update(payload).digest('base64')
  const post=(sig)=>h.request(hook,{method:'POST',as:'',raw:fields.toString(),headers:{...dayHeaders,'content-type':'application/x-www-form-urlencoded','x-twilio-signature':sig}})
  assert.equal((await post('invalid')).status,403)
  assert.equal((await post(signature)).status,200)
  const stopped=await h.get('/api/coffer/donors/'+a.id+'/sms',{headers:dayHeaders})
  assert.equal(stopped.preference.status,'withdrawn');assert.equal(stopped.preference.source,'twilio-stop')
  assert.equal((await post(signature)).status,200)
  assert.equal((await h.get('/api/coffer/donors/'+a.id+'/sms',{headers:dayHeaders})).preference.id,stopped.preference.id,'Webhook replay does not add another consent row')
  const blocked=await prepare('thank-you');assert.equal(blocked.recipients,0);assert.equal(blocked.excluded[0].reason,'SMS consent withdrawn')
  if(process.env.COFFER_SMS_BROWSER){
   const directory=process.env.COFFER_SMS_BROWSER;await mkdir(directory,{recursive:true})
   await withBrowserWorker(h,async(context,origin)=>{
    const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/texts?runId='+thanks.id)
     await page.getByText('Thank you for supporting the reading room.',{exact:true}).waitFor()
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await page.screenshot({path:`${directory}/DONOR-015-texts-${width}.png`,fullPage:true})
     await page.goto(origin+'/app/donors/'+a.id);await page.locator('#sms-permission').scrollIntoViewIfNeeded()
     await page.locator('#sms-permission').screenshot({path:`${directory}/DONOR-015-sms-permission-${width}.png`})
    }
    await page.close()
   })
  }
 },{entry:'tests/advancing-clock-worker.ts',bindings:{TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:token,TWILIO_FROM:sender},outbound})
}

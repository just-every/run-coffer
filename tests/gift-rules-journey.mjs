import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run, donor, reviewed} from './harness.mjs'
import {recognitionEdges, giveRecognition} from './recognition-edge.mjs'

const csv=(name,rows)=>({name,base64:Buffer.from(rows.map(r=>r.join(',')).join('\r\n')).toString('base64')})

/** Real HTTP writes/reads; only Stripe, mail and the team webhook are faked. */
export async function giftRulesJourney() {
 const edge=recognitionEdges(),notices=[]
 await run(async h=>{
  await reviewed(h)
  const member=await h.person('synthetic-coffer-301@example.test'),admin=await h.person('synthetic-coffer-302@example.test','admin')
  const state=()=>h.get('/api/coffer/gift-rules')
  const owner=(await state()).owners.find(o=>o.id!==member.id&&o.id!==admin.id)
  assert.ok(owner)
  const callInput={name:'synthetic-coffer-303',kind:'amount_call',minimum:'1000',ownerId:owner.id}
  await h.command('giftRule.save',callInput,{as:'',status:401})
  await h.command('giftRule.save',callInput,{as:member.cookie,status:403})
  const call=await h.command('giftRule.save',callInput),tag=await h.command('giftRule.save',{name:'synthetic-coffer-304',kind:'first_tag',tag:'synthetic-coffer-305'},{as:admin.cookie})
  await h.command('giftRule.publish',{ruleId:call.id,version:call.version},{status:400})
  const publish=rule=>h.command('giftRule.publish',{ruleId:rule.id,version:rule.version,reviewed:'yes'})
  await publish(call);await publish(tag)
  await h.command('giftRule.publish',{ruleId:call.id,version:call.version,reviewed:'yes'},{status:409})
  await h.api('/api/coffer/giving/campaigns',{name:'synthetic-coffer-306',slug:'autumn-reading',description:'synthetic-coffer-306',fund:'synthetic-coffer-307',goal:'10000'})
  const values={name:'synthetic-coffer-308',email:'synthetic-coffer-308@example.test',amount:'1000'}
  const given=await giveRecognition(h,values)
  let current=await state()
  assert.equal(current.firings.length,2,'STEW-005: the new form gift fires both published rules')
  const fired=current.firings.find(f=>f.action==='amount_call'),tags=current.tags
  assert.equal(tags.length,1);assert.equal(tags[0].tag,'synthetic-coffer-305')
  const history=await h.get('/api/coffer/donors/'+tags[0].donor_id),gift=history.gifts.find(g=>g.id===fired.gift_id)
  assert.ok(gift)
  assert.equal(Date.parse(fired.due_at)-Date.parse(gift.created_at),48*3600000)
  const task=(await h.get('/api/coffer/tasks')).tasks.find(t=>t.id===fired.task_id)
  assert.equal(task.owner_id,owner.id);assert.equal(task.amount_cents,100000);assert.equal(task.is_ask,0,'Gift-triggered thank-you calls are non-asks')
  assert.ok(task.reason.includes(fired.due_at),'The ordinary call task exposes its exact deadline')
  assert.equal((await h.request('/giving/thanks?session_id='+given.sessionId)).status,200)
  assert.equal((await state()).firings.length,2,'Return-page replay creates no duplicate action')
  const input={source:'bloomerang',noGoodsOrServices:true,files:[
   csv('constituents.csv',[['Account Number','Name'],['synthetic-coffer-309','synthetic-coffer-309']]),
   csv('gifts.csv',[['Transaction Number','Account Number','Gift Type','Gift Date','Amount','Payment Method'],['synthetic-coffer-310','synthetic-coffer-309','Donation','2025-10-01','1500','Check']]),
  ]}
  const preview=await h.api('/api/coffer/move-in/preview',input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
  let imported=await h.api('/api/coffer/move-in/apply',{id:preview.id,fingerprint:preview.fingerprint,acknowledged:'no'})
  while(imported.state==='applying')imported=await h.api('/api/coffer/move-in/continue',{id:preview.id})
  assert.equal(imported.state,'completed')
  assert.equal((await state()).firings.length,2,'STEW-005: imported historical gifts do not fire')
  assert.equal((await state()).tags.length,1,'Imported first gifts do not add tags')
  // A later gift is below the threshold and is no longer the donor’s first.
  await giveRecognition(h,{...values,amount:'999.99'})
  assert.equal((await state()).firings.length,2)
  const notification=await h.command('giftRule.save',{name:'synthetic-coffer-311',kind:'fund_notify',fund:'synthetic-coffer-307',provider:'slack'})
  await h.command('giftRule.save',{name:'synthetic-coffer-318',kind:'fund_notify',fund:'synthetic-coffer-307',provider:'nook'},{status:400})
  assert.equal(notices.length,0,'Saving configuration cannot contact the team')
  await publish(notification)
  await giveRecognition(h,{...values,amount:'1'})
  assert.equal(notices.length,1,JSON.stringify(await state()))
  assert.ok(notices[0].text.includes('synthetic-coffer-307'))
  assert.ok(!notices[0].text.includes(values.name)&&!notices[0].text.includes(values.email),'The notice does not share donor identity')
  assert.equal((await state()).firings.find(f=>f.rule_id===notification.id).status,'submitted')
  // An edit withdraws publication until a human reviews the new version.
  current=await state()
  const live=current.rules.find(r=>r.id===notification.id)
  await h.command('giftRule.save',{...live,ruleId:live.id,name:'synthetic-coffer-312',kind:'fund_notify',fund:'synthetic-coffer-307',provider:'slack'})
  await giveRecognition(h,{...values,amount:'1'})
  assert.equal(notices.length,1)
  const manual=await donor(h,'synthetic-coffer-313',{email:'synthetic-coffer-313@example.test'})
  const receivedOn=new Intl.DateTimeFormat('en-CA',{timeZone:(await h.get('/api/coffer/settings')).timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  await h.command('solicitation.set',{donorId:manual.id,version:0,type:'stop',startsOn:'2000-01-01'})
  const record=(amount,on=receivedOn)=>h.command('gift.record',{donorId:manual.id,amount,receivedOn:on,method:'check',fund:'Unrestricted',goods:'none'})
  const firstManual=await record('1000')
  assert.equal((await state()).firings.filter(f=>f.action==='amount_call').length,2,'Manual live gifts use the same evaluator')
  const manualTask=(await h.get('/api/coffer/tasks')).tasks.find(t=>t.source_key===`gift-rule:${call.id}:${firstManual.id}`)
  assert.equal(manualTask.is_ask,0,'A do-not-solicit donor still receives a non-ask thank-you task')
  const backdated=await record('1','2000-01-01')
  assert.ok(!(await state()).firings.some(f=>f.gift_id===backdated.id&&f.action==='first_tag'),'Backdating a later gift does not make it the first recorded gift')
  for(const giftId of [firstManual.id,backdated.id])await h.command('gift.reverse',{giftId,reason:'synthetic-coffer-319',reversedOn:receivedOn})
  const afterReversal=await record('1')
  assert.ok(!(await state()).firings.some(f=>f.gift_id===afterReversal.id&&f.action==='first_tag'),'Reversing previous gifts does not make a later gift the first recorded gift')
  await h.get('/api/coffer/gift-rules',{as:'',status:401})
  assert.equal((await h.request('/app/gift-rules')).status,200)
  if(process.env.COFFER_STEW005_BROWSER){
   const directory=process.env.COFFER_STEW005_BROWSER
   await mkdir(directory,{recursive:true})
   const {withBrowserWorker}=await import('./browser-worker.mjs')
   await withBrowserWorker(h,async(context,origin)=>{
    await context.setExtraHTTPHeaders({cookie:h.owner})
    const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/gift-rules')
     assert.ok(await page.getByRole('heading',{name:'Gift rules',exact:true}).count())
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await page.screenshot({path:`${directory}/STEW-005-${width}.png`,fullPage:true})
    }
   })
  }
 },{bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-314',GIFT_RULE_SLACK_URL:'https://hooks.slack.com/services/synthetic-coffer-315/synthetic-coffer-316/synthetic-coffer-317'},outbound:async request=>{
  if(new URL(request.url).hostname==='hooks.slack.com'){assert.equal(request.method,'POST');assert.equal(request.headers.get('content-type'),'application/json');notices.push(await request.json());return new Response('ok',{status:200})}
  return edge.outbound(request)
 }})
}

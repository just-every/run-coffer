import assert from 'node:assert/strict'
import {randomUUID,createHmac} from 'node:crypto'
import {run} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
import {mkdir} from 'node:fs/promises'
export async function givingProtectionJourney(){
 const secret='synthetic-coffer-501',hookSecret='synthetic-coffer-502';let stripeCalls=0,sequence=0,lastIntent,challenge='pass'
 const outbound=async request=>{
  const u=new URL(request.url),p=new URLSearchParams(await request.text())
  if(u.hostname==='challenges.cloudflare.com'){
   assert.equal(p.get('secret'),secret)
   if(challenge==='unavailable')throw new Error('Synthetic unavailable edge')
   return Response.json({success:challenge==='pass',hostname:new URL(origin).hostname,action:'giving'})
  }
  assert.equal(u.hostname,'api.stripe.com');stripeCalls++
  if(u.pathname==='/v1/customers')return Response.json({id:'synthetic-coffer-503'})
  if(u.pathname==='/v1/checkout/sessions'){lastIntent=p.get('metadata[coffer_intent]');return Response.json({id:'synthetic-coffer-'+(++sequence+510),url:'https://checkout.stripe.com/c/pay/synthetic-coffer-504'})}
  if(u.pathname==='/v1/charges/synthetic-coffer-505')return Response.json({id:'synthetic-coffer-505',status:'failed',paid:false,outcome:{type:'blocked',reason:'rule'},metadata:{coffer_intent:lastIntent}})
  assert.fail('Unexpected Stripe path '+u.pathname)
 }
 let origin
 await run(async h=>{
  origin=h.origin
  const c=await h.api('/api/coffer/giving/campaigns',{name:'Synthetic protected form',slug:'protected',description:'Protected giving.',fund:'Books',goal:'1000'})
  await h.command('giving.protection',{siteKey:'synthetic-coffer-506',secret})
  const attempt=(slug='protected',ip='192.0.2.1',amount='1.00',token='synthetic-coffer-507')=>h.request('/give/'+slug+'/checkout',{method:'POST',as:'',headers:{'CF-Connecting-IP':ip,'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({name:'Synthetic unconfirmed giver',email:'synthetic-coffer-508@example.test',amount,frequency:'once',requestId:randomUUID(),'cf-turnstile-response':token}).toString()})
  const statuses=[]
  for(let i=0;i<30;i++){const r=await attempt();statuses.push(r.status);await r.text()}
  assert.deepEqual(statuses.slice(0,10),Array(10).fill(303));assert.ok(statuses.slice(10).every(s=>s===429||s===409));assert.ok(statuses.includes(429));assert.equal(statuses.at(-1),409)
  const forms=(await h.get('/api/coffer/giving/protection')).forms,paused=forms.find(r=>r.campaign_id===c.id)
  assert.equal(paused.paused,1);assert.equal(paused.failures,10);assert.ok(paused.alerted_at)
  assert.equal((await h.get('/api/coffer/donors')).total,0)
  assert.equal((await h.get('/api/coffer/reports/attribution')).ledgerCents,0)
  const calls=stripeCalls
  await h.command('giving.resume',{campaignId:c.id})
  const below=await attempt('protected','192.0.2.2','0.50');assert.equal(below.status,400);await below.text();assert.equal(stripeCalls,calls)
  for(const mode of ['reject','unavailable']){challenge=mode;const r=await attempt('protected','192.0.2.3');assert.equal(r.status,403);await r.text();assert.equal(stripeCalls,calls)}
  const noToken=await attempt('protected','192.0.2.4','1.00','');assert.equal(noToken.status,403);await noToken.text()
  challenge='pass';const ready=await attempt('protected','192.0.2.5');assert.equal(ready.status,303);await ready.text()
  const event={id:'synthetic-coffer-509',type:'charge.failed',data:{object:{id:'synthetic-coffer-505'}}},raw=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000),signature=createHmac('sha256',hookSecret).update(timestamp+'.'+raw).digest('hex')
  for(let i=0;i<2;i++){const r=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{'stripe-signature':`t=${timestamp},v1=${signature}`}});assert.equal(r.status,200,await r.text())}
  const radar=(await h.get('/api/coffer/giving/protection')).forms.find(r=>r.campaign_id===c.id)
  assert.equal(radar.failures,4,'The signed blocked charge counts once in addition to three refused challenges')
  assert.equal((await h.get('/api/coffer/donors')).total,0);assert.equal((await h.get('/api/coffer/reports/attribution')).ledgerCents,0)
  const member=await h.person('synthetic-coffer-530@example.test');await h.command('giving.resume',{campaignId:c.id},{as:member.cookie,status:403})
  await h.get('/api/coffer/giving/protection',{as:member.cookie,status:403})
  if(process.env.COFFER_PROTECTION_BROWSER){
   await mkdir(process.env.COFFER_PROTECTION_BROWSER,{recursive:true})
   // Recreate a paused state through the same address gate.
   for(let i=0;i<30;i++){const r=await attempt('protected','192.0.2.7');await r.text()}
   await withBrowserWorker(h,async(context,browserOrigin)=>{
    await context.route('https://challenges.cloudflare.com/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}))
    const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000});await page.goto(browserOrigin+'/app/giving/setup');await page.getByRole('alert').filter({hasText:'Synthetic protected form is paused'}).waitFor()
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await page.screenshot({path:`${process.env.COFFER_PROTECTION_BROWSER}/GIVE-007-alert-${width}.png`,fullPage:true})
     await page.goto(browserOrigin+'/give/protected');assert.equal(await page.locator('.cf-turnstile').count(),1)
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await page.screenshot({path:`${process.env.COFFER_PROTECTION_BROWSER}/GIVE-007-form-${width}.png`,fullPage:true})
    }
   })
  }
 },{bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-531',STRIPE_WEBHOOK_SECRET:hookSecret},outbound})
}

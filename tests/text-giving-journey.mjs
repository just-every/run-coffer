import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {run,donor,archive,restore} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
const account='synthetic-coffer-410',token='synthetic-coffer-411',from='+12025550101',phone='+12025550131'
export async function textGivingJourney(){
 let intent,customer='synthetic-coffer-412',session='synthetic-coffer-413',pi='synthetic-coffer-414'
 const outbound=async request=>{
  const u=new URL(request.url),p=new URLSearchParams(await request.text());assert.equal(u.hostname,'api.stripe.com')
  if(u.pathname==='/v1/customers')return Response.json({id:customer})
  if(u.pathname==='/v1/checkout/sessions'){intent=p.get('metadata[coffer_intent]');return Response.json({id:session,url:'https://checkout.stripe.com/c/pay/synthetic-coffer-413'})}
  if(u.pathname==='/v1/checkout/sessions/'+session)return Response.json({id:session,metadata:{coffer_intent:intent},customer,currency:'usd',amount_total:2500,status:'complete',payment_status:'paid',payment_intent:pi})
  if(u.pathname==='/v1/payment_intents/'+pi)return Response.json({id:pi,status:'succeeded',currency:'usd',amount_received:2500,created:Math.floor(Date.now()/1000)})
  assert.fail('Unexpected provider request '+u.pathname)
 }
 await run(async h=>{
  const d=await donor(h,'Synthetic Text Giver',{email:'synthetic-coffer-415@example.test',phone})
  await h.command('sms.preference',{donorId:d.id,phone,timezone:'America/New_York',status:'granted',version:0,evidence:'Synthetic explicit request',capturedOn:new Intl.DateTimeFormat('en-CA',{timeZone:(await h.get('/api/coffer/settings')).timezone}).format(new Date())})
  await h.command('giving.connectTwilio',{account,token,from})
  const c=await h.api('/api/coffer/giving/campaigns',{name:'Synthetic reading fund',slug:'text-reading',description:'Books for the reading room.',fund:'Reading',goal:'5000'})
  await h.command('appealCode.define',{code:'TEXT26',name:'Synthetic text appeal'})
  await h.command('giving.keyword',{keyword:'READ',campaignId:c.id,appeal:'TEXT26'})
  const member=await h.person('synthetic-coffer-416@example.test')
  await h.command('giving.keyword',{keyword:'BOOK',campaignId:c.id},{as:member.cookie,status:403})
  await h.command('giving.connectTwilio',{account,token,from},{as:member.cookie,status:403})
  await h.command('giving.keyword',{keyword:'STOP',campaignId:c.id},{status:400})
  const hook='/api/coffer/sms/webhook'
  const post=async(body,id,valid=true,number=phone)=>{
   const fields=new URLSearchParams({AccountSid:account,MessageSid:id,From:number,To:from,Body:body})
   const signature=createHmac('sha1',token).update(h.origin+hook+[...fields.keys()].sort().map(k=>k+fields.get(k)).join('')).digest('base64')
   return h.request(hook,{method:'POST',as:'',raw:fields.toString(),headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':valid?signature:'invalid'}})
  }
  assert.equal((await post('READ','synthetic-coffer-417',false)).status,403)
  const reply=await post('read','synthetic-coffer-418');assert.equal(reply.status,200)
  const xml=await reply.text(),link=new URL(xml.match(/https:[^< ]+/)[0].replaceAll('&amp;','&'))
  assert.equal(link.origin,h.origin);assert.ok(!link.href.includes(phone));assert.match(xml,/Reply STOP/)
  assert.equal(await (await post('READ','synthetic-coffer-418')).text(),'<Response/>','Provider replay never sends another link')
  const page=await h.request(link.pathname+link.search,{as:''});assert.equal(page.status,200)
  assert.match(await page.text(),/Text-to-give phone/)
  const altered=await h.request('/give/text-reading?text='+encodeURIComponent(link.searchParams.get('text')+'x'),{as:''});assert.equal(altered.status,503)
  if(process.env.COFFER_TEXT_BROWSER){
   await mkdir(process.env.COFFER_TEXT_BROWSER,{recursive:true})
   await withBrowserWorker(h,async(context,origin)=>{
    const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000});await page.goto(origin+link.pathname+link.search)
     assert.equal(await page.getByLabel('Text-to-give phone').inputValue(),phone)
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await page.screenshot({path:`${process.env.COFFER_TEXT_BROWSER}/GIVE-008-form-${width}.png`,fullPage:true})
     await page.goto(origin+'/app/giving/setup');await page.getByRole('heading',{name:'Text-to-give',exact:true}).waitFor()
     assert.equal(await page.getByLabel('Twilio auth token').inputValue(),'')
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await page.screenshot({path:`${process.env.COFFER_TEXT_BROWSER}/GIVE-008-settings-${width}.png`,fullPage:true})
    }
   })
  }
  const values={name:'Synthetic Text Giver',email:'synthetic-coffer-415@example.test',amount:'25',frequency:'once','cf-turnstile-response':'synthetic-coffer-security-token',requestId:randomUUID(),textLink:link.searchParams.get('text')}
  const checkout=await h.request('/give/text-reading/checkout',{method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(values).toString()});assert.equal(checkout.status,303,await checkout.text())
  const thanks=await h.request('/giving/thanks?session_id='+session,{as:''});assert.equal(thanks.status,200,await thanks.text())
  const report=await h.get('/api/coffer/reports/attribution')
  assert.equal(report.ledgerCents,2500);assert.deepEqual(report.channel,[{key:'text',label:'Text-to-give',gifts:1,amountCents:2500}]);assert.equal(report.appeal[0].key,'TEXT26')
  assert.equal((await h.get('/api/coffer/donors/'+d.id)).gifts.length,1)
  const before=(await h.get('/api/coffer/donors/'+d.id+'/sms')).preference.id
  assert.equal((await post('STOP','synthetic-coffer-419')).status,200)
  const stopped=(await h.get('/api/coffer/donors/'+d.id+'/sms')).preference
  assert.equal(stopped.status,'withdrawn');assert.ok(stopped.id>before)
  assert.equal((await h.get('/api/coffer/donors/'+d.id)).consents.find(x=>x.channel==='sms').status,'withdrawn')
  assert.equal(await (await post('READ','synthetic-coffer-420')).text(),'<Response/>')
  assert.equal((await h.request(link.pathname+link.search,{as:''})).status,409)
  assert.equal((await post('STOP','synthetic-coffer-421',true,'+12025550139')).status,200)
  assert.equal(await (await post('READ','synthetic-coffer-422',true,'+12025550139')).text(),'<Response/>','Unknown senders retain their STOP without a donor record')
  const saved=await archive(h)
  assert.ok(!JSON.stringify(saved).includes(token),'Sealed provider settings are excluded from the archive')
 },{bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-423'},outbound})
}

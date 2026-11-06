import assert from 'node:assert/strict'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {form,recognitionMember} from './recognition-edge.mjs'
import {assertAttributionTotals} from './attribution-journey.mjs'
import {emailAttributionBrowser} from './appeal-email-attribution-browser.mjs'

const address=n=>'synthetic-coffer-'+n+String.fromCharCode(64)+'example.test'
const webhookSecret='synthetic-coffer-9710',instant=Date.parse('2026-10-15T16:00:00Z')/1000
const md5=value=>createHash('md5').update(value).digest('hex')

// Only the documented provider, payment and mail network boundaries are faked.
function edges(provider){
 const state={contacts:new Map(),segments:new Map(),campaigns:new Map(),contents:[],handoffs:[],sessions:new Map(),charges:new Map(),entries:[],refunds:new Map(),mails:[],writes:[],serial:0}
 const outbound=async request=>{
  const u=new URL(request.url),path=u.pathname,method=request.method
  if(u.hostname==='api.sendgrid.com'){state.mails.push(await request.json());return new Response(null,{status:202,headers:{'x-message-id':'synthetic-coffer-'+state.mails.length}})}
  if(u.hostname==='api.stripe.com'){
   if(method==='POST'){
    const p=new URLSearchParams(await request.text());state.writes.push({path,values:Object.fromEntries(p)})
    if(path==='/v1/customers')return Response.json({id:'cus_synthetic_coffer_'+(++state.serial)})
    if(path==='/v1/checkout/sessions'){
     const n=state.serial,id='cs_synthetic_coffer_'+n,pi='pi_synthetic_coffer_'+n,chargeId='ch_synthetic_coffer_'+n
     assert.equal(p.get('mode'),'payment')
     const session={id,url:'https://checkout.stripe.com/c/pay/'+id,metadata:{coffer_intent:p.get('metadata[coffer_intent]')},customer:p.get('customer'),currency:'usd',amount_total:Number(p.get('line_items[0][price_data][unit_amount]')),status:'complete',payment_status:'paid',payment_intent:pi}
     const charge={id:chargeId,paid:true,status:'succeeded',currency:'usd',amount:session.amount_total,created:instant,metadata:session.metadata,customer:session.customer,payment_intent:pi,balance_transaction:'txn_synthetic_coffer_'+n,amount_refunded:0}
     state.sessions.set(id,session);state.charges.set(chargeId,charge)
     state.entries.push({id:charge.balance_transaction,type:'charge',source:chargeId,amount:session.amount_total,fee:175,net:session.amount_total-175,currency:'usd',created:instant})
     return Response.json(session)
    }
    assert.fail('Unexpected payment write '+path)
   }
   if(path==='/v1/invoice_payments')return Response.json({data:[],has_more:false})
   if(path==='/v1/balance_transactions')return Response.json({data:state.entries,has_more:false})
   if(path.startsWith('/v1/balance_transactions/'))return Response.json(state.entries.find(e=>e.id===path.split('/').at(-1)))
   if(path==='/v1/payouts/po_synthetic_coffer')return Response.json({id:'po_synthetic_coffer',status:'paid',arrival_date:instant,amount:state.entries.reduce((n,e)=>n+e.net,0),currency:'usd',automatic:true,reconciliation_status:'completed'})
   if(path==='/v1/refunds')return Response.json({data:[...state.refunds.values()],has_more:false})
   if(path.startsWith('/v1/refunds/'))return Response.json(state.refunds.get(path.split('/').at(-1)))
   if(path.startsWith('/v1/charges/'))return Response.json(state.charges.get(path.split('/').at(-1)))
   const session=[...state.sessions.values()].find(s=>path==='/v1/checkout/sessions/'+s.id||path==='/v1/payment_intents/'+s.payment_intent)
   if(session)return Response.json(path.includes('/payment_intents/')?{id:session.payment_intent,status:'succeeded',currency:'usd',amount_received:session.amount_total,created:instant,metadata:session.metadata}:session)
   assert.fail('Unexpected Stripe read '+path)
  }
  const raw=method==='GET'?'':await request.text(),body=raw?JSON.parse(raw):null
  if(u.hostname==='mango.example.test'){
   const suffix=path.replace('/api/integrations/v1','')
   if(suffix==='/segments')return Response.json({segments:[]})
   if(suffix==='/events')return Response.json({events:[],nextCursor:0})
   if(suffix.endsWith('/send')||suffix==='/contacts'&&method==='PUT'&&!body.email)return Response.json({error:'invalid'},{status:400})
   if(suffix==='/contacts'&&method==='GET')return Response.json({contacts:state.contacts.has(u.searchParams.get('email'))?[state.contacts.get(u.searchParams.get('email'))]:[]})
   if(suffix==='/contacts'&&method==='PUT'){
    state.handoffs.push(body.email)
    const contact={...body,id:'synthetic-coffer-9711',emailStatus:'subscribed',segmentIds:[body.segmentName]};state.contacts.set(body.email,contact)
    return Response.json({contact})
   }
   if(suffix==='/suppressions'){state.contacts.get(body.email).emailStatus='suppressed';return Response.json({ok:true})}
  }
  if(u.hostname==='us21.api.mailchimp.com'){
   if(path==='/3.0/lists')return Response.json({lists:[{id:'synthetic-coffer-9712',name:'Synthetic audience',stats:{member_count:state.contacts.size}}]})
   if(path.endsWith('/merge-fields'))return Response.json({merge_fields:['CF_INFORM','CF_FORMAL','CF_ENVELOP','CF_PREFIX','CF_FIRST','CF_MIDDLE','CF_LAST','CF_SUFFIX','CF_NICK'].map(tag=>({tag,type:'text'})),total_items:9})
   const member=[...state.contacts.values()].find(contact=>path.endsWith('/members/'+md5(contact.email)))
   if(member){if(body?.status)member.status=body.status;if(body?.merge_fields)member.merge_fields={...member.merge_fields,...body.merge_fields};return Response.json(member)}
   if(path.endsWith('/segments')&&method==='POST'){const id=++state.serial;state.segments.set(String(id),body.static_segment[0]);return Response.json({id,type:'static',member_count:1})}
   const segment=path.match(/\/segments\/([^/]+)\/members$/)
   if(segment)return Response.json({total_items:1,members:[state.contacts.get(state.segments.get(segment[1]))]})
   if(path==='/3.0/campaigns'&&method==='POST'){
    const id='synthetic-coffer-9713-'+(++state.serial),campaign={...body,id,status:'save',recipients:{...body.recipients,recipient_count:1}}
    state.campaigns.set(id,campaign);return Response.json(campaign)
   }
   const campaign=state.campaigns.get(path.split('/')[3])
   if(campaign){
    if(path.endsWith('/content')){state.contents.push(body);return Response.json(body)}
    if(path.endsWith('/actions/send')){state.handoffs.push(state.segments.get(String(campaign.recipients.segment_opts.saved_segment_id)));return new Response(null,{status:204})}
    if(method==='PATCH')campaign.settings=body.settings
    return Response.json(campaign)
   }
  }
  assert.fail('Unexpected sender edge '+provider+' '+method+' '+u.origin+path)
 }
 return {state,outbound}
}

export async function appealEmailAttributionJourney(){
 for(const provider of ['mailchimp','mango']){
  const edge=edges(provider),{state}=edge
  const options={entry:'tests/engagement-worker.ts',bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-9714',STRIPE_WEBHOOK_SECRET:webhookSecret,MAIL_PROVIDER:'sendgrid',COFFER_TEST_NOW:'2026-10-15T16:00:00Z'},outbound:edge.outbound}
  await run(async h=>{
   await reviewed(h)
   const recipient=await donor(h,'Synthetic Appeal Recipient',{email:address(9715)})
   const giver=await donor(h,'Synthetic Independent Giver',{email:address(9716)})
   await h.command('consent.record',{donorId:recipient.id,channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-9717',capturedOn:'2026-10-01'})
   state.contacts.set(address(9715),{id:'synthetic-coffer-9718',email:address(9715),email_address:address(9715),status:'subscribed',emailStatus:'subscribed'})
   if(provider==='mailchimp'){
    await h.command('marketing.connectMailchimp',{apiKey:'synthetic-coffer-9719'.replaceAll('-','')+'-us21'})
    await h.command('marketing.chooseAudience',{listId:'synthetic-coffer-9712',fromName:'Synthetic Sender',fromEmail:address(9720)})
   }else await h.command('marketing.connectMango',{origin:'https://mango.example.test',credential:'synthetic-coffer-9721'})
   const create=(name,slug,fund,closesOn)=>h.api('/api/coffer/giving/campaigns',{name,slug,description:'Books for our community.',fund,goal:'1000',closesOn})
   const campaign=await create('Synthetic Reading','synthetic-reading','Reading','2026-10-15'),other=await create('Synthetic Meals','synthetic-meals','Meals')
   const input={name:'Synthetic '+provider+' appeal',channel:'email',donationCampaignId:campaign.id,subject:'Hello {{donor_name}}',body:'Support the reading room.'}
   const closed=await create('Synthetic Closed','synthetic-closed','Reading','2026-10-14')
   await h.command('appeal.prepare',{...input,donationCampaignId:closed.id},{status:409})
   const afterClose={headers:{'x-test-now':'2026-10-16T04:00:00Z'}}
   const member={cookie:await recognitionMember(h,{messages:state.mails},address(9722))};state.mails.length=0
   await h.command('appeal.prepare',input,{as:member.cookie,status:403})
   await h.command('appeal.prepare',input,{as:'',status:401})
   await h.command('appeal.prepare',{...input,donationCampaignId:randomUUID()},{status:409})
   await h.command('appeal.prepare',{...input,purpose:'newsletter'},{status:400})
   await emailAttributionBrowser(h,async browser=>{
    const appealId=await browser.prepare(input),detail=()=>h.get('/api/coffer/appeals/'+appealId)
    const prepared=await detail(),source=prepared.emailSource,link=new URL(source.url)
    assert.equal(source.code,'RUN-'+appealId);assert.equal(source.campaign_id,campaign.id)
    assert.equal(prepared.message.body,input.body+'\n\nGive: '+source.url)
    assert.equal(prepared.recipients[0].rendered_body,prepared.message.body)
    assert.deepEqual(prepared.recipients.map(r=>r.donor_id),[recipient.id])
    const publicLink=link.pathname+link.search
    assert.equal((await h.request(publicLink,{as:''})).status,410,'Unapproved frozen link cannot start checkout')
    await browser.review(appealId,'prepared',prepared.message.body)
    await h.command('appeal.approve',{appealId,version:1},{as:member.cookie,status:403})
    await h.command('appeal.approve',{appealId,version:1},{...afterClose,status:409})
    assert.equal((await detail()).appeal.status,'prepared','Closing the page prevents approving an unusable donation link')
    await browser.approve(appealId)
    assert.equal((await h.request(publicLink,{as:'',headers:{'x-test-now':'2026-10-16T03:59:59Z'}})).status,200,'The final organization-local giving day remains open')
    assert.equal((await h.request(publicLink,{as:'',...afterClose})).status,410,'A closed campaign cannot resolve its email source')
    await browser.review(appealId,'approved',prepared.message.body)
    await h.command('appeal.send',{appealId,version:2},{as:member.cookie,status:403})
    await h.command('appeal.send',{appealId,version:2},{...afterClose,status:409})
    assert.deepEqual((await detail()).messages,[],'A closed campaign creates no sender claim')
    assert.equal(state.handoffs.length,0,'A closed campaign reaches neither sender edge')
    await browser.send(appealId)
    assert.deepEqual(state.handoffs,[address(9715)],JSON.stringify((await detail()).messages))
    assert.equal((await detail()).messages[0].body,prepared.recipients[0].rendered_body)
    if(provider==='mailchimp'){assert.ok(state.contents[0].plain_text.includes(source.url),'The actual composed provider message contains the exact frozen link');assert.ok(state.contents[0].html.includes('<a href="'+source.url.replaceAll('&','&amp;')+'">'),'The HTML message has the same clickable donation link')}
    else assert.ok((await (await h.request('/app/appeals/'+appealId)).text()).includes(source.url.replaceAll('&','&amp;')),'The Mango handoff carries the frozen link in its copyable approved message')
    await browser.review(appealId,'handoff',prepared.message.body)
    const repeated=await h.command('appeal.send',{appealId,version:2});assert.equal(repeated.submitted+repeated.listed,0);assert.equal(state.handoffs.length,1)
    await browser.giving(source.url)
    const token=source.id
    const values={requestId:randomUUID(),name:'Synthetic Independent Giver',email:address(9716),amount:'50.00',frequency:'once',appeal:source.code,emailSource:token,'cf-turnstile-response':'synthetic-coffer-security-token'}
    const start=(v=values,slug='synthetic-reading')=>h.request('/give/'+slug+'/checkout',{...form(v),as:''})
    for(const [changes,slug,status] of [[{emailSource:randomUUID()},'synthetic-reading',410],[{appeal:'FORGED'},'synthetic-reading',410],[{},'synthetic-meals',410],[{frequency:'monthly'},'synthetic-reading',409]])assert.equal((await start({...values,...changes},slug)).status,status)
    const closedCheckout=form(values)
    assert.equal((await h.request('/give/synthetic-reading/checkout',{...closedCheckout,as:'',headers:{...closedCheckout.headers,...afterClose.headers}})).status,409,'A closed campaign starts no checkout')
    assert.equal(state.sessions.size,0,'Refusals submit no payment')
    const checkout=await start({...values,channel:'mail'});assert.equal(checkout.status,303,await checkout.text())
    const session=[...state.sessions.values()][0],charge=[...state.charges.values()][0]
    const event=async(type,id,at='2026-10-15T16:00:00Z')=>{
     const raw=JSON.stringify({id:randomUUID(),type,data:{object:{id}}}),timestamp=Date.parse(at)/1000,signature=createHmac('sha256',webhookSecret).update(timestamp+'.'+raw).digest('hex')
     const response=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',headers:{'stripe-signature':`t=${timestamp},v1=${signature}`,'x-test-now':at},raw});assert.equal(response.status,200,await response.text())
    }
    // A refund observed first must record the original once before its correction.
    const refund={id:'re_synthetic_coffer',charge:charge.id,status:'succeeded',amount:2000,currency:'usd',balance_transaction:'txn_synthetic_coffer_refund',created:instant+1}
    state.refunds.set(refund.id,refund);charge.amount_refunded=2000
    state.entries.push({id:refund.balance_transaction,type:'refund',source:refund,amount:-2000,fee:-50,net:-1950,currency:'usd',created:instant+1})
    await event('refund.created',refund.id,'2026-10-16T04:00:00Z')
    await event('charge.succeeded',charge.id)
    const returnPage=()=>h.request('/giving/thanks?session_id='+session.id,{as:''})
    assert.equal((await returnPage()).status,200)
    assert.equal((await h.request('/giving/thanks?session_id='+session.id,{as:'',...afterClose})).status,200,'An earlier paid checkout still reconciles after campaign closure')
    await event('checkout.session.completed',session.id)
    await event('charge.refunded',charge.id)
    assert.equal((await start({...values,channel:'email'})).status,303);assert.equal(state.sessions.size,1)
    assert.equal((await start({...values,emailSource:''})).status,409,'A saved intent cannot shed its source')
    const paid=await h.get('/api/coffer/donors/'+giver.id)
    assert.equal(paid.totals.lifetimeCents,3000);assert.equal(paid.gifts.length,2)
    assert.equal(paid.gifts.find(g=>g.kind==='gift').amount_cents,5000)
    assert.equal(paid.letters.length,1);assert.equal(paid.letters[0].amount_cents,5000)
    const receipt=(await h.get('/api/coffer/letters/'+paid.letters[0].batch_id)).letters[0].body
    assert.match(receipt,/\$50\.00/);assert.equal(state.mails.filter(m=>m.personalizations.some(p=>p.to.some(t=>t.email===address(9716)))).length,1,'One full paid receipt survives replay')
    assert.notEqual(paid.current.email?.status,'granted','The public source establishes no donor marketing permission')
    assert.equal((await h.get('/api/coffer/donors/'+recipient.id)).gifts.length,0,'The source never identifies its email recipient as the giver')
    const report=await h.get('/api/coffer/reports/attribution?from=2026-01-01&to=2026-12-31')
    assertAttributionTotals(report,3000)
    for(const [dimension,key] of [['fund','Reading'],['campaign',campaign.id],['appeal',source.code],['channel','email']])assert.equal(report[dimension].find(r=>r.key===key).amountCents,3000)
    const results=(await detail()).results;assert.deepEqual([results.gifts,results.dollarsCents,results.responded],[1,3000,0]);assert.equal(results.delivered,0);assert.equal(results.deliveryUnknown,1)
    const fees=await h.get('/api/coffer/payments/fees')
    assert.deepEqual(fees.totals,{gross_cents:3000,fee_cents:125,net_cents:2875})
    for(const group of [fees.byFund,fees.byCampaign,fees.byForm])assert.deepEqual(group.map(r=>[r.gross_cents,r.fee_cents,r.net_cents]),[[3000,125,2875]])
    await browser.outcome(session.id)
    await browser.reports(appealId)
    const plain=await start({...values,requestId:randomUUID(),emailSource:'',name:'Synthetic Other Giver',email:address(9723),channel:'email'})
    assert.equal(plain.status,303,await plain.text())
    const ordinary=[...state.sessions.values()].at(-1)
    assert.equal((await h.request('/giving/thanks?session_id='+ordinary.id,{as:''})).status,200)
    assert.equal((await h.get('/api/coffer/reports/attribution?from=2026-01-01&to=2026-12-31')).channel.find(r=>r.key==='form').amountCents,5000,'A caller email flag never upgrades a plain tracked link')
    // Donor guards are current at approval and handoff, independently of the source.
    const stale=await h.command('appeal.prepare',input)
    await h.command('consent.record',{donorId:recipient.id,channel:'email',status:'withdrawn',method:'email reply',evidence:'synthetic-coffer-9724',capturedOn:'2026-10-15'})
    await h.command('appeal.approve',{appealId:stale.id,version:1},{status:409})
    assert.equal(state.handoffs.length,1)
    Object.assign(state.contacts.get(address(9715)),{status:'subscribed',emailStatus:'subscribed'})
    await h.command('consent.record',{donorId:recipient.id,channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-9725',capturedOn:'2026-10-15'})
    const discarded=await h.command('appeal.prepare',input),discardSource=(await h.get('/api/coffer/appeals/'+discarded.id)).emailSource
    await h.command('appeal.approve',{appealId:discarded.id,version:1});await h.command('appeal.discard',{appealId:discarded.id,version:2})
    assert.equal((await start({...values,requestId:randomUUID(),appeal:discardSource.code,emailSource:discardSource.id})).status,410)
    const askHold=await h.command('appeal.prepare',input)
    await h.command('appeal.approve',{appealId:askHold.id,version:1})
    const alternate=(await h.get('/api/coffer/appeals/'+askHold.id)).emailSource
    assert.equal((await start({...values,emailSource:alternate.id,appeal:alternate.code})).status,409,'An existing request cannot switch to another approved source')
    await h.command('solicitation.set',{donorId:recipient.id,version:0,type:'stop',startsOn:'2026-10-01',source:'person',sourceRef:'synthetic-coffer-9727'})
    await h.command('appeal.send',{appealId:askHold.id,version:2},{status:409})
    assert.deepEqual((await h.get('/api/coffer/appeals/'+askHold.id)).messages,[],'A current ask restriction prevents even a sender claim')
    assert.equal(state.handoffs.length,1)
    const saved=await archive(h)
    await run(async fresh=>{
     await restore(fresh,saved)
     assert.equal((await fresh.get('/api/coffer/appeals/'+appealId)).emailSource.id,token)
     assert.equal((await fresh.request(publicLink,{as:''})).status,200)
     const before=(await fresh.get('/api/coffer/donors/'+giver.id)).gifts
     assert.equal((await fresh.request('/giving/thanks?session_id='+session.id,{as:''})).status,200)
     assert.deepEqual((await fresh.get('/api/coffer/donors/'+giver.id)).gifts,before)
     assert.equal((await fresh.get('/api/coffer/letters/'+paid.letters[0].batch_id)).letters[0].body,receipt)
     const target=await donor(fresh,'Synthetic Survivor',{email:address(9726)})
     const comparison=await fresh.get('/api/coffer/duplicates/compare?source='+giver.id+'&target='+target.id)
     await fresh.command('donor.merge',{sourceDonorId:giver.id,donorId:target.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
     assert.equal((await fresh.request('/giving/thanks?session_id='+session.id,{as:''})).status,200)
     assert.equal((await fresh.get('/api/coffer/donors/'+target.id)).totals.lifetimeCents,3000)
     await fresh.command('donor.erase',{donorId:target.id,confirm:'ERASE'})
     const count=(await fresh.get('/api/coffer/donors')).total
     assert.equal((await fresh.request('/giving/thanks?session_id='+session.id,{as:''})).status,409)
     assert.equal((await fresh.get('/api/coffer/donors')).total,count)
     assert.ok(!JSON.stringify(await archive(fresh)).includes(address(9716)),'Erased giver details never return from source custody')
    },{...options,givingProtection:false})
    assert.ok(state.writes.every(w=>['/v1/customers','/v1/checkout/sessions'].includes(w.path)),'Attribution and replay submit no extra provider operation')
   },provider)
  },options)
 }
}

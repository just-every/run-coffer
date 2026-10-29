import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {run,installation,reviewed,archive,restore,donor} from './harness.mjs'
import {recurringStripeEdge} from './recurring-stripe-edge.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

const secret='synthetic-coffer-7400'
export async function membershipsJourney(){
 const edge=recurringStripeEdge({initialPayment:true})
 await run(async h=>{
  let staffCookie=h.owner
  const headers=()=>({'x-test-now':edge.state.now})
  const get=(p,o={})=>h.get(p,{as:staffCookie,...o,headers:{...headers(),...o.headers}})
  const api=(p,b,o={})=>h.api(p,b,{as:staffCookie,...o,headers:{...headers(),...o.headers}})
  const command=(c,b,o={})=>h.command(c,b,{as:staffCookie,...o,headers:{...headers(),...o.headers}})
  const renewSession=async(target=h)=>{
   const account=await target.get('/auth/session'),email=account.operator.email
   const sent=await target.request('/auth/magic-link',{method:'POST',as:'',body:{email},headers:headers()});assert.equal(sent.status,202,await sent.text())
   const link=target.messages.at(-1).text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]
   const response=await target.request('/auth/confirm',{method:'POST',as:'',body:{token:new URL(link).searchParams.get('token')},headers:headers()});assert.equal(response.status,303)
   return response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')
  }
  const form=(b,as='')=>({method:'POST',as,headers:{...headers(),'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(b).toString()})
  const deliver=async(type,id,eventId=randomUUID())=>{
   const raw=JSON.stringify({id:eventId,type,data:{object:{id}}}),timestamp=Date.parse(edge.state.now)/1000,signature=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')
   const r=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{...headers(),'stripe-signature':`t=${timestamp},v1=${signature}`}});assert.equal(r.status,200,await r.text())
  }
  await reviewed(h)
  const campaign=await api('/api/coffer/giving/campaigns',{name:'Reading membership',slug:'member-reading',description:'Annual books and community membership.',fund:'Reading',goal:'60000'})
  const levelInput={action:'create',name:'Annual reader',slug:'annual-reader',campaignId:campaign.id,price:'120',termMonths:12,benefit:'20',benefitDescription:'Annual reading journal and member events',graceDays:30}
  const endpoint='/api/coffer/memberships',member=await h.person(['synthetic-coffer-7401','example.test'].join('@'))
  await get(endpoint,{as:'',status:401});await get(endpoint,{as:member.cookie,status:403})
  await api(endpoint,levelInput,{as:member.cookie,status:403})
  await api(endpoint,{...levelInput,benefit:'121'},{status:400})
  const admin=await h.person(['synthetic-coffer-7406','example.test'].join('@'),'admin')
  await get(endpoint,{as:admin.cookie})
  const revoke=await h.request('/auth/signout',{method:'POST',body:{},as:admin.cookie,headers:headers()});assert.equal(revoke.status,204)
  await api(endpoint,levelInput,{as:admin.cookie,status:401})
  const level=await api(endpoint,levelInput)
  await api(endpoint,{...levelInput,slug:'monthly-reader',name:'Monthly reader',termMonths:1,price:'10',benefit:'0',graceDays:0})
  await api(endpoint,{...levelInput,slug:'quarterly-reader',name:'Quarterly reader',termMonths:3,price:'30',benefit:'5'})
  assert.equal((await get(endpoint)).levels.length,3)
  assert.deepEqual((await get(endpoint)).counts.map(c=>[c.active,c.grace,c.lapsed,c.review]),[[0,0,0,0],[0,0,0,0],[0,0,0,0]])
  const join=async(n,extra={},status=303)=>{
   const input={requestId:randomUUID(),levelVersion:'1',name:'Synthetic Member '+n,email:['synthetic-coffer-'+n,'example.test'].join('@'),authorizeRenewal:'yes','cf-turnstile-response':'synthetic-coffer-security-token',...extra}
   const response=await h.request('/giving/memberships/annual-reader/checkout',form(input));assert.equal(response.status,status,await response.text());return {input,sub:[...edge.state.plans.values()].at(-1)}
  }
  await join(7402,{authorizeRenewal:'no'},400);await join(7402,{levelVersion:'9'},409)
  assert.equal(edge.state.plans.size,0,'No authorization or stale terms reach the processor')
  const a=await join(7402,{amount:'1',amountCents:'100',frequency:'once'}),b=await join(7403)
  assert.equal((await get(endpoint)).memberships.length,0,'A checkout or subscription alone grants no paid membership')
  for(const {sub} of [a,b])await deliver('invoice.paid',sub.latest_invoice)
  let state=await get(endpoint),annual=()=>state.counts.find(c=>c.levelId===level.id)
  assert.equal(annual().active,2)
  assert.ok(state.memberships.every(m=>m.state==='active'&&m.expires_on==='2027-01-10'&&m.auto_renew))
  const first=state.memberships.find(m=>m.subscription_id===a.sub.id),second=state.memberships.find(m=>m.subscription_id===b.sub.id)
  const history=()=>get('/api/coffer/donors/'+first.donor_id)
  for(const m of state.memberships){
   const detail=await get('/api/coffer/donors/'+m.donor_id)
   assert.deepEqual(detail.gifts.map(g=>[g.amount_cents,g.goods_cents]),[[12000,2000]])
   assert.equal(detail.letters.length,1)
   const receipt=await get('/api/coffer/letters/'+detail.letters[0].batch_id)
   assert.match(receipt.letters[0].body,/\$120\.00/);assert.match(receipt.letters[0].body,/\$20\.00/);assert.match(receipt.letters[0].body,/\$100\.00/)
  }
  await api('/api/coffer/payments/sync',{payoutId:'po_recurring'})
  assert.deepEqual((await get('/api/coffer/payments/fees?payoutId=po_recurring')).totals,{gross_cents:24000,fee_cents:206,net_cents:23794})
  let progress=await get('/api/coffer/giving/campaigns/'+campaign.id)
  assert.deepEqual([progress.raisedCents,progress.pledgedOutstandingCents,progress.softCreditCents,progress.giftCount,progress.donorCount,progress.newDonors,progress.recurringDonors,progress.averageGiftCents],[24000,0,0,2,2,2,2,12000])
  // Native public form, level configuration and paid membership states use real HTTP.
  const screens=async(phase)=>withBrowserWorker({...h,owner:staffCookie},async(context,origin)=>{
   const page=await context.newPage();await page.setExtraHTTPHeaders(headers())
   const directory=process.env.COFFER_MEMBERSHIP_BROWSER
   if(directory)await mkdir(directory,{recursive:true})
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    const routes=phase==='joined'?['/app/settings/memberships','/giving/memberships/annual-reader','/app/giving/memberships']:['/app/giving/memberships']
    for(const path of routes){
     await page.goto(origin+path);await page.waitForLoadState('domcontentloaded')
     if(width===1440){
      assert.ok(await page.getByRole('heading',{name:path.includes('settings')?'Membership settings':path.includes('annual-reader')?'Join Annual reader':'Memberships',exact:true}).count())
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Membership screen fits the release width')
      if(path.includes('annual-reader')){assert.equal(await page.getByRole('checkbox',{name:/I authorize/}).count(),1);assert.ok(await page.getByText('Contribution part:',{exact:false}).count())}
      if(path==='/app/giving/memberships'){assert.ok(await page.getByText(phase==='joined'?'2 active':'1 active', {exact:false}).count());if(phase==='lapsed')assert.ok(await page.getByText('Held · not sent',{exact:true}).count())}
     }
     if(directory)await page.screenshot({path:`${directory}/${phase}-${path.includes('settings')?'settings':path.includes('annual-reader')?'form':'memberships'}-${width}.png`,fullPage:true})
    }
   }
   await page.close()
  })
  await screens('joined')
  // Neither an ordinary giving request nor a modified replay can bypass the quote.
  const replay=await h.request('/give/member-reading/checkout',form({...a.input,amount:'120',frequency:'annually'}));assert.equal(replay.status,409)
  const exact=await h.request('/giving/memberships/annual-reader/checkout',form(a.input));assert.equal(exact.status,303)
  assert.equal(edge.state.plans.size,2)
  for(const sub of [a.sub,b.sub])await deliver('invoice.payment_succeeded',sub.latest_invoice)
  assert.equal((await history()).gifts.length,1)
  const auth=await command('interaction.record',{donorId:second.donor_id,kind:'call',occurredOn:'2026-01-10',notes:'Member authorized cancellation at the paid term boundary.'})
  const plan='/api/coffer/giving/plans/'+b.sub.id,planState=await get(plan)
  const cancel={action:'cancel',requestId:randomUUID(),version:planState.version,sourceRef:'interaction:'+auth.id,reason:'Member requested no more renewal charges.',confirm:'yes'}
  await api(plan,cancel,{as:member.cookie,status:403})
  await api(plan,cancel);await api(plan,cancel)
  assert.equal(edge.state.mutations.filter(m=>m.cancel_at_period_end==='true').length,1)
  assert.equal((await get(endpoint)).memberships.find(m=>m.id===second.id).state,'active','Cancellation preserves paid membership time')
  await api(plan,{...cancel,action:'amount',requestId:randomUUID(),amount:'125'},{status:409})
  // Recovery and expiry run through the existing annual-plan policy boundary.
  edge.state.now='2026-12-10T12:00:00Z';edge.state.expiryMonth=1;edge.state.expiryYear=2027
  staffCookie=await renewSession()
  const beforeExpiry=h.messages.length
  await api('/api/coffer/agent/recovery/run',{})
  assert.equal(h.messages.length,beforeExpiry,'Annual expiry cannot inherit unapproved legacy monthly mail')
  const noticeAction='/api/coffer/agent/recovery/notice-action'
  const notices=()=>get('/api/coffer/agent/recovery/notices')
  await command('consent.record',{donorIds:[first.donor_id],channel:'email',status:'granted',method:'paper form',evidence:'Member authorized private recovery notices.',capturedOn:'2026-12-10'})
  await command('solicitation.set',{donorId:first.donor_id,version:0,type:'stop',startsOn:'2026-12-10'})
  await api(noticeAction,{action:'policy',version:(await notices()).policy.version,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000'})
  await api(noticeAction,{action:'permission',donorId:first.donor_id,version:0,enabled:true,channel:'email',intervalDays:2,maxNotices:2,sourceOn:'2026-12-10',evidence:'Member authorized two private card notices at least two days apart.'})
  await api('/api/coffer/agent/recovery/run',{})
  const expiryMail=h.messages.filter(m=>m.text?.includes('/giving/portal/confirm?token='))
  assert.equal(expiryMail.length,1,'Approved annual card expiry reaches its exact restricted member as a transactional notice')
  assert.ok(expiryMail[0].to.includes(a.input.email))
  await api('/api/coffer/agent/recovery/run',{})
  assert.equal(h.messages.filter(m=>m.text?.includes('/giving/portal/confirm?token=')).length,1,'The same card expiry cannot contact the member twice')
  await api(noticeAction,{action:'permission',donorId:first.donor_id,version:1,enabled:false,channel:'email',intervalDays:2,maxNotices:2,sourceOn:'2026-12-10',evidence:'Member withdrew automatic recovery-contact permission.'})
  edge.state.now='2027-01-10T12:00:00Z'
  staffCookie=await renewSession()
  const tick=await edge.advance(edge.state.now);assert.equal(tick.bills.length,1,'Cancelled renewal never makes a second charge')
  const bill=edge.state.invoices.get(tick.bills[0]),paid=structuredClone(bill)
  bill.status='open';bill.amount_paid=0;bill.next_payment_attempt=Date.parse('2027-01-11T12:00:00Z')/1000;a.sub.status='past_due'
  const beforeFailure=h.messages.length
  await deliver('invoice.payment_failed',bill.id)
  assert.equal((await history()).gifts.length,1,'Failed renewal records no gift or extra term')
  assert.equal(h.messages.length,beforeFailure,'No recovery notice after member permission is withdrawn')
  assert.equal((await get('/api/coffer/agent')).recovery.rows.find(r=>r.subscription_id===a.sub.id).state,'waiting')
  await api(noticeAction,{action:'permission',donorId:first.donor_id,version:2,enabled:true,channel:'email',intervalDays:2,maxNotices:2,sourceOn:'2027-01-10',evidence:'Member explicitly renewed permission for two private recovery notices.'})
  await api('/api/coffer/agent/recovery/run',{})
  const failedMail=h.messages.filter(m=>m.text?.includes('/giving/portal/confirm?token='))
  assert.equal(failedMail.length,2);assert.ok(failedMail.at(-1).to.includes(a.input.email))
  await api('/api/coffer/agent/recovery/run',{})
  assert.equal(h.messages.filter(m=>m.text?.includes('/giving/portal/confirm?token=')).length,2,'Reconciliation creates no automatic duplicate recovery notice')
  state=await get(endpoint);assert.equal(state.memberships.find(m=>m.id===first.id).state,'grace');assert.equal(annual().grace,2)
  Object.assign(bill,paid,{attempt_count:2});a.sub.status='active'
  await deliver('invoice.paid',bill.id);await deliver('invoice.payment_succeeded',bill.id)
  state=await get(endpoint);assert.equal(annual().active,1);assert.equal(annual().grace,1)
  assert.equal(state.memberships.find(m=>m.id===first.id).expires_on,'2028-01-10')
  const renewed=await history();assert.equal(renewed.gifts.length,2);assert.equal(renewed.letters.length,2);assert.equal(renewed.subscriptions[0].recovered,1)
  assert.equal(renewed.gifts.reduce((s,g)=>s+g.amount_cents-g.goods_cents,0),20000)
  await api('/api/coffer/payments/sync',{payoutId:'po_membership_renewal'})
  assert.deepEqual((await get('/api/coffer/payments/fees')).totals,{gross_cents:36000,fee_cents:309,net_cents:35691})
  progress=await get('/api/coffer/giving/campaigns/'+campaign.id)
  assert.deepEqual([progress.raisedCents,progress.giftCount,progress.donorCount,progress.recurringDonors,progress.averageGiftCents],[36000,3,2,1,12000])
  edge.state.now='2027-02-09T12:00:00Z'
  staffCookie=await renewSession()
  const mails=h.messages.length
  await api(endpoint,{action:'reminders'});await api(endpoint,{action:'reminders'})
  state=await get(endpoint);assert.equal(annual().active,1);assert.equal(annual().lapsed,1)
  assert.equal(state.reminders.length,1);assert.equal(state.reminders[0].status,'held');assert.equal(state.reminders[0].membership_id,second.id)
  assert.equal(h.messages.length,mails,'Preparing and replaying reminders never submits mail')
  await screens('lapsed')
  const reminderId=state.reminders[0].id
  const review=()=>get(endpoint+'?reminder='+reminderId)
  let exactReminder=await review()
  const send=()=>({action:'sendReminder',id:reminderId,contentHash:exactReminder.contentHash,confirm:'yes'})
  const reminderMember=await renewSession({...h,get:p=>h.get(p,{as:member.cookie})}),beforeReminder=h.messages.length
  await api(endpoint,send(),{as:reminderMember,status:403})
  await api(endpoint,send(),{status:409})
  await command('consent.record',{donorIds:[second.donor_id],channel:'email',status:'granted',method:'paper form',evidence:'Member permits email renewal requests.',capturedOn:'2027-02-09'})
  await command('solicitation.set',{donorId:second.donor_id,version:0,type:'stop',startsOn:'2027-02-09'})
  exactReminder=await review()
  await api(endpoint,send(),{status:409})
  assert.equal(h.messages.length,beforeReminder,'Denied renewal requests change no mail edge')
  await command('solicitation.set',{donorId:second.donor_id,version:1,type:'none',startsOn:'2027-02-09'})
  exactReminder=await review()
  await api(endpoint,{...send(),contentHash:'stale'},{status:409})
  const accepted=await api(endpoint,send());assert.equal(accepted.status,'accepted')
  await api(endpoint,send())
  assert.equal(h.messages.length,beforeReminder+1,'The exact reviewed reminder reaches its member once')
  const received=h.messages.at(-1)
  assert.ok(received.to.includes(b.input.email));assert.equal(received.subject,'Renew your Annual reader membership')
  assert.match(received.text,/120\.00/);assert.match(received.text,/20\.00/);assert.match(received.text,/100\.00/)
  assert.match(received.text,/2027-01-10/)
  assert.equal((await get(endpoint)).reminders[0].status,'accepted')
  await screens('sent')
  state=await get(endpoint)

  // A changed membership quote cannot alter a previously authorized plan.
  await api(endpoint,{action:'retire',id:level.id,version:2},{status:409})
  await api(endpoint,{action:'retire',id:level.id,version:1})
  assert.equal((await h.request('/giving/memberships/annual-reader',{headers:headers(),as:''})).status,404)
  state=await get(endpoint);assert.equal(state.memberships.find(m=>m.id===first.id).price_cents,12000)
  const saved=await archive(h),fresh=await installation({givingProtection:false,entry:'tests/advancing-clock-worker.ts',bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-7404',STRIPE_WEBHOOK_SECRET:secret},outbound:edge.outbound})
  try{await restore(fresh,saved);const copy=await fresh.get(endpoint,{as:await renewSession(fresh),headers:headers()});assert.deepEqual(copy.memberships,state.memberships);assert.deepEqual(copy.counts,state.counts);assert.deepEqual(copy.reminders,state.reminders)}finally{await fresh.close()}
  const twin=await donor(h,'Synthetic Member Survivor',{email:['synthetic-coffer-7405','example.test'].join('@')})
  const compare=await get('/api/coffer/duplicates/compare?source='+first.donor_id+'&target='+twin.id)
  const merged=await command('donor.merge',{sourceDonorId:first.donor_id,donorId:twin.id,sourceVersion:compare.source.version,version:compare.target.version,reason:'duplicate_record'})
  assert.equal((await get(endpoint)).memberships.find(m=>m.id===first.id).donor_id,twin.id)
  await command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.equal((await get(endpoint)).memberships.find(m=>m.id===first.id).donor_id,first.donor_id)
  // A changed provider amount never changes the membership's price or grants another term.
  a.sub.items.data[0].price.unit_amount=13000
  await deliver('customer.subscription.updated',a.sub.id)
  assert.equal((await get(endpoint)).memberships.find(m=>m.id===first.id).state,'review')
  a.sub.items.data[0].price.unit_amount=12000
  await deliver('customer.subscription.updated',a.sub.id)
  assert.equal((await get(endpoint)).memberships.find(m=>m.id===first.id).state,'active')
  const firstPlan='/api/coffer/giving/plans/'+a.sub.id,source=await command('interaction.record',{donorId:first.donor_id,kind:'call',occurredOn:'2027-02-09',notes:'Member asked to review collection changes.'}),current=await get(firstPlan)
  const change={action:'pause',requestId:randomUUID(),version:current.version,sourceRef:'interaction:'+source.id,reason:'Member requested a pause.',confirm:'yes'}
  edge.state.uncertain=true
  await api(firstPlan,change,{status:502});const mutations=edge.state.mutations.length
  await api(firstPlan,change,{status:409});await api(firstPlan,{...change,requestId:randomUUID()},{status:409})
  assert.equal(edge.state.mutations.length,mutations,'Unknown provider outcome cannot be automatically retried')
  assert.equal((await get(endpoint)).memberships.find(m=>m.id===first.id).state,'review')
  edge.state.uncertain=false
  await command('donor.erase',{donorId:first.donor_id,confirm:'ERASE'})
  await command('donor.erase',{donorId:second.donor_id,confirm:'ERASE'})
  await deliver('invoice.paid',bill.id)
  state=await get(endpoint);assert.deepEqual(state.memberships,[]);assert.deepEqual(state.reminders,[]);assert.ok(state.counts.every(c=>c.active+c.grace+c.lapsed+c.review===0))
  assert.equal((await get('/api/coffer/giving/campaigns/'+campaign.id)).raisedCents,36000,'Erasure preserves anonymous campaign money')
  const after=await archive(h),protectedCopy=await installation()
  try{await restore(protectedCopy,saved,{status:400,laterJournal:{sourceIdentity:after[0].sourceIdentity,epoch:after[0].epoch,journal:after[0].journal}})}finally{await protectedCopy.close()}
 },{entry:'tests/advancing-clock-worker.ts',bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-7404',STRIPE_WEBHOOK_SECRET:secret},outbound:edge.outbound})
 await membershipTermVariants()
}

// The same native doors also preserve non-annual quotes and new-plan notice authority.
export async function membershipTermVariants(){
 const edge=recurringStripeEdge({initialPayment:true})
 let currentHarness,mailUncertain=false
 const outboundService=async request=>{
  const url=new URL(request.url)
  if(url.hostname==='api.resend.com'){
   const message=await request.json();currentHarness.messages.push(message)
   if(mailUncertain&&message.subject.startsWith('Renew your '))throw Error('Synthetic lost mail acceptance')
   return Response.json({id:randomUUID()})
  }
  if(url.hostname==='challenges.cloudflare.com'){
   const p=new URLSearchParams(await request.text())
   return Response.json({success:p.get('secret')==='synthetic-coffer-security-token'&&p.get('response')==='synthetic-coffer-security-token',hostname:new URL(currentHarness.origin).hostname,action:'giving'})
  }
  return edge.outbound(request)
 }
 await run(async h=>{
  currentHarness=h
  let staffCookie=h.owner
  const headers=()=>({'x-test-now':edge.state.now}),endpoint='/api/coffer/memberships'
  const get=p=>h.get(p,{as:staffCookie,headers:headers()}),api=(p,b)=>h.api(p,b,{as:staffCookie,headers:headers()})
  const deliver=async(type,id)=>{
   const raw=JSON.stringify({id:randomUUID(),type,data:{object:{id}}}),timestamp=Date.parse(edge.state.now)/1000,signature=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')
   const r=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{...headers(),'stripe-signature':`t=${timestamp},v1=${signature}`}});assert.equal(r.status,200,await r.text())
  }
  await reviewed(h)
  const campaign=await api('/api/coffer/giving/campaigns',{name:'Term variants',slug:'term-variants',description:'Monthly and quarterly reading support.',fund:'Reading',goal:'1000'})
  const plans=[]
  for(const [term,price,benefit,expiry] of [[1,'10','0','2026-02-10'],[3,'30','5','2026-04-10'],[6,'60','10','2026-07-10']]){
   const slug='member-term-'+term
   await api(endpoint,{action:'create',name:'Reading term '+term,slug,campaignId:campaign.id,price,termMonths:term,benefit,benefitDescription:'Reading membership benefit',graceDays:0})
   const response=await h.request('/giving/memberships/'+slug+'/checkout',{method:'POST',as:'',headers:{...headers(),'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({requestId:randomUUID(),levelVersion:'1',name:'Synthetic Term '+term,email:['synthetic-coffer-'+(7500+term),'example.test'].join('@'),authorizeRenewal:'yes','cf-turnstile-response':'synthetic-coffer-security-token'}).toString()})
   assert.equal(response.status,303,await response.text())
   const sub=[...edge.state.plans.values()].at(-1);plans.push(sub)
   await deliver('invoice.paid',sub.latest_invoice)
   const m=(await get(endpoint)).memberships.find(m=>m.subscription_id===sub.id)
   assert.equal(m.expires_on,expiry);assert.equal(m.state,'active')
   const detail=await get('/api/coffer/donors/'+m.donor_id)
   assert.deepEqual(detail.gifts.map(g=>[g.amount_cents,g.goods_cents]),[[Number(price)*100,Number(benefit)*100]])
  }
  assert.deepEqual((await get(endpoint)).counts.map(c=>c.active),[1,1,1])
  // Staff entry uses the donor's own saved-card permission and the existing
  // phone or signed-document authorization door, never an operator's consent.
  const monthlyMember=(await get(endpoint)).memberships.find(m=>m.subscription_id===plans[0].id)
  const source=await h.command('interaction.record',{donorId:monthlyMember.donor_id,kind:'call',occurredOn:'2026-01-10',notes:'Member authorizes the published quarterly level and immediate first payment.'},{headers:headers()})
  const {signInPortal}=await import('./portal-journey.mjs')
  const portal=await signInPortal(h,['synthetic-coffer-7501','example.test'].join('@'))
  const permission=await h.request('/giving/portal/saved-card',{as:portal.cookie,headers:headers()}),html=await permission.text(),consent={confirm:'yes'}
  for(const name of ['customerId','paymentMethodId','version','status'])consent[name]=html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1]
  const newPlan='/api/coffer/giving/plans/new?donorId='+monthlyMember.donor_id
  let saved=await get(newPlan)
  const staffLevel=(await get(endpoint)).levels.find(l=>l.term_months===3)
  let charge={donorId:monthlyMember.donor_id,customerId:saved.customerId,paymentMethodId:saved.paymentMethodId,version:saved.version,requestId:randomUUID(),membershipLevelId:staffLevel.id,membershipLevelVersion:1,campaignId:'forged',amount:'1',frequency:'monthly',sourceRef:'interaction:'+source.id,givingChannel:'phone',confirm:'yes'}
  await h.api('/api/coffer/giving/plans',charge,{headers:headers(),status:409})
  assert.equal(edge.state.staffSequence,0,'Staff cannot grant the donor’s per-card permission')
  const permissionSaved=await h.request('/giving/portal/saved-card',{method:'POST',as:portal.cookie,headers:{...headers(),'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(consent).toString()});assert.equal(permissionSaved.status,303)
  saved=await get(newPlan);charge={...charge,version:saved.version}
  await h.api('/api/coffer/giving/plans',{...charge,membershipLevelVersion:9},{headers:headers(),status:409})
  const charged=await api('/api/coffer/giving/plans',charge)
  assert.equal((await api('/api/coffer/giving/plans',charge)).id,charged.id)
  assert.equal(edge.state.staffSequence,1)
  const staffMember=(await get(endpoint)).memberships.find(m=>m.subscription_id===charged.id)
  assert.ok(staffMember);assert.equal(staffMember.price_cents,3000);assert.equal(staffMember.term_months,3);assert.equal(staffMember.expires_on,'2026-04-10')
  const staffHistory=await get('/api/coffer/donors/'+monthlyMember.donor_id)
  const staffGift=staffHistory.gifts.find(g=>g.id.includes('in_staff_'))
  assert.equal(staffGift.amount_cents,3000);assert.equal(staffGift.goods_cents,500)
  assert.ok(staffHistory.letters.some(l=>l.gift_id===staffGift.id&&l.amount_cents===3000))
  // A six-month level works through one-time hosted payment and native entry.
  // No local membership row or charge is fabricated before the payment clears.
  const fixedLevel=await api(endpoint,{action:'create',name:'Six month reader',slug:'six-month-reader',campaignId:campaign.id,price:'60',termMonths:6,benefit:'10',benefitDescription:'Six month reading journal',graceDays:7})
  const fixedForm={requestId:randomUUID(),levelVersion:'1',name:'Synthetic Fixed Member',email:['synthetic-coffer-7601','example.test'].join('@'),paymentMode:'once',confirmTerm:'yes','cf-turnstile-response':'synthetic-coffer-security-token'}
  const checkoutFixed=async(input,as='',status=303)=>{
   const r=await h.request('/giving/memberships/six-month-reader/checkout',{method:'POST',as,headers:{...headers(),'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(input).toString()});assert.equal(r.status,status,await r.text());return r
  }
  const plansBeforeFixed=edge.state.plans.size
  await checkoutFixed({...fixedForm,confirmTerm:'no'},'',400)
  await checkoutFixed(fixedForm)
  const fixedSession=[...edge.state.sessions.values()].at(-1)
  assert.equal(edge.state.plans.size,plansBeforeFixed,'A single term creates no recurring plan')
  assert.equal((await get(endpoint)).memberships.filter(m=>m.level_id===fixedLevel.id).length,0)
  await deliver('checkout.session.completed',fixedSession.id)
  let fixedMember=(await get(endpoint)).memberships.find(m=>m.level_id===fixedLevel.id)
  assert.equal(fixedMember.expires_on,'2026-07-10');assert.equal(fixedMember.auto_renew,false)
  let fixedHistory=await get('/api/coffer/donors/'+fixedMember.donor_id)
  assert.deepEqual(fixedHistory.gifts.map(g=>[g.amount_cents,g.goods_cents]),[[6000,1000]])
  assert.equal(fixedHistory.letters.length,1)
  await checkoutFixed({...fixedForm,paymentMode:'renewing',authorizeRenewal:'yes'},'',409)
  await deliver('checkout.session.completed',fixedSession.id)
  assert.equal((await get('/api/coffer/donors/'+fixedMember.donor_id)).gifts.length,1)
  const fixedPortal=await signInPortal(h,fixedForm.email)
  const ownMemberships=await h.request('/giving/portal/memberships',{as:fixedPortal.cookie,headers:headers()})
  assert.equal(ownMemberships.status,200);assert.match(await ownMemberships.text(),/Renew this membership once/)
  const renewalForm={...fixedForm,requestId:randomUUID(),renewMembershipId:fixedMember.id}
  await checkoutFixed(renewalForm,'',401)
  await checkoutFixed(renewalForm,portal.cookie,409)
  await checkoutFixed(renewalForm,fixedPortal.cookie)
  await deliver('checkout.session.completed',[...edge.state.sessions.values()].at(-1).id)
  fixedMember=(await get(endpoint)).memberships.find(m=>m.id===fixedMember.id)
  assert.equal(fixedMember.expires_on,'2027-01-10','An early fixed-term renewal preserves all earned time')
  assert.equal((await get(endpoint)).counts.find(c=>c.levelId===fixedLevel.id).active,1)
  const received=await h.command('gift.record',{donorId:fixedMember.donor_id,receivedOn:'2026-01-10',amount:'60',method:'check',reference:'synthetic-coffer-7602',fund:'Reading',campaignId:campaign.id,goods:'provided',goodsValue:'10',goodsDescription:'Six month reading journal'},{headers:headers()})
  const entry={action:'entry',requestId:randomUUID(),membershipLevelId:fixedLevel.id,membershipLevelVersion:1,giftId:received.id,renewMembershipId:fixedMember.id,confirm:'yes'}
  await h.api(endpoint,{...entry,confirm:'no'},{headers:headers(),status:400})
  await h.api(endpoint,{...entry,membershipLevelId:staffLevel.id},{headers:headers(),status:409})
  assert.equal((await api(endpoint,entry)).id,fixedMember.id)
  await api(endpoint,entry)
  await h.api(endpoint,{...entry,requestId:randomUUID()},{headers:headers(),status:409})
  const fixedState=await get(endpoint)
  assert.equal(fixedState.memberships.find(m=>m.id===fixedMember.id).expires_on,'2027-07-10')
  assert.equal(fixedState.counts.find(c=>c.levelId===fixedLevel.id).active,1)
  const fixedProgress=await get('/api/coffer/giving/campaigns/'+campaign.id)
  assert.equal(fixedProgress.raisedCents,31000,'All hosted, staff and check membership payments reconcile to the full ledger')
  assert.equal(edge.state.plans.size,plansBeforeFixed)
  await withBrowserWorker(h,async(context,origin)=>{
   const page=await context.newPage();await page.setExtraHTTPHeaders(headers())
   const directory=process.env.COFFER_MEMBERSHIP_BROWSER
   if(directory)await mkdir(directory,{recursive:true})
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    for(const [name,path] of [['fixed-form','/giving/memberships/six-month-reader'],['entry','/app/giving/memberships?entry=1'],['staff-charge','/app/giving/plans/new?donorId='+monthlyMember.donor_id],['fixed-terms','/app/giving/memberships']]){
     await page.goto(origin+path)
     if(width===1440){
      assert.equal(await page.getByRole('alert').count(),0)
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Membership entry fits the release width')
      if(name==='fixed-form'){await page.getByLabel('Payment schedule',{exact:true}).selectOption('once');assert.equal(await page.getByRole('checkbox',{name:/I approve the quoted/}).count(),1)}
      if(name==='staff-charge')assert.equal(await page.getByLabel('Membership level (optional)',{exact:true}).count(),1)
      if(name==='entry')assert.equal(await page.getByRole('button',{name:'Record membership term',exact:true}).count(),1)
     }
     if(directory)await page.screenshot({path:`${directory}/${name}-${width}.png`,fullPage:true})
    }
   }
   await page.close()
  })
  edge.state.now='2026-01-12T12:00:00Z'
  await h.command('consent.record',{donorIds:[monthlyMember.donor_id],channel:'email',status:'granted',method:'paper form',evidence:'Member permits renewal requests.',capturedOn:'2026-01-12'},{headers:headers()})
  await api(endpoint,{action:'reminders'})
  const uncertainReminder=(await get(endpoint)).reminders.find(r=>r.membership_id===monthlyMember.id)
  const approved=await get(endpoint+'?reminder='+uncertainReminder.id)
  const uncertainSend={action:'sendReminder',id:uncertainReminder.id,contentHash:approved.contentHash,confirm:'yes'}
  const mailCount=h.messages.length
  mailUncertain=true
  assert.equal((await api(endpoint,uncertainSend)).status,'uncertain')
  mailUncertain=false
  await h.api(endpoint,uncertainSend,{headers:headers(),status:409})
  assert.equal(h.messages.length,mailCount+1,'Unknown mail acceptance cannot cause another submission')
  const savedFixed=await archive(h),savedState=await get(endpoint)
  const fresh=await installation({entry:'tests/advancing-clock-worker.ts',givingProtection:false,bindings:{COFFER_TEST_NOW:edge.state.now,STRIPE_SECRET_KEY:'synthetic-coffer-7500',STRIPE_WEBHOOK_SECRET:secret},outbound:edge.outbound})
  try{
   await restore(fresh,savedFixed)
   const copy=await fresh.get(endpoint,{headers:headers()})
   assert.deepEqual(copy.memberships,savedState.memberships);assert.deepEqual(copy.reminders,savedState.reminders)
   const before=fresh.messages.length,current=await fresh.get(endpoint+'?reminder='+uncertainReminder.id,{headers:headers()})
   await fresh.api(endpoint,{...uncertainSend,contentHash:current.contentHash},{headers:headers(),status:409})
   assert.equal(fresh.messages.length,before,'Restoring an uncertain notice never revives its send authority')
  }finally{await fresh.close()}
  await h.command('donor.erase',{donorId:fixedMember.donor_id,confirm:'ERASE'},{headers:headers()})
  const erasedState=await get(endpoint)
  assert.equal(erasedState.memberships.filter(m=>m.donor_id===fixedMember.donor_id).length,0)
  const erasedSession=[...edge.state.sessions.values()].at(-1)
  const erasedRaw=JSON.stringify({id:randomUUID(),type:'checkout.session.completed',data:{object:{id:erasedSession.id}}}),erasedAt=Date.parse(edge.state.now)/1000,erasedSignature=createHmac('sha256',secret).update(`${erasedAt}.${erasedRaw}`).digest('hex')
  const erasedReplay=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw:erasedRaw,headers:{...headers(),'stripe-signature':`t=${erasedAt},v1=${erasedSignature}`}})
  assert.equal(erasedReplay.status,409,'Replayed captured checkout cannot recreate an erased fixed-term member')
  assert.equal((await erasedReplay.json()).error,'invalid_payment')
  assert.ok(!(await get(endpoint)).memberships.some(m=>m.id===fixedMember.id))
  assert.equal((await get('/api/coffer/giving/campaigns/'+campaign.id)).raisedCents,31000)
  const tick=await edge.advance('2026-02-10T12:00:00Z');assert.equal(tick.bills.length,1)
  const owner=(await h.get('/auth/session')).operator
  const login=await h.request('/auth/magic-link',{method:'POST',as:'',body:{email:owner.email},headers:headers()});assert.equal(login.status,202)
  const loginLink=h.messages.at(-1).text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]
  const signed=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:new URL(loginLink).searchParams.get('token')},headers:headers()});assert.equal(signed.status,303)
  staffCookie=signed.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
  const before=h.messages.length
  const monthly=plans[0],bill=edge.state.invoices.get(tick.bills[0])
  Object.assign(bill,{status:'open',amount_paid:0,next_payment_attempt:null,attempt_count:3});monthly.status='unpaid'
  await deliver('invoice.payment_failed',bill.id);await deliver('invoice.updated',bill.id)
  assert.equal(h.messages.length,before,'A newly created monthly membership never inherits legacy automatic recovery contact')
  const state=await get(endpoint),m=state.memberships.find(m=>m.subscription_id===monthly.id)
  assert.equal(m.state,'lapsed','A zero-grace membership lapses at its unpaid billing boundary')
  const tasks=(await get('/api/coffer/tasks')).tasks.filter(t=>t.source_key==='recovery:'+bill.id)
  assert.equal(tasks.length,1);assert.equal(tasks[0].donor_id,m.donor_id);assert.equal(tasks[0].is_ask,0)
  assert.equal(tasks[0].owner_id,(await get('/auth/session')).operator.id,'Exhausted membership recovery creates one ordinary owner task')
  assert.equal((await get('/api/coffer/donors/'+m.donor_id)).gifts.length,2,'Failed monthly renewal adds no gift beyond the original and the paid staff membership')
 },{entry:'tests/advancing-clock-worker.ts',bindings:{COFFER_TEST_NOW:'2026-01-10T12:00:00Z',STRIPE_SECRET_KEY:'synthetic-coffer-7500',STRIPE_WEBHOOK_SECRET:secret},outbound:edge.outbound,outboundService})
}

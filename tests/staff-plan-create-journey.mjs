import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {withBrowserWorker} from './browser-worker.mjs'
import {signInPortal} from './portal-journey.mjs'

export async function staffPlanCreateJourney(h,edge,{person,sourceRef,campaign,member,directory,plans,deliver}){
 const headers={'x-test-now':edge.state.now},endpoint='/api/coffer/giving/plans'
 const get=(path,options={})=>h.get(path,{...options,headers})
 const api=(body,options={})=>h.api(endpoint,body,{...options,headers})
 edge.state.uncertain=false
 const state=()=>get(endpoint+'/new?donorId='+person.id)
 const current=await state()
 let input={donorId:person.id,customerId:current.customerId,paymentMethodId:current.paymentMethodId,version:current.version,requestId:randomUUID(),campaignId:campaign.id,amount:'20',frequency:'monthly',sourceRef,givingChannel:'phone',confirm:'yes'}
 await get(endpoint+'/new?donorId='+person.id,{as:'',status:401})
 await api(input,{as:member.cookie,status:403})
 await api({...input,confirm:'no'},{status:400})
 await api({...input,sourceRef:'interaction:someone-else'},{status:409})
 await api({...input,givingChannel:'mail'},{status:400})
 const missing=await api(input,{status:409});assert.equal(missing.error,'SAVED_CARD_CONSENT_REQUIRED','A staff authorization cannot grant the donor’s saved card permission')
 assert.equal((await h.request('/giving/portal/saved-card',{as:''})).status,303)
 assert.equal((await h.request('/giving/portal/saved-card',{as:h.owner})).status,303,'An operator session cannot grant donor permission')
 const portal=await signInPortal(h,person.email)
 const portalForm=(data,as=portal.cookie)=>({method:'POST',as,headers:{...headers,'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(data).toString()})
 const consentForm=async()=>{
  const response=await h.request('/giving/portal/saved-card',{as:portal.cookie,headers});assert.equal(response.status,200,await response.clone().text())
  const html=await response.text(),values={}
  for(const name of ['customerId','paymentMethodId','version','status']){values[name]=html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1];assert.ok(values[name])}
  return {...values,confirm:'yes'}
 }
 const firstConsent=await consentForm()
 assert.equal((await h.request('/giving/portal/saved-card',portalForm({...firstConsent,confirm:'no'}))).status,400)
 assert.equal((await h.request('/giving/portal/saved-card',portalForm({...firstConsent,donorId:'someone-else'}))).status,403)
 const otherDonor=await signInPortal(h,'quarterly@example.test')
 assert.equal((await h.request('/giving/portal/saved-card',portalForm(firstConsent,otherDonor.cookie))).status,409,'A donor cannot grant permission for another donor’s card')
 assert.equal((await h.request('/giving/portal/saved-card',portalForm(firstConsent))).status,303)
 await api(input,{status:409})
 let fresh=await state();input={...input,version:fresh.version}
 const withdrawn=await consentForm();assert.equal(withdrawn.status,'withdrawn')
 assert.equal((await h.request('/giving/portal/saved-card',portalForm(withdrawn))).status,303)
 const revoked=await api(input,{status:409});assert.equal(revoked.error,'SAVED_CARD_CONSENT_REQUIRED','Withdrawal blocks a previously prepared staff instruction')
 assert.equal((await h.request('/giving/portal/saved-card',portalForm(await consentForm()))).status,303)
 fresh=await state();input={...input,version:fresh.version}
 edge.state.savedMethods.set(current.customerId,'synthetic-coffer-7401')
 const replacement=await state();assert.equal(replacement.cardConsent,null)
 const replacementRefusal=await api({...input,paymentMethodId:replacement.paymentMethodId,version:replacement.version},{status:409})
 assert.equal(replacementRefusal.error,'SAVED_CARD_CONSENT_REQUIRED','Permission for one card cannot authorize a replacement card')
 assert.equal((await h.request('/giving/portal/saved-card',portalForm(firstConsent))).status,409,'A stale donor form cannot authorize a replacement card')
 assert.equal((await h.request('/giving/portal/saved-card',portalForm(await consentForm()))).status,303)
 fresh=await state();input={...input,paymentMethodId:fresh.paymentMethodId,version:fresh.version}
 const consents=(await get('/api/coffer/audit?action=portal.savedCardConsent')).rows
 assert.equal(consents.length,4);assert.ok(consents.every(row=>row.actor_role==='donor'&&row.actor_id==='donor:'+person.id))
 const ownFile=await h.api('/api/coffer/donors/'+person.id+'/data-request',{requestedOn:edge.state.now.slice(0,10),method:'email'},{headers})
 const savedConsent=ownFile.records.saved_card_consents.find(row=>row.payment_method_id===fresh.paymentMethodId)
 assert.equal(savedConsent.status,'granted');assert.equal(savedConsent.customer_id,current.customerId)
 assert.equal(savedConsent.recorded_by,'donor:'+person.id)
 assert.ok(!JSON.stringify(savedConsent).includes('synthetic-coffer-card-metadata'))
 await api({...input,version:'stale'},{status:409})
 edge.state.methodType='us_bank_account';await get(endpoint+'/new?donorId='+person.id,{status:409});edge.state.methodType='card'
 edge.state.customerDiscount=true;await api(input,{status:409});edge.state.customerDiscount=false
 assert.equal(edge.state.staffSequence,0,'Refused authorization, authority and billing state never charge')
 const protection=await get('/api/coffer/giving/protection')
 const before=(await get('/api/coffer/donors/'+person.id)).gifts.length
 const created=await api(input);assert.equal(created.state,'complete')
 assert.equal((await api(input)).id,created.id);assert.equal(edge.state.staffSequence,1,'A completed create request cannot make a second subscription')
 const plan=await get(endpoint+'/'+created.id)
 assert.equal(plan.facts.amountCents,2000);assert.equal(plan.facts.status,'active');assert.equal(plan.gifts.length,1)
 const history=await get('/api/coffer/donors/'+person.id),gift=history.gifts.find(g=>g.id===plan.gifts[0].id)
 assert.equal(history.gifts.length,before+1);assert.equal(gift.amount_cents,2000);assert.equal(gift.created_by,'Morgan Lee');assert.equal(gift.fund,'Reading')
 const letter=history.letters.find(l=>l.gift_id===gift.id);assert.ok(letter);assert.equal(letter.amount_cents,2000)
 const audit=(await get('/api/coffer/audit?action=staffPlan.create')).rows.find(r=>r.subject_id===created.id)
 assert.equal(audit.actor_role,'owner');assert.equal(JSON.parse(audit.detail).sourceRef,sourceRef)
 if(directory)await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders(headers)
  await context.addCookies(portal.cookie.split('; ').map(value=>{const at=value.indexOf('=');return {name:value.slice(0,at),value:value.slice(at+1),domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}}))
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/giving/portal/saved-card')
   await page.getByRole('button',{name:'Withdraw saved card permission',exact:true}).click()
   await page.getByRole('status').waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/saved-card-withdrawn-${width}.png`,fullPage:true})
   await page.getByRole('checkbox',{name:/I permit authorized staff/}).check()
   await page.getByRole('button',{name:'Grant saved card permission',exact:true}).click()
   await page.getByRole('status').waitFor()
   await page.screenshot({path:`${directory}/saved-card-granted-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/giving/plans')
   await page.getByRole('link',{name:'Start an authorized saved-card plan',exact:true}).click()
   await page.getByLabel('Constituent',{exact:true}).selectOption(person.id)
   await page.getByRole('button',{name:'Review saved payment',exact:true}).click()
   await page.getByLabel('Campaign and fund',{exact:true}).selectOption(campaign.id)
   await page.getByLabel('Installment amount (USD)',{exact:true}).fill('15')
   await page.getByLabel('Billing frequency',{exact:true}).selectOption(width===1440?'quarterly':'annually')
   await page.getByLabel('Recorded authorization evidence',{exact:true}).selectOption(sourceRef)
   await page.getByRole('checkbox',{name:/I verified the recorded authorization/}).check()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/staff-plan-create-${width}.png`,fullPage:true})
   await page.getByRole('button',{name:'Charge and start plan',exact:true}).click()
   await page.getByRole('status').waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/staff-plan-created-${width}.png`,fullPage:true})
  }
 })
 assert.deepEqual(await get('/api/coffer/giving/protection'),protection,'Staff recurring payments never count toward public card-testing protection')
 await h.api('/api/coffer/payments/sync',{payoutId:'po_staff_recurring'},{headers})
 const fees=await get('/api/coffer/payments/fees?payoutId=po_staff_recurring'),paid=directory?5000:2000,count=directory?3:1
 assert.deepEqual(fees.totals,{gross_cents:paid,fee_cents:103*count,net_cents:paid-103*count})
 assert.deepEqual(fees.byForm.map(r=>[r.id,r.gross_cents]),[[null,paid]],'Staff payment entry never pretends to be a giving form')
 assert.deepEqual(fees.byCampaign.map(r=>[r.id,r.gross_cents]),[[campaign.id,paid]])
 const attribution=await get('/api/coffer/reports/attribution?from=2026-01-01&to=2026-12-31')
 assert.equal(attribution.channel.find(r=>r.key==='phone').amountCents,paid)
 const owner=(await get('/auth/session')).operator,messages=h.messages.length
 for(const sub of [...plans,...[...edge.state.plans.values()].filter(p=>p.id.startsWith('sub_staff_recurring_'))]){
  const id='in_exhausted_'+sub.id,bill={id,customer:sub.customer,currency:'usd',parent:{subscription_details:{subscription:sub.id}},status:'open',amount_paid:0,attempt_count:4,next_payment_attempt:null,status_transitions:{paid_at:null}}
  edge.state.invoices.set(id,bill);sub.latest_invoice=id;sub.status='past_due'
  await deliver('invoice.payment_failed',id)
  bill.status='uncollectible';sub.status='unpaid'
  await deliver('invoice.updated',id)
  await deliver('invoice.updated',id,'replayed-exhausted-'+id)
  const tasks=(await get('/api/coffer/tasks')).tasks.filter(t=>t.source_key==='recovery:'+id)
  assert.equal(tasks.length,1,'Each new cadence and staff-created plan escalates an exhausted invoice once')
  assert.equal(tasks[0].owner_id,owner.id)
 }
 assert.equal(h.messages.length,messages,'Unapproved new-plan recovery and staff escalation never send donor mail')

}

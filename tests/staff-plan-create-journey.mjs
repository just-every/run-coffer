import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {withBrowserWorker} from './browser-worker.mjs'

export async function staffPlanCreateJourney(h,edge,{person,sourceRef,campaign,member,directory}){
 const headers={'x-test-now':edge.state.now},endpoint='/api/coffer/giving/plans'
 const get=(path,options={})=>h.get(path,{...options,headers})
 const api=(body,options={})=>h.api(endpoint,body,{...options,headers})
 edge.state.uncertain=false
 const state=()=>get(endpoint+'/new?donorId='+person.id)
 const current=await state(),input={donorId:person.id,customerId:current.customerId,paymentMethodId:current.paymentMethodId,version:current.version,requestId:randomUUID(),campaignId:campaign.id,amount:'20',frequency:'monthly',sourceRef,givingChannel:'phone',confirm:'yes'}
 await get(endpoint+'/new?donorId='+person.id,{as:'',status:401})
 await api(input,{as:member.cookie,status:403})
 await api({...input,confirm:'no'},{status:400})
 await api({...input,sourceRef:'interaction:someone-else'},{status:409})
 await api({...input,givingChannel:'mail'},{status:400})
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
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/giving/plans')
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
}

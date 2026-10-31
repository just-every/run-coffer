import { all, type Context } from '../db'
import { box, e, empty, field, hidden, select } from '../ui/common'
import { usd } from '../money'
import { nativeCreateState, nativePlan, nativePlans } from './installments'

export async function installmentsPage(c:Context,id?:string){
 const root='/app/giving/installments',back='<p><a href="/app/giving/plans">Stripe recurring plans</a> · <a href="'+root+'">Native monthly plans</a></p>'
 if(!id){
  const plans=await nativePlans(c)
  return back+box('Coffer monthly saved-card plans','<p>Coffer schedules fixed USD monthly installments. Failed or uncertain payments hold charging for investigation. Existing Stripe subscriptions keep their billing schedule.</p><p><a href="'+root+'/new">Prepare a monthly plan</a></p>'+ (plans.length?plans.map(p=>'<p><a href="'+root+'/'+e(p.id)+'">'+e(p.donor_name)+'</a> · '+e(usd(p.amount_cents))+' · '+e(p.status)+(p.approved_at?'':' · review required')+'</p>').join(''):empty('No native plans yet.')))
 }
 const s=await nativePlan(c,id),p=s.plan,form=(action:string,label:string,extra='')=>'<form method="post">'+hidden('action',action)+hidden('version',p.version)+extra+'<label><input type="checkbox" name="confirm" value="yes" required> I confirm this exact instruction and recorded donor authorization.</label><button>'+label+'</button></form>'
 return back+box('Monthly plan review','<p><strong>'+e(p.donor_name)+'</strong> · '+e(usd(p.amount_cents))+' USD each month</p><p>Status: '+e(p.status)+' · version '+e(p.version)+' · next date '+e(p.next_due_on)+'</p><p>Authorization: '+e(p.source_ref)+'. The donor must personally permit this exact current saved card. Approval rechecks the current owner or admin, donor identity, authorization and card permission before submission.</p>'+(!s.approval?'<p>Charging approval is absent or has changed. Restored history cannot approve charging.</p>':'<p>Version reviewed '+e(s.approval.approved_at)+'.</p>')+
 (!s.history.some(h=>h.action==='installmentPlan.approve')&&p.status!=='canceled'?'<p>Approval charges the first '+e(usd(p.amount_cents))+' installment immediately. No fee cover is added.</p>'+form('approve','Approve and charge first installment'):p.status==='paused'?'<p>Resume skips all missed installments. The next charge is a future monthly date; no catch-up.</p>'+form('resume','Review and resume future installments'):p.status==='active'?form('pause','Pause future installments'):'')+
 (p.status!=='canceled'?form('cancel','Cancel future installments'):'') )+
 box('Installment history',s.installments.length?s.installments.map(i=>'<p>'+e(i.due_on)+' · '+e(i.state)+' · approved version '+e(i.plan_version)+(i.gift_id?' · <a href="/app/donors/'+e(p.donor_id)+'">Linked gift and receipt</a>':'')+'</p>').join(''):empty('No payment has been submitted.'))+
 box('Held payment investigation','<p>Reconciliation only reads Stripe. It never submits another debit. An unknown submission requires its exact Stripe payment identity; a failed or uncertain installment prevents further charging.</p><form method="post">'+hidden('action','reconcile')+field('Stripe payment identity (optional)','paymentIntentId','text','','')+'<button>Read provider result</button></form>')+
 box('Plan history',s.history.map(h=>'<p>'+e(h.at)+' · '+e(h.action)+' · '+e(h.actor_name)+'</p>').join(''))
}
export async function installmentCreatePage(c:Context,donorId:string){
 if(!donorId){
  const donors=await all(c,"SELECT d.id,d.name FROM cf_donors d WHERE d.erased_at IS NULL AND EXISTS(SELECT 1 FROM cf_giving_customers WHERE donor_id=d.id) ORDER BY d.name")
  return box('Choose a constituent','<form method="get">'+select('Constituent','donorId',donors.map(d=>[d.id,d.name]),'','required aria-label="Constituent"')+'<button>Review saved card</button></form>')
 }
 const s=await nativeCreateState(c,donorId)
 return '<p><a href="/app/giving/installments">Native monthly plans</a></p>'+box('Prepare monthly saved-card plan','<p>'+e(s.donor.name)+'. This prepares a fixed USD monthly schedule for a separate owner or admin review. Approval confirms the exact amount, schedule, current card permission and immediate first installment. No catch-up or automatic retry is permitted.</p><form method="post">'+hidden('donorId',s.donor.id)+hidden('customerId',s.customerId)+hidden('paymentMethodId',s.paymentMethodId)+hidden('version',s.version)+hidden('requestId',crypto.randomUUID())+hidden('frequency','monthly')+select('Campaign and fund','campaignId',s.campaigns.map(v=>[v.id,v.name+' · '+v.fund]),'','required aria-label="Campaign and fund"')+field('Monthly amount (USD)','amount','text','','required inputmode="decimal"')+select('Authorization channel','givingChannel',[['phone','Phone call'],['mail','Mailed signed authorization']],'phone','required aria-label="Authorization channel"')+select('Recorded authorization','sourceRef',s.sources.map(v=>[v.reference,v.label]),'','required aria-label="Recorded authorization"')+'<label><input type="checkbox" name="confirm" value="yes" required> I verified donor authorization covers the fixed monthly schedule, this saved card and immediate first charge.</label><button>Prepare for review</button></form>')
}

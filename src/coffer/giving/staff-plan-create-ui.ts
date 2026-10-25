import { requireRole } from '../auth'
import { all, commit, type Context } from '../db'
import { box, e, empty, field, hidden, select } from '../ui/common'
import { staffPlanCreateState } from './staff-plan-create'

export async function staffPlanCreatePage(c:Context,donorId:string|null){
 requireRole(c.actor,['owner','admin'],'create recurring plans')
 if(!donorId){
  const donors=await all(c,`SELECT d.id,d.name FROM cf_donors d WHERE d.erased_at IS NULL AND d.constituent_status='active' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) AND (SELECT count(*) FROM cf_giving_customers WHERE donor_id=d.id)=1 ORDER BY d.name,d.id`)
  await commit(c,[])
  return box('Choose a constituent',donors.length?`<form method="get" action="/app/giving/plans/new">${select('Constituent','donorId',[['','Choose a constituent'],...donors.map(d=>[d.id,d.name] as [string,string])],'','required aria-label="Constituent"')}<button>Review saved payment</button></form>`:empty('No current constituents have one saved Stripe customer.'))
 }
 const s=await staffPlanCreateState(c,donorId)
 const back=`<p><a href="/app/giving/plans">Recurring plans</a> · <a href="/app/donors/${encodeURIComponent(s.donor.id)}">Constituent record</a></p>`
 if(s.pending)return back+box('Creation needs a provider check','<p>A previous plan creation request is still awaiting confirmation. Check its Stripe result before submitting another charge.</p>')
 if(!s.sources.length)return back+box('Record the authorization','<p>Record the donor’s phone authorization as a call or attach the signed authorization document on this constituent before starting a plan.</p>')
 if(!s.campaigns.length)return back+empty('Create a campaign before starting a recurring plan.')
 return back+box('Start an authorized recurring plan',`<p><strong>${e(s.donor.name)}</strong> · Stripe verified this constituent’s saved card.</p><p>The amount below is charged now for the first installment, then on the selected recurring schedule. Confirm the donor authorized the amount, schedule and saved payment method, including the immediate first installment. No processing-fee cover is added.</p><form method="post" action="/app/giving/plans/new">${hidden('donorId',s.donor.id)}${hidden('customerId',s.customerId)}${hidden('paymentMethodId',s.paymentMethodId)}${hidden('version',s.version)}${hidden('requestId',crypto.randomUUID())}${select('Campaign and fund','campaignId',[['','Choose a campaign'],...s.campaigns.map(c=>[c.id,c.name+' · '+c.fund] as [string,string])],'','required aria-label="Campaign and fund"')}${field('Installment amount (USD)','amount','text','','required inputmode="decimal"')}${select('Billing frequency','frequency',[['monthly','Monthly'],['quarterly','Every three months'],['annually','Annually']],'monthly','required aria-label="Billing frequency"')}${select('Authorization channel','givingChannel',[['phone','Phone call'],['mail','Mailed signed authorization']],'phone','required aria-label="Authorization channel"')}${select('Recorded authorization evidence','sourceRef',[['','Choose the phone call or authorization document'],...s.sources.map(source=>[source.reference,source.label] as [string,string])],'','required aria-label="Recorded authorization evidence"')}<p>A mailed authorization requires its attached document. Evidence is retained with this plan’s request and audit history.</p><label><input type="checkbox" name="confirm" value="yes" required> I verified the recorded authorization covers this saved payment method, amount, recurring schedule and immediate first installment.</label><button>Charge and start plan</button></form>`)
}

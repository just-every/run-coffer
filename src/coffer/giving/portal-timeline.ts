import { all, type Context, type Row } from '../db'
import { usd } from '../money'

const titles:Record<string,string>={
 'portal.changeRequested':'Recurring gift change requested',
 'portal.change':'Recurring gift amount or frequency changed',
 'portal.pause':'Recurring collections paused',
 'portal.resume':'Recurring collections resumed',
 'portal.cancel':'Recurring gift cancelled at period end',
 'portal.cancellationTask':'Cancellation follow-up assigned to staff',
 'portal.paymentMethodUpdateStarted':'Stripe-hosted payment update opened',
 'portal.paymentMethodUpdated':'Payment method change confirmed at Stripe',
 'portal.documentDownloaded':'Approved giving document downloaded',
 'portal.copyRequested':'Giving document copy requested',
 'portal.copySubmitted':'Requested copy submitted to email provider',
 'portal.consentRegrantRequested':'Email consent regrant requested by donor',
 'consent.record':'Email consent withdrawn by donor',
}
/** The same audited donor facts feed both API history and the visible timeline.
 * A hosted redirect records only an opened update, never a replaced card. */
export async function portalTimeline(c:Pick<Context,'db'>,donorId:string){
 const rows=await all(c,"SELECT id,at,action,detail FROM cf_events WHERE donor_id=? AND actor_role='donor' AND (action LIKE 'portal.%' OR action='consent.record') ORDER BY id",donorId)
 const changes=rows.map(row=>{
  const d:Row=JSON.parse(row.detail),facts:string[]=[]
  if(Number.isSafeInteger(d.amountCents))facts.push(usd(d.amountCents))
  if(d.frequency)facts.push(String(d.frequency))
  else if(d.interval)facts.push(d.intervalCount===1?`per ${d.interval}`:`every ${d.intervalCount} ${d.interval}s`)
  if(d.collectionsPaused===true)facts.push('Future collections paused; paused invoices voided')
  if(d.collectionsPaused===false)facts.push('Collections active on the recorded schedule')
  if(row.action==='portal.cancel')facts.push('Ends at the end of the current billing period; prior gifts unchanged')
  if(row.action==='portal.paymentMethodUpdateStarted')facts.push('The donor opened Stripe’s hosted page. A replacement is not yet confirmed')
  if(row.action==='portal.paymentMethodUpdated')facts.push('A different default method was verified by reading Stripe; no payment details retained')
  if(row.action==='portal.copySubmitted')facts.push('Provider accepted the requested copy; delivery is not yet confirmed')
  if(row.action==='portal.consentRegrantRequested')facts.push('Verified donor requested email news and appeals; staff evidence is required before permission changes')
  if(row.action==='consent.record')facts.push('Email appeals and marketing permission withdrawn; transactional receipts keep their separate rules')
  return {kind:row.action==='consent.record'?'email':'portal',id:row.id,day:row.at.slice(0,10),at:row.at,title:titles[row.action]??'Donor portal activity',body:facts.join(' · ')||'Recorded by the authenticated donor'}
 })
 const deliveries=await all(c,`SELECT e.* FROM cf_portal_copy_events e JOIN cf_portal_copies copy ON copy.id=e.copy_id JOIN cf_acks a ON a.id=copy.letter_id WHERE a.donor_id=? ORDER BY e.occurred_at,e.id`,donorId)
 return [...changes,...deliveries.map(e=>({kind:'receipt',id:e.id,day:e.occurred_at.slice(0,10),at:e.occurred_at,title:'Requested giving document copy '+e.event,body:e.event==='opened'?'SendGrid provider-reported open, not proof of reading':'Signed SendGrid delivery event for the donor’s explicitly requested copy'}))]
}

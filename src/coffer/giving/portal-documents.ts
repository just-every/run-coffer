import { propertyHistory } from './portal-property'
import { currentDocumentGifts } from '../acknowledgements'
import { all, commit, event, fail, guard, one, sql, type Row } from '../db'
import { receiptNumber, receiptText } from '../receipt-format'
import { assertReceiptMailAvailable, sendReceipt } from '../receipt-mail'
import { box, e, hidden, money } from '../ui/common'
import { portalContext, type PortalDonor } from './portal-identity'
import { portalPage } from './portal-ui'
import type { GivingEnv } from './stripe'

// Only the explicitly frozen recipient sees a household piece. Membership or
// headship alone never grants a spouse access to someone else's gift history.
const documents=`SELECT a.*,b.kind,b.statement_year,b.status AS batch_status FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.donor_id=? AND b.status IN ('approved','exported','sent')`
const requestId=()=>crypto.randomUUID()
export async function givingHistory(env:GivingEnv,donor:PortalDonor,saved=false){
 const c=await portalContext(env,donor)
 const [gifts,letters,property,copies]=await Promise.all([
  all(c,`SELECT g.id,g.received_on,g.amount_cents,g.net_cents,g.fund,g.method FROM cf_gift_balances g WHERE g.donor_id=? AND g.kind='gift' ORDER BY g.received_on DESC,g.id`,donor.id),
  all(c,documents+' ORDER BY b.statement_year DESC,a.received_on DESC,a.id',donor.id),
  propertyHistory(env,donor),
  all(c,'SELECT * FROM cf_portal_copies WHERE donor_id=? ORDER BY requested_at DESC,id DESC',donor.id),
 ])
 const rows=letters.map(l=>{const lastCopy=copies.find(copy=>copy.letter_id===l.id);return `<article><h3>${e(l.kind==='statement'?`${l.statement_year} giving statement`:`Receipt ${receiptNumber(l)}`)}</h3>${l.void_reason?`<p>Void: ${e(l.void_reason)}. A corrected copy needs the organization’s approval.</p>`:`<p><a href="/giving/portal/document?letter=${encodeURIComponent(l.id)}&view=1">Read ${l.kind==='statement'?'statement':'receipt'}</a> · <a href="/giving/portal/document?letter=${encodeURIComponent(l.id)}" download>Download ${l.kind==='statement'?'statement':'receipt'}</a></p><form method="post" action="/giving/portal/copy">${hidden('letter',l.id)}${hidden('requestId',requestId())}<button>Email me a copy</button></form>`}${lastCopy?`<p>Requested copy ${e(lastCopy.delivery_status!=='pending'?lastCopy.delivery_status:lastCopy.state==='submitted'?'submitted · awaiting delivery':lastCopy.state)}.</p>`:''}</article>`}).join('')
 return portalPage('Your gifts and statements',`${saved?'<p class="notice" role="status">Your copy request was submitted to the email provider. Delivery is not yet confirmed.</p>':''}${box('Receipts and year-end statements',rows||'<p>Approved documents will appear here when the organization prepares them.</p>')}${box('Your gift history',gifts.length?`<ul class="list">${gifts.map(g=>`<li>${e(g.received_on)} · ${money(g.amount_cents)} · ${e(g.fund)} · ${e(g.method)}${g.net_cents!==g.amount_cents?` · remaining after refunds or reversals: ${money(g.net_cents)}`:''}</li>`).join('')}</ul>`:'<p>No gifts are recorded on this account.</p>')}${property}<p><a href="/giving/portal">Back to your giving account</a></p>`)
}
async function ownDocument(env:GivingEnv,donor:PortalDonor,letterId:string){
 const c=await portalContext(env,donor),letter=await one(c,documents+' AND a.id=?',donor.id,letterId)
 if(!letter)fail('not_found','That document is not available on your account.',404)
 if(letter.void_reason)fail('VOID_RECEIPT','This document is void. Contact the organization for its approved correction.',409)
 await commit(c,[currentDocumentGifts(letter.id)])
 return {c,letter}
}
/** A portable printable HTML copy, using only approved frozen document text.
 * It is also readable inline; the browser can save the same snapshot as PDF. */
export async function downloadDocument(env:GivingEnv,donor:PortalDonor,letterId:string,inline=false){
 const {c,letter}=await ownDocument(env,donor,letterId)
 await commit(c,[currentDocumentGifts(letter.id),event(c,'portal.documentDownloaded','acknowledgement',letter.id,donor.id,{kind:letter.kind,receiptNumber:receiptNumber(letter)})])
 const body=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(letter.subject)}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:48rem;padding:24px;margin:auto;color:#182128}h1{font-size:1.4rem}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}@page{size:letter;margin:.75in}@media print{nav{display:none}body{padding:0}}</style></head><body><nav><a href="/giving/portal/history">Back to your gifts</a><p>Use your browser’s Print menu to print or save as PDF.</p></nav><h1>${e(letter.subject)}</h1><p>${e(letter.recipient_name)}</p><pre>${e(receiptText(letter))}</pre></body></html>`
 return new Response(body,{headers:{'content-type':'text/html; charset=utf-8','content-disposition':`${inline?'inline':'attachment'}; filename="coffer-${letter.kind==='statement'?`statement-${letter.statement_year}`:`receipt-${receiptNumber(letter)}`}.html"`,'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}})
}
export async function requestDocumentCopy(env:GivingEnv,donor:PortalDonor,data:URLSearchParams){
 const {c,letter}=await ownDocument(env,donor,data.get('letter')??''),id=data.get('requestId')??''
 if(!/^[a-f0-9-]{36}$/.test(id))fail('input','Use the copy request button.',400)
 if(data.has('donorId')&&data.get('donorId')!==donor.id)fail('FORBIDDEN','Only your own copy may be requested.',403)
 const previous=await one(c,'SELECT * FROM cf_portal_copies WHERE id=?',id)
 if(previous){
  if(previous.donor_id!==donor.id||previous.letter_id!==letter.id)fail('request_changed','This request does not match your document.',409)
  if(previous.state==='submitted'||previous.delivery_status==='delivered')return
  fail('copy_pending','This copy request needs a delivery check before another is sent. Contact the organization.',409)
 }
 const live=await one(c,'SELECT constituent_status FROM cf_donors WHERE id=?',donor.id)
 if(live?.constituent_status!=='active'||letter.recipient_email!==donor.email)fail('copy_unavailable','Contact the organization to confirm the delivery details for this frozen document.',409)
 if(await one(c,"SELECT 1 FROM cf_acks WHERE donor_id=? AND recipient_email=? AND delivery_status IN ('bounced','complained') UNION ALL SELECT 1 FROM cf_portal_copies WHERE donor_id=? AND delivery_status IN ('bounced','complained')",donor.id,donor.email,donor.id))fail('copy_unavailable','The organization needs to check your email address before sending another copy.',409)
 assertReceiptMailAvailable(env)
 await commit(c,[currentDocumentGifts(letter.id),guard("EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND constituent_status='active' AND email=?)",'DONOR_CHANGED','Your delivery details changed. Contact the organization.',donor.id,letter.recipient_email),sql("INSERT INTO cf_portal_copies(id,donor_id,letter_id,state,requested_at) VALUES(?,?,?,'sending',?)",id,donor.id,letter.id,c.now),event(c,'portal.copyRequested','acknowledgement',letter.id,donor.id,{requestId:id})])
 try{
  const sent=await sendReceipt(env,{...letter,attempt_id:id})
  await env.DB.batch([env.DB.prepare("UPDATE cf_portal_copies SET state='submitted',message_id=? WHERE id=? AND state='sending'").bind(sent.messageId,id),env.DB.prepare(event(c,'portal.copySubmitted','acknowledgement',letter.id,donor.id,{requestId:id}).sql).bind(...event(c,'portal.copySubmitted','acknowledgement',letter.id,donor.id,{requestId:id}).params)])
 }catch(error:any){
  await env.DB.prepare('UPDATE cf_portal_copies SET state=? WHERE id=?').bind(['mail_rejected','mail_rate_limited'].includes(error?.code)?'rejected':'uncertain',id).run()
  throw error
 }
}

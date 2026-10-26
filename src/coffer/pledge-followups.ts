import type { Bindings } from '../auth.server'
import { all, commit, event, newId, one, sql, today, type Context } from './db'
import { donorMailUnavailable, sendDonorMail, DonorMailError } from './outbound-mail'
import { settings } from './settings'
import { usd } from './money'

/** A pledge follow-up is a non-ask. Current channel permission still applies. */
export async function runPledgeFollowups(env: Bindings, at: Date) {
 if (donorMailUnavailable(env)) return
 const c: Context = { db: env.DB, env, now: at.toISOString(), actor: { id:'coffer-scheduler', name:'Pledge scheduler', role:'owner' }, authority: { sql:'EXISTS(SELECT 1 FROM cf_settings WHERE id=1)', params:[] } }
 const s=await settings(c), day=today(s.timezone,at)
 await commit(c,[sql("UPDATE cf_pledge_followups SET status='uncertain' WHERE status='sending' AND attempted_at<=?",new Date(at.getTime()-15*60_000).toISOString())])
 const current=`FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id
  WHERE i.due_on<? AND i.amount_cents>i.paid_cents AND d.erased_at IS NULL AND d.constituent_status='active'
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
  AND (SELECT status FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1)='granted'
  AND EXISTS(SELECT 1 FROM cf_contact_points cp WHERE cp.donor_id=d.id AND cp.kind='email' AND cp.active=1 AND cp.is_primary=1 AND cp.value=d.email)
  AND NOT EXISTS(SELECT 1 FROM cf_acks a WHERE a.donor_id=d.id AND a.recipient_email=d.email AND a.delivery_status IN ('bounced','complained'))`
 const due=await all(c,`SELECT i.id ${current} AND NOT EXISTS(SELECT 1 FROM cf_pledge_followups f WHERE f.installment_id=i.id) ORDER BY i.due_on,i.id LIMIT 8`,day)
 for(const row of due){
  const i=await one(c,`SELECT i.*,p.donor_id,p.fund,d.email ${current} AND i.id=?`,day,row.id)
  if(!i)continue
  const attempt=newId(),balance=i.amount_cents-i.paid_cents
  const body=`Thank you for your pledge to ${s.organisation}. The ${i.fund} installment due ${i.due_on} has ${usd(balance)} remaining. If you have already sent payment, please contact us so we can match it to your pledge. This is a follow-up on your existing commitment.`
  await commit(c,[sql(`INSERT OR IGNORE INTO cf_pledge_followups(installment_id,attempt_id,status,recipient_email,body,attempted_at)
   SELECT i.id,?,'sending',d.email,?,? ${current} AND i.id=? AND i.amount_cents-i.paid_cents=? AND d.email=?`,attempt,body,c.now,day,i.id,balance,i.email)])
  // Recheck eligibility after claiming and before crossing the network edge.
  const ready=await one(c,`SELECT i.id ${current} AND i.id=? AND i.amount_cents-i.paid_cents=? AND d.email=?
   AND EXISTS(SELECT 1 FROM cf_pledge_followups f WHERE f.installment_id=i.id AND f.attempt_id=? AND f.status='sending')`,day,i.id,balance,i.email,attempt)
  if(!ready){await commit(c,[sql("UPDATE cf_pledge_followups SET status='skipped',recipient_email=NULL,body=NULL WHERE attempt_id=? AND status='sending'",attempt)]);continue}
  let status='uncertain',messageId:string|null=null
  try{const result=await sendDonorMail(env,{deliveryId:attempt,from:env.MAIL_FROM!,to:[i.email],subject:'Follow-up on your pledge installment',text:body,customArgs:{coffer_installment_id:i.id,coffer_attempt_id:attempt}});messageId=result.providerMessageId??null;status=messageId?'submitted':'uncertain'}
  catch(error){if(error instanceof DonorMailError&&['rejected','rate_limited'].includes(error.outcome))status='rejected'}
  await commit(c,[sql("UPDATE cf_pledge_followups SET status=?,message_id=? WHERE attempt_id=? AND status='sending'",status,messageId,attempt),event(c,'pledge.followup','pledge',i.pledge_id,i.donor_id,{installmentId:i.id,state:status})])
 }
}

export { developmentFollowups, runDevelopmentFollowups, approveDevelopmentReminder, recordDevelopmentReply, resolveDevelopmentFollowup } from './development-followups'

import type { Bindings } from '../../auth.server'
import { all, newId, one, type Row } from '../db'
import { openWebhookKey, webhookEndpoint, webhookSignature } from './security'

const MAX_ATTEMPTS=6
/** A lease prevents concurrent ticks claiming the same attempt. Expired claims
 * remain in the log as uncertain; at-least-once delivery can duplicate an event. */
export async function runWebhooks(env: Bindings, at=new Date()) {
 const now=at.toISOString(),c={db:env.DB}
 const due=await all(c,`SELECT id FROM cf_webhook_deliveries WHERE (status IN ('pending','failed') AND next_at<=?) OR (status='sending' AND lease_until<=?) ORDER BY next_at,id LIMIT 25`,now,now)
 for (const candidate of due) {
  const lease=newId(),until=new Date(at.getTime()+60000).toISOString()
  const claimed=await env.DB.prepare(`UPDATE cf_webhook_deliveries SET status='sending',lease_token=?,lease_until=? WHERE id=? AND ((status IN ('pending','failed') AND next_at<=?) OR (status='sending' AND lease_until<=?)) RETURNING *`).bind(lease,until,candidate.id,now,now).first<Row>()
  if (!claimed) continue
  const s=await one(c,'SELECT * FROM cf_webhook_subscriptions WHERE id=?',claimed.subscription_id)
  const approved=s?.enabled && await one(c,"SELECT id FROM oa_operators WHERE id=? AND version=? AND status='active' AND role IN ('owner','admin')",s.approved_by,s.approver_version)
  if (!approved) { await env.DB.prepare("UPDATE cf_webhook_deliveries SET status='held',lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").bind(claimed.id,lease).run(); continue }
  const e=await one(c,'SELECT * FROM cf_webhook_events WHERE id=?',claimed.event_id)
  if (!e) continue
  await env.DB.prepare("UPDATE cf_webhook_attempts SET status='uncertain' WHERE delivery_id=? AND status='sending'").bind(claimed.id).run()
  if (claimed.attempts>=MAX_ATTEMPTS) { await env.DB.prepare("UPDATE cf_webhook_deliveries SET status='exhausted',lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").bind(claimed.id,lease).run(); continue }
  const attemptId=newId(),attempt=claimed.attempts+1
  // Recheck disclosure authority in the batch immediately preceding fetch.
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO cf_webhook_attempts(id,delivery_id,attempted_at,status) SELECT ?,?,?,'sending' FROM cf_webhook_deliveries d JOIN cf_webhook_subscriptions s ON s.id=d.subscription_id JOIN oa_operators o ON o.id=s.approved_by WHERE d.id=? AND d.lease_token=? AND s.enabled=1 AND o.status='active' AND o.role IN ('owner','admin') AND o.version=s.approver_version`).bind(attemptId,claimed.id,now,claimed.id,lease),
   env.DB.prepare('UPDATE cf_webhook_deliveries SET attempts=? WHERE id=? AND lease_token=? AND EXISTS(SELECT 1 FROM cf_webhook_attempts WHERE id=?)').bind(attempt,claimed.id,lease,attemptId)
  ])
  if (!await one(c,'SELECT id FROM cf_webhook_attempts WHERE id=?',attemptId)) continue
  let status:number|null=null
  try {
   const body=JSON.stringify({id:e.id,type:e.event_type,occurredAt:e.occurred_at,data:{id:e.subject_id}})
   const signature=await webhookSignature(await openWebhookKey(env,s!.sealed_secret),String(Math.floor(at.getTime()/1000)),body)
   const response=await fetch(webhookEndpoint(s!.endpoint),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','coffer-signature':signature,'coffer-event-id':e.id,'coffer-delivery-id':claimed.id},body})
   status=response.status
   await response.body?.cancel()
  } catch { /* Network outcomes stay private; the attempt records no response body. */ }
  const accepted=status!==null && status>=200 && status<300
  const next=new Date(at.getTime()+60000*2**(attempt-1)).toISOString()
  await env.DB.batch([
   env.DB.prepare('UPDATE cf_webhook_attempts SET status=?,http_status=? WHERE id=?').bind(accepted?'delivered':'failed',status,attemptId),
   env.DB.prepare('UPDATE cf_webhook_deliveries SET status=?,next_at=?,last_status=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').bind(accepted?'delivered':attempt>=MAX_ATTEMPTS?'exhausted':'failed',next,status,claimed.id,lease)
  ])
 }
}

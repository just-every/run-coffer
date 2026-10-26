import { requireRole } from './auth'
import { all, choice, commit, event, fail, guard, id, newId, one, sql, text, type Context, type Row } from './db'
import { freshWebhookKey, sealWebhookKey, webhookEndpoint } from './webhooks/security'
import { readableWebhookKey, webhookContinuityCommand } from './webhooks/continuity'

export const WEBHOOK_EVENTS = ['gift.created','gift.reversed','donor.created','donor.updated','plan.failed','plan.canceled','task.assigned','form.submitted'] as const
/** History is retained until associated donor erasure; paging never deletes it. */
export async function webhookState(c: Context, before?: string | null) {
 requireRole(c.actor,['owner','admin'],'manage webhooks')
 let cursor: string[] | undefined
 if (before) {
  try { cursor=JSON.parse(atob(before)) } catch { fail('INPUT','Invalid delivery history cursor.',400) }
  if (!Array.isArray(cursor) || cursor.length!==2 || cursor.some(v=>typeof v!=='string'||v.length>100)) fail('INPUT','Invalid delivery history cursor.',400)
 }
 const [subscriptions,rows] = await Promise.all([
  all(c,`SELECT s.id,s.name,s.endpoint,s.events,s.enabled,s.version,s.sealed_secret,s.key_generation,s.overlap_until,CASE WHEN s.previous_sealed_secret IS NOT NULL THEN 1 ELSE 0 END AS previous_key,CASE WHEN EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=s.approved_by AND o.version=s.approver_version AND o.status='active' AND o.role IN ('owner','admin')) THEN 1 ELSE 0 END AS approved FROM cf_webhook_subscriptions s ORDER BY s.created_at DESC,s.id`),
  all(c,`SELECT d.*,e.event_type,e.subject_id,e.occurred_at,s.name AS endpoint_name FROM cf_webhook_deliveries d JOIN cf_webhook_events e ON e.id=d.event_id JOIN cf_webhook_subscriptions s ON s.id=d.subscription_id ${cursor?'WHERE (d.created_at,d.id)<(?,?)':''} ORDER BY d.created_at DESC,d.id DESC LIMIT 101`,...(cursor??[]))
 ])
 const deliveries=rows.slice(0,100),last=deliveries.at(-1)
 const attempts=deliveries.length?await all(c,`SELECT * FROM cf_webhook_attempts WHERE delivery_id IN (${deliveries.map(()=>'?').join(',')}) ORDER BY attempted_at,id`,...deliveries.map(d=>d.id)):[]
 const publicSubscriptions=await Promise.all(subscriptions.map(async(s):Promise<Row & {events:string[]}>=>{const {sealed_secret,...safe}=s;return {...safe,events:JSON.parse(s.events),key_available:await readableWebhookKey(c,s)}}))
 return {subscriptions:publicSubscriptions,deliveries,attempts,nextCursor:rows.length>100&&last?btoa(JSON.stringify([last.created_at,last.id])):null}
}
export async function webhookCommand(c: Context, command: string, p: Row): Promise<Row|undefined> {
 if (!command.startsWith('webhook.')) return
 requireRole(c.actor,['owner','admin'],'manage webhooks')
 const continuity=await webhookContinuityCommand(c,command,p)
 if (continuity) return continuity
 if (command === 'webhook.subscribe') {
  if (p.reviewed !== 'yes') fail('WEBHOOK_CONSENT','Approve this endpoint and ongoing deliveries explicitly.',400)
  const name=text(p.name,'Endpoint name',100),endpoint=webhookEndpoint(p.endpoint)
  const raw=Array.isArray(p.events)?p.events:[p.events]
  if (!raw.length || raw.length>WEBHOOK_EVENTS.length) fail('INPUT','Choose webhook events.',400)
  const events=[...new Set(raw.map(value=>choice(value,WEBHOOK_EVENTS,'webhook event')))]
  const subscriptionId=newId(),secret=freshWebhookKey()
  const operator=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id)
  await commit(c,[sql('INSERT INTO cf_webhook_subscriptions(id,name,endpoint,events,sealed_secret,approved_by,approver_version,created_at) VALUES(?,?,?,?,?,?,?,?)',subscriptionId,name,endpoint,JSON.stringify(events),await sealWebhookKey(c.env!,secret),c.actor.id,operator!.version,c.now),event(c,command,'webhook',subscriptionId,null,{events,explicitDisclosureApproval:true,identifierOnly:true})])
  return {id:subscriptionId,secret}
 }
 if (command === 'webhook.pause') {
  const subscriptionId=id(p.subscriptionId,'Endpoint')
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE id=? AND version=? AND enabled=1)','VERSION','This endpoint changed. Refresh before pausing.',subscriptionId,Number(p.version)),sql('UPDATE cf_webhook_subscriptions SET enabled=0,version=version+1 WHERE id=?',subscriptionId),sql("UPDATE cf_webhook_deliveries SET status='held',lease_token=NULL,lease_until=NULL WHERE subscription_id=? AND status IN ('pending','failed','sending')",subscriptionId),event(c,command,'webhook',subscriptionId,null)])
  return {id:subscriptionId}
 }
 if (command !== 'webhook.replay') return
 if (p.reviewed !== 'yes') fail('WEBHOOK_CONSENT','Confirm that replay may deliver the same event again.',400)
 const deliveryId=id(p.deliveryId,'Delivery'),delivery=await one(c,'SELECT * FROM cf_webhook_deliveries WHERE id=?',deliveryId)
 if (!delivery) fail('NOT_FOUND','That webhook delivery does not exist.',404)
 const subscription=await one(c,'SELECT * FROM cf_webhook_subscriptions WHERE id=?',delivery.subscription_id)
 if (!subscription || !await readableWebhookKey(c,subscription)) fail('WEBHOOK_SECRET','Recover this signing key before replaying.')
 const replayId=newId()
 await commit(c,[guard(`EXISTS(SELECT 1 FROM cf_webhook_deliveries d JOIN cf_webhook_subscriptions s ON s.id=d.subscription_id JOIN oa_operators o ON o.id=s.approved_by WHERE d.id=? AND d.status IN ('delivered','exhausted','held') AND s.enabled=1 AND o.version=s.approver_version AND o.status='active' AND o.role IN ('owner','admin'))`,'WEBHOOK_REPLAY','Only a completed delivery with current endpoint approval can be replayed.',deliveryId),sql("INSERT INTO cf_webhook_deliveries(id,subscription_id,event_id,status,next_at,replay_of,created_at) VALUES(?,?,?,'pending',?,?,?)",replayId,delivery.subscription_id,delivery.event_id,c.now,deliveryId,c.now),event(c,command,'webhook_delivery',replayId,null,{replayOf:deliveryId,explicitDuplicateApproval:true})])
 return {id:replayId}
}

/** Run before native erasure moves records to their anonymous placeholder. */
export function webhookErasureStatements(donorId: string) {
 return [sql(`DELETE FROM cf_webhook_events WHERE subject_id=?
 OR subject_id IN (SELECT id FROM cf_gifts WHERE donor_id=?)
 OR subject_id IN (SELECT p.id FROM cf_payment_entries p JOIN cf_gifts g ON g.id=p.gift_id WHERE g.donor_id=?)
 OR subject_id IN (SELECT id FROM cf_subscriptions WHERE donor_id=?)
 OR subject_id IN (SELECT id FROM cf_giving_intents WHERE donor_id=?)
 OR subject_id IN (SELECT id FROM cf_call_tasks WHERE donor_id=?)
 OR subject_id IN (SELECT t.id FROM cf_recurring_tasks t JOIN cf_recurring_task_series s ON s.id=t.series_id WHERE s.donor_id=?)
 OR subject_id IN (SELECT t.id FROM cf_grant_tasks t JOIN cf_grants g ON g.id=t.grant_id WHERE g.donor_id=?)`,...Array(8).fill(donorId))]
}

import { requireRole } from './auth'
import { all, choice, commit, event, fail, guard, id, newId, one, sql, text, type Context, type Row } from './db'
import { sealWebhookKey, webhookEndpoint } from './webhooks/security'

export const WEBHOOK_EVENTS = ['gift.created','gift.reversed','donor.created','donor.updated','plan.failed','plan.canceled','task.assigned','form.submitted'] as const
export async function webhookState(c: Context) {
 requireRole(c.actor,['owner','admin'],'manage webhooks')
 const [subscriptions,deliveries,attempts] = await Promise.all([
  all(c,'SELECT id,name,endpoint,events,enabled,version FROM cf_webhook_subscriptions ORDER BY created_at DESC,id'),
  all(c,`SELECT d.*,e.event_type,e.subject_id,e.occurred_at,s.name AS endpoint_name FROM cf_webhook_deliveries d JOIN cf_webhook_events e ON e.id=d.event_id JOIN cf_webhook_subscriptions s ON s.id=d.subscription_id ORDER BY d.created_at DESC,d.id LIMIT 100`),
  all(c,`SELECT a.* FROM cf_webhook_attempts a WHERE a.delivery_id IN (SELECT id FROM cf_webhook_deliveries ORDER BY created_at DESC,id LIMIT 100) ORDER BY attempted_at,id`)
 ])
 return {subscriptions:subscriptions.map((s):Row & {events:string[]}=>({...s,events:JSON.parse(s.events)})),deliveries,attempts}
}
export async function webhookCommand(c: Context, command: string, p: Row): Promise<Row|undefined> {
 if (!command.startsWith('webhook.')) return
 requireRole(c.actor,['owner','admin'],'manage webhooks')
 if (command === 'webhook.subscribe') {
  if (p.reviewed !== 'yes') fail('WEBHOOK_CONSENT','Approve this endpoint and ongoing deliveries explicitly.',400)
  const name=text(p.name,'Endpoint name',100),endpoint=webhookEndpoint(p.endpoint)
  const raw=Array.isArray(p.events)?p.events:[p.events]
  if (!raw.length || raw.length>WEBHOOK_EVENTS.length) fail('INPUT','Choose webhook events.',400)
  const events=[...new Set(raw.map(value=>choice(value,WEBHOOK_EVENTS,'webhook event')))]
  const subscriptionId=newId(),secret=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('')
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
 const replayId=newId()
 await commit(c,[guard(`EXISTS(SELECT 1 FROM cf_webhook_deliveries d JOIN cf_webhook_subscriptions s ON s.id=d.subscription_id JOIN oa_operators o ON o.id=s.approved_by WHERE d.id=? AND d.status IN ('delivered','exhausted','held') AND s.enabled=1 AND o.version=s.approver_version AND o.status='active' AND o.role IN ('owner','admin'))`,'WEBHOOK_REPLAY','Only a completed delivery with current endpoint approval can be replayed.',deliveryId),sql("INSERT INTO cf_webhook_deliveries(id,subscription_id,event_id,status,next_at,replay_of,created_at) VALUES(?,?,?,'pending',?,?,?)",replayId,delivery.subscription_id,delivery.event_id,c.now,deliveryId,c.now),event(c,command,'webhook_delivery',replayId,null,{replayOf:deliveryId,explicitDuplicateApproval:true})])
 return {id:replayId}
}

import { commit, event, fail, guard, id, integer, newId, one, sql, type Context, type Row } from '../db'
import { freshWebhookKey, openWebhookKey, sealWebhookKey } from './security'

export const currentWebhookApproval = `EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=s.approved_by AND o.version=s.approver_version AND o.status='active' AND o.role IN ('owner','admin'))`
export const terminalWebhookDelivery = "d.status IN ('delivered','exhausted','held')"

export async function readableWebhookKey(c: Context, subscription: Row) {
 try { await openWebhookKey(c.env!, subscription.sealed_secret); return true } catch { return false }
}

export async function webhookContinuityCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['webhook.rotate','webhook.retireOverlap','webhook.recover','webhook.resume','webhook.migrateReplay'].includes(command)) return
 if (p.reviewed !== 'yes') fail('WEBHOOK_CONSENT','Review and explicitly approve this webhook change.',400)
 const subscriptionId=id(p.subscriptionId,'Endpoint'),version=integer(Number(p.version),'Endpoint version',1)
 const subscription=await one(c,'SELECT * FROM cf_webhook_subscriptions WHERE id=?',subscriptionId)
 if (!subscription) fail('NOT_FOUND','That endpoint does not exist.',404)
 const unchanged=guard('EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE id=? AND version=?)','VERSION','This endpoint changed. Refresh before continuing.',subscriptionId,version)
 const approved=guard(`EXISTS(SELECT 1 FROM cf_webhook_subscriptions s WHERE s.id=? AND ${currentWebhookApproval})`,'WEBHOOK_APPROVAL','This endpoint needs current approval.',subscriptionId)
 const operator=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id)
 if (command==='webhook.migrateReplay') {
  const deliveryId=id(p.deliveryId,'Original delivery'),delivery=await one(c,'SELECT * FROM cf_webhook_deliveries WHERE id=?',deliveryId)
  if (!delivery) fail('NOT_FOUND','That delivery does not exist.',404)
  if (!await readableWebhookKey(c,subscription)) fail('WEBHOOK_SECRET','Recover the target signing key before replaying.')
  const replayId=newId()
  await commit(c,[unchanged,approved,guard(`EXISTS(SELECT 1 FROM cf_webhook_deliveries d JOIN cf_webhook_events e ON e.id=d.event_id JOIN cf_webhook_subscriptions s ON s.id=? WHERE d.id=? AND d.subscription_id<>s.id AND ${terminalWebhookDelivery} AND s.enabled=1 AND EXISTS(SELECT 1 FROM json_each(s.events) WHERE value=e.event_type))`,'WEBHOOK_REPLAY','Choose a different active endpoint subscribed to this completed event.',subscriptionId,deliveryId),
   sql("INSERT INTO cf_webhook_deliveries(id,subscription_id,event_id,status,next_at,replay_of,created_at) VALUES(?,?,?,'pending',?,?,?)",replayId,subscriptionId,delivery.event_id,c.now,deliveryId,c.now),
   event(c,command,'webhook_delivery',replayId,null,{replayOf:deliveryId,fromSubscription:delivery.subscription_id,toSubscription:subscriptionId,explicitDisclosureApproval:true,explicitDuplicateApproval:true})])
  return {id:replayId}
 }
 const readable=await readableWebhookKey(c,subscription)
 if (command==='webhook.recover') {
  if (readable) fail('WEBHOOK_SECRET','This key is readable. Use signing-key rotation instead.')
  const secret=freshWebhookKey()
  await commit(c,[unchanged,sql('UPDATE cf_webhook_subscriptions SET sealed_secret=?,previous_sealed_secret=NULL,overlap_until=NULL,key_generation=key_generation+1,enabled=0,approved_by=?,approver_version=?,version=version+1 WHERE id=?',await sealWebhookKey(c.env!,secret),c.actor.id,operator!.version,subscriptionId),
   sql("UPDATE cf_webhook_deliveries SET status='held',lease_token=NULL,lease_until=NULL WHERE subscription_id=? AND status IN ('pending','failed','sending')",subscriptionId),
   event(c,command,'webhook',subscriptionId,null,{explicitFreshKeyApproval:true,oldKeyRecovered:false,paused:true,keyGeneration:subscription.key_generation+1})])
  return {id:subscriptionId,secret}
 }
 if (!readable) fail('WEBHOOK_SECRET','The installation cannot open this signing key. Approve a fresh-key recovery.')
 if (command==='webhook.resume') {
  await commit(c,[unchanged,guard('EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE id=? AND enabled=0)','WEBHOOK_STATE','Only a paused endpoint can be resumed.',subscriptionId),
   sql('UPDATE cf_webhook_subscriptions SET enabled=1,approved_by=?,approver_version=?,version=version+1 WHERE id=?',c.actor.id,operator!.version,subscriptionId),event(c,command,'webhook',subscriptionId,null,{explicitDisclosureApproval:true,heldHistoryRequeued:false})])
  return {id:subscriptionId}
 }
 if (command==='webhook.retireOverlap') {
  await commit(c,[unchanged,approved,guard('EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE id=? AND previous_sealed_secret IS NOT NULL)','WEBHOOK_STATE','No previous signing key remains.',subscriptionId),sql('UPDATE cf_webhook_subscriptions SET previous_sealed_secret=NULL,overlap_until=NULL,version=version+1 WHERE id=?',subscriptionId),event(c,command,'webhook',subscriptionId,null,{explicitRetirementApproval:true})])
  return {id:subscriptionId}
 }
 if (p.overlapMinutes===undefined || !/^\d+$/.test(String(p.overlapMinutes))) fail('INPUT','Choose overlap minutes from 0 to 1440.',400)
 const minutes=integer(Number(p.overlapMinutes),'Overlap minutes',0,1440),overlapUntil=minutes?new Date(Date.parse(c.now)+minutes*60000).toISOString():null,secret=freshWebhookKey()
 await commit(c,[unchanged,approved,guard('EXISTS(SELECT 1 FROM cf_webhook_subscriptions WHERE id=? AND (overlap_until IS NULL OR overlap_until<=?))','WEBHOOK_OVERLAP','Retire the existing overlap before rotating again.',subscriptionId,c.now),
  sql('UPDATE cf_webhook_subscriptions SET previous_sealed_secret=?,overlap_until=?,sealed_secret=?,key_generation=key_generation+1,version=version+1 WHERE id=?',minutes?subscription.sealed_secret:null,overlapUntil,await sealWebhookKey(c.env!,secret),subscriptionId),
  event(c,command,'webhook',subscriptionId,null,{explicitFreshKeyApproval:true,overlapUntil,keyGeneration:subscription.key_generation+1})])
 return {id:subscriptionId,secret}
}

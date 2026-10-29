import { commit, event, fail, guard, id, one, text, type Context, type Row } from '../db'
import { currentWebhookApproval } from '../webhooks/continuity'
import { openWebhookKey } from '../webhooks/security'
import { verifyWebhook } from '../webhooks/receiver.mjs'

/** Verification is a read, never subscription administration. Only the native
 * approver's full key can accept a capture for that exact approved receiver. */
export async function verifyWebhookReceipt(c:Context, scope:string, p:Row) {
 if(scope!=='full')fail('SCOPE_FORBIDDEN','A full local key is required.',403)
 const subscriptionId=id(p.subscriptionId,'Endpoint'),deliveryId=id(p.deliveryId,'Delivery')
 const targetUrl=text(p.targetUrl,'Receiver',2000),signature=text(p.signature,'Signature',300)
 if(typeof p.rawBody!=='string'||!p.rawBody.length||p.rawBody.length>8000)fail('WEBHOOK_BODY','Supply the exact signed request bytes.',400)
 const body=p.rawBody
 const s=await one(c,`SELECT s.* FROM cf_webhook_subscriptions s WHERE s.id=? AND s.enabled=1 AND s.approved_by=? AND s.endpoint=? AND ${currentWebhookApproval}`,subscriptionId,c.actor.id,targetUrl)
 if(!s)fail('WEBHOOK_APPROVAL','Use your own current native approval for this exact receiver.',403)
 let captured:Row|undefined
 const keys=[s.sealed_secret,...(s.previous_sealed_secret&&s.overlap_until>c.now?[s.previous_sealed_secret]:[])]
 for(const sealed of keys)try{captured=await verifyWebhook(await openWebhookKey(c.env!,sealed),signature,body,Date.parse(c.now));break}catch{/* Invalid signatures and unreadable keys disclose nothing. */}
 if(!captured)fail('WEBHOOK_SIGNATURE','The exact signed bytes must be authentic and fresh.',403)
 const stored=await one(c,`SELECT e.* FROM cf_webhook_events e JOIN cf_webhook_deliveries d ON d.event_id=e.id WHERE e.id=? AND d.id=? AND d.subscription_id=? AND d.status<>'held'`,captured.id,deliveryId,subscriptionId)
 if(!stored)fail('WEBHOOK_EVENT','This capture is unavailable.',403)
 const canonical={id:stored.id,type:stored.event_type,occurredAt:stored.occurred_at,data:{id:stored.subject_id}}
 if(body!==JSON.stringify(canonical)||!JSON.parse(s.events).includes(stored.event_type))fail('WEBHOOK_EVENT','The capture does not match this subscription.',403)
 await commit(c,[guard(`EXISTS(SELECT 1 FROM cf_webhook_subscriptions s JOIN cf_webhook_deliveries d ON d.subscription_id=s.id JOIN cf_webhook_events e ON e.id=d.event_id WHERE s.id=? AND s.version=? AND s.enabled=1 AND s.approved_by=? AND s.endpoint=? AND ${currentWebhookApproval} AND d.id=? AND d.status<>'held' AND e.id=?)`,'WEBHOOK_CHANGED','Approval or event changed. Capture a new current delivery.',subscriptionId,s.version,c.actor.id,targetUrl,deliveryId,stored.id),event(c,'api.webhookVerified','route','/api/coffer/v1/webhook-receipts/verify',null,{},'cf_access_events')])
 return canonical
}

import { all, commit, event, fail, one, sha256, sql, text, type Context, type Row } from '../db'
import { givingConnection, sealGiving } from './connections'
import { stripe, type GivingEnv } from './stripe'
export async function protectionCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if(command==='giving.protection') {
  const siteKey=text(p.siteKey,'Turnstile site key',200),secret=text(p.secret,'Turnstile secret',1000)
  const sealed=await sealGiving(c.env as GivingEnv,{siteKey,secret})
  await commit(c,[sql("INSERT INTO cf_giving_connections VALUES('turnstile',?,?) ON CONFLICT(name) DO UPDATE SET sealed=excluded.sealed,updated_at=excluded.updated_at",sealed,c.now),event(c,command,'giving','turnstile',null)])
  return {configured:true}
 }
 if(command!=='giving.resume')return undefined
 const campaignId=text(p.campaignId,'Campaign',100)
 await commit(c,[sql('DELETE FROM cf_giving_attempt_windows WHERE campaign_id=?',campaignId),event(c,command,'giving',campaignId,null)])
 return {resumed:true}
}
export const protectionState=(c:Pick<Context,'db'>)=>all(c,'SELECT w.*,c.name FROM cf_giving_attempt_windows w JOIN cf_campaigns c ON c.id=w.campaign_id ORDER BY alerted_at DESC')
export async function failedAttempt(env: GivingEnv,campaignId: string) {
 const minute=Math.floor(Date.now()/60000)
 await env.DB.prepare(`INSERT INTO cf_giving_attempt_windows VALUES(?,?,1,1,0,NULL) ON CONFLICT(campaign_id) DO UPDATE SET failures=CASE WHEN minute=excluded.minute THEN failures+1 ELSE 1 END,attempts=CASE WHEN minute=excluded.minute THEN attempts ELSE 1 END,minute=excluded.minute`).bind(campaignId,minute).run()
 // Ten failures and at least half the minute's attempts is a spike. Pause stays
 // latched across minute boundaries until a human explicitly resumes the form.
 await env.DB.prepare('UPDATE cf_giving_attempt_windows SET paused=1,alerted_at=COALESCE(alerted_at,?) WHERE campaign_id=? AND failures>=10 AND failures*2>=attempts').bind(new Date().toISOString(),campaignId).run()
}
export async function protectCheckout(env: GivingEnv,request: Request,campaignId: string,p: Row) {
 const current=await one({db:env.DB},'SELECT paused FROM cf_giving_attempt_windows WHERE campaign_id=?',campaignId)
 if(current?.paused)fail('form_paused','Giving is temporarily paused while the organization reviews unusual payment activity.',409)
 const minute=Math.floor(Date.now()/60000)
 await env.DB.prepare(`INSERT INTO cf_giving_attempt_windows VALUES(?,?,1,0,0,NULL) ON CONFLICT(campaign_id) DO UPDATE SET attempts=CASE WHEN minute=excluded.minute THEN attempts+1 ELSE 1 END,failures=CASE WHEN minute=excluded.minute THEN failures ELSE 0 END,minute=excluded.minute`).bind(campaignId,minute).run()
 const ip=request.headers.get('CF-Connecting-IP')??'unknown',hash=await sha256('giving-address:'+ip)
 const count=await env.DB.prepare(`INSERT INTO cf_giving_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count`).bind(hash,minute).first<{count:number}>()
 if(!count||count.count>10){await failedAttempt(env,campaignId);fail('rate_limited','Too many giving attempts. Please try later.',429)}
 const config=await givingConnection(env,'turnstile')
 if(!config)fail('protection_unavailable','Online giving is temporarily unavailable while the organization connects its security check.',503)
 const token=p['cf-turnstile-response']
 let valid=false
 if(typeof token==='string'&&token.length>0&&token.length<=2048)try {
  const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:config.secret,response:token,remoteip:ip}),redirect:'manual',signal:AbortSignal.timeout(10000)})
  const result=await response.json() as Row
  valid=response.ok&&result.success===true&&result.hostname===new URL(env.AUTH_ORIGIN).hostname&&result.action==='giving'
 }catch{/* Unavailable verification never permits checkout. */}
 if(!valid){await failedAttempt(env,campaignId);fail('challenge_required','Complete the security check before giving.',403)}
}
/** The claim and counter update share a transaction: concurrent deliveries and
 * distinct provider events for one observed attempt must count only once. */
export async function providerFailure(env: GivingEnv, campaignId: string, attempt: string, failed = true) {
 const minute=Math.floor(Date.now()/60000),now=new Date().toISOString()
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO cf_giving_fraud_events VALUES(?,?,?)').bind(attempt,campaignId,now),
  env.DB.prepare(`INSERT INTO cf_giving_attempt_windows SELECT ?,?,1,?,0,NULL WHERE changes()=1
   ON CONFLICT(campaign_id) DO UPDATE SET
   attempts=CASE WHEN minute=excluded.minute THEN attempts+1 ELSE 1 END,
   failures=CASE WHEN minute=excluded.minute THEN failures+excluded.failures ELSE excluded.failures END,minute=excluded.minute`).bind(campaignId,minute,Number(failed)),
  env.DB.prepare('UPDATE cf_giving_attempt_windows SET paused=1,alerted_at=COALESCE(alerted_at,?) WHERE campaign_id=? AND failures>=10 AND failures*2>=attempts').bind(now,campaignId),
 ])
}
export async function invoiceProtection(env: GivingEnv, invoice: Row, subscriptionId: string) {
 const failed=invoice.status==='open'
 if(invoice.currency!=='usd'||!(failed||invoice.status==='paid'&&invoice.amount_paid>0)||!Number.isSafeInteger(invoice.attempt_count)||invoice.attempt_count<1)return
 const customer=typeof invoice.customer==='string'?invoice.customer:invoice.customer?.id
 if(!customer)return
 const subscription=await stripe(env,'/subscriptions/'+encodeURIComponent(subscriptionId))
 if((typeof subscription.customer==='string'?subscription.customer:subscription.customer?.id)!==customer)return
 // Look up an existing association without creating a donor for a failed gift.
 const intent=await one({db:env.DB},'SELECT campaign_id,staff_channel FROM cf_giving_intents WHERE id=? AND customer_id=?',subscription.metadata?.coffer_intent??'',customer)
 if(intent?.staff_channel)return
 const saved=intent??await one({db:env.DB},'SELECT campaign_id FROM cf_subscriptions WHERE id=? AND customer_id=?',subscriptionId,customer)
 if(saved)await providerFailure(env,saved.campaign_id,'invoice:'+invoice.id+':'+invoice.attempt_count,failed)
}
export async function radarFailure(env: GivingEnv,event: Row) {
 if(!['charge.failed','payment_intent.payment_failed'].includes(event.type))return
 if(!await one({db:env.DB},'SELECT id FROM cf_giving_intents WHERE customer_id IS NOT NULL LIMIT 1'))return
 const charge=event.type==='charge.failed'
 const object=await stripe(env,(charge?'/charges/':'/payment_intents/')+encodeURIComponent(event.data.object.id))
 if(charge?object.status!=='failed'||object.paid===true:!object.last_payment_error||!['requires_payment_method','canceled'].includes(object.status))return
 const intentId=object.metadata?.coffer_intent??object.last_payment_error?.payment_intent?.metadata?.coffer_intent
 if(!intentId)return
 const customer=typeof object.customer==='string'?object.customer:object.customer?.id
 if(!customer)return
 const saved=await one({db:env.DB},'SELECT campaign_id,staff_channel FROM cf_giving_intents WHERE id=? AND customer_id=?',intentId,customer)
 if(!saved||saved.staff_channel)return
 const payment=charge?object.payment_intent:object.id
 const paymentId=typeof payment==='string'?payment:payment?.id
 const failedCharge=charge?object.id:object.last_payment_error?.charge
 const chargeId=typeof failedCharge==='string'?failedCharge:failedCharge?.id
 // A charge identifies a particular retry; the payment intent may be reused.
 await providerFailure(env,saved.campaign_id,chargeId?'charge:'+chargeId:'payment:'+paymentId+':'+event.id)
}

export async function checkoutFailure(env: GivingEnv, sessionId: string) {
 const saved=await one({db:env.DB},'SELECT campaign_id,customer_id FROM cf_giving_intents WHERE session_id=?',sessionId)
 if(!saved)return
 const session=await stripe(env,'/checkout/sessions/'+encodeURIComponent(sessionId))
 const customer=typeof session.customer==='string'?session.customer:session.customer?.id
 if(session.id!==sessionId||session.currency!=='usd'||session.payment_status!=='unpaid'||customer!==saved.customer_id)return
 await providerFailure(env,saved.campaign_id,'checkout:'+sessionId)
}

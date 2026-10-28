import { enqueueAutomaticReceipt } from './automatic-receipt-queue'
import { sendOnlineReceipt } from './giving/online-receipt'
import { fail, newId, one, today } from './db'
import { stripe, available, type GivingEnv } from './giving/stripe'
import { settings } from './settings'
import { runGiftRules } from './gift-rules'

const encoder=new TextEncoder()
async function signature(env: GivingEnv, value:string) {
 const key=await crypto.subtle.importKey('raw',encoder.encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('')
}
export async function pledgePaymentLink(env: GivingEnv|undefined, installmentId:string, at=new Date()) {
 if(!env||!available(env))return null
 const expires=Math.floor(at.getTime()/1000)+30*86400,value=installmentId+':'+expires
 return env.AUTH_ORIGIN+'/giving/pledge/'+encodeURIComponent(installmentId)+'?expires='+expires+'&token='+await signature(env,value)
}
async function payable(env: GivingEnv, installmentId:string) {
 return one({db:env.DB},`SELECT i.*,p.donor_id,p.fund,d.erased_at FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id
  WHERE i.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`,installmentId)
}
export async function validatePledgeLink(env: GivingEnv,id:string,url:URL) {
 const expires=url.searchParams.get('expires')??'',token=url.searchParams.get('token')??''
 if(!/^\d+$/.test(expires)||Number(expires)<Date.now()/1000||token.length!==64)fail('not_found','This payment link is unavailable. Ask for a current invoice.',404)
 const expected=await signature(env,id+':'+expires)
 let difference=0;for(let n=0;n<64;n++)difference|=token.charCodeAt(n)^expected.charCodeAt(n)
 if(difference)fail('not_found','This payment link is unavailable. Ask for a current invoice.',404)
 const i=await payable(env,id)
 if(!i)fail('not_found','This payment link is unavailable.',404)
 return i
}
export async function startPledgeCheckout(env: GivingEnv,id:string,url:URL) {
 const i=await validatePledgeLink(env,id,url),amount=i.amount_cents-i.paid_cents
 if(amount<=0)fail('pledge_paid','This installment has no unpaid balance.',409)
 // Reuse one current open checkout. Provider idempotency also fences retries.
 let saved=await one({db:env.DB},"SELECT * FROM cf_pledge_checkouts WHERE installment_id=? AND status='open'",id)
 if(saved&&saved.amount_cents!==amount){
  if(saved.session_id){
   const previous=await stripe(env,'/checkout/sessions/'+encodeURIComponent(saved.session_id))
   if(previous.status==='complete'){await completePledgeCheckout(env,saved.session_id);fail('balance_changed','A payment completed. Reopen the installment link.',409)}
   if(previous.status==='open')await stripe(env,'/checkout/sessions/'+encodeURIComponent(saved.session_id)+'/expire',{})
  }
  await env.DB.prepare("UPDATE cf_pledge_checkouts SET status='expired' WHERE id=? AND status='open'").bind(saved.id).run();saved=null
 }
 if(!saved){
  await env.DB.prepare('INSERT OR IGNORE INTO cf_pledge_checkouts(id,installment_id,amount_cents,created_at) VALUES(?,?,?,?)').bind(newId(),id,amount,new Date().toISOString()).run()
  saved=await one({db:env.DB},"SELECT * FROM cf_pledge_checkouts WHERE installment_id=? AND status='open'",id)
 }
 if(!saved||saved.amount_cents!==amount)fail('balance_changed','The installment balance changed. Reopen the link.',409)
 const session=saved!.session_id?await stripe(env,'/checkout/sessions/'+encodeURIComponent(saved!.session_id)):await stripe(env,'/checkout/sessions',{
  mode:'payment','allowed_payment_method_types[0]':'card','allowed_payment_method_types[1]':'link','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':amount,'line_items[0][price_data][product_data][name]':'Pledge installment · '+i.fund,'line_items[0][quantity]':1,
  'metadata[coffer_pledge_checkout]':saved!.id,'payment_intent_data[metadata][coffer_pledge_checkout]':saved!.id,
  success_url:env.AUTH_ORIGIN+'/giving/pledge/thanks?session_id={CHECKOUT_SESSION_ID}',cancel_url:url.href,
 },'pledge-checkout-'+saved!.id)
 if(session.status==='expired'){await env.DB.prepare("UPDATE cf_pledge_checkouts SET status='expired' WHERE id=?").bind(saved!.id).run();fail('checkout_expired','That checkout expired. Open the installment link again.',409)}
 if(session.status==='complete'){await completePledgeCheckout(env,session.id);fail('balance_changed','Payment completed. Reopen the installment link.',409)}
 if(typeof session.id!=='string'||typeof session.url!=='string'||new URL(session.url).origin!=='https://checkout.stripe.com')fail('checkout_unavailable','Stripe checkout is unavailable.',502)
 await env.DB.prepare('UPDATE cf_pledge_checkouts SET session_id=? WHERE id=? AND session_id IS NULL').bind(session.id,saved!.id).run()
 return session.url as string
}

/** Verify provider money, then atomically record one gift and its allocation. */
export async function completePledgeCheckout(env: GivingEnv,sessionId:string) {
 const c={db:env.DB},saved=await one(c,'SELECT * FROM cf_pledge_checkouts WHERE session_id=?',sessionId)
 if(!saved)return null
 const session=await stripe(env,'/checkout/sessions/'+encodeURIComponent(sessionId))
 if(session.id!==sessionId||session.metadata?.coffer_pledge_checkout!==saved.id||session.currency!=='usd'||session.amount_total!==saved.amount_cents)fail('invalid_payment','Stripe returned a different pledge checkout.',409)
 if(session.status!=='complete'||session.payment_status!=='paid')return {paid:false}
 const pi=await stripe(env,'/payment_intents/'+encodeURIComponent(session.payment_intent))
 if(pi.id!==session.payment_intent||pi.status!=='succeeded'||pi.currency!=='usd'||pi.amount_received!==saved.amount_cents||pi.metadata?.coffer_pledge_checkout!==saved.id)fail('invalid_payment','Stripe has not confirmed this installment payment.',409)
 const i=await payable(env,saved.installment_id)
 if(!i)fail('donor_unavailable','This pledge record is no longer available. Ask the organization to reconcile the payment.',409)
 const giftId='giving-'+pi.id,now=new Date().toISOString(),on=today((await settings(c)).timezone,new Date(pi.created*1000))
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO cf_gifts(id,version,donor_id,kind,received_on,amount_cents,method,reference,fund,goods,goods_cents,source,created_at,created_by)
   VALUES(?,1,?,'gift',?,?,'card',?,?,'none',0,'stripe',?,'Stripe')`).bind(giftId,i.donor_id,on,saved.amount_cents,pi.id,i.fund,now),
  env.DB.prepare('INSERT OR IGNORE INTO cf_campaign_gifts(gift_id,campaign_id) SELECT ?,campaign_id FROM cf_pledges WHERE id=? AND campaign_id IS NOT NULL').bind(giftId,i.pledge_id),
  env.DB.prepare(`INSERT OR IGNORE INTO cf_pledge_allocations(id,installment_id,gift_id,amount_cents,created_at,created_by)
   SELECT ?,i.id,?,MIN(?,i.amount_cents-i.paid_cents),?,'Stripe' FROM cf_pledge_balances i WHERE i.id=? AND i.amount_cents>i.paid_cents
   AND NOT EXISTS(SELECT 1 FROM cf_pledge_allocations WHERE gift_id=?)`).bind(newId(),giftId,saved.amount_cents,now,i.id,giftId),
  env.DB.prepare("UPDATE cf_pledge_checkouts SET gift_id=?,payment_id=?,status='paid' WHERE id=?").bind(giftId,pi.id,saved.id),
  ...[enqueueAutomaticReceipt(giftId,'online',now)].map(s=>env.DB.prepare(s.sql).bind(...s.params)),
  env.DB.prepare(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,'stripe','Stripe','agent','pledge.paid','pledge',?,?,? WHERE NOT EXISTS(SELECT 1 FROM cf_events WHERE action='pledge.paid' AND json_extract(detail,'$.paymentId')=?)`).bind(now,i.pledge_id,i.donor_id,JSON.stringify({paymentId:pi.id,installmentId:i.id,amountCents:saved.amount_cents}),pi.id),
 ])
 await runGiftRules(env,giftId)
 await sendOnlineReceipt(env,giftId)
 return {paid:true}
}
export async function pledgeSessionForCharge(env: GivingEnv,checkoutId:string) {
 const saved=await one({db:env.DB},'SELECT session_id FROM cf_pledge_checkouts WHERE id=?',checkoutId)
 if(saved?.session_id)await completePledgeCheckout(env,saved.session_id)
}

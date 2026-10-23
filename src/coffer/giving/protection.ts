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
 if(!config)return // Existing installations retain checkout until protection is connected.
 const token=p['cf-turnstile-response']
 let valid=false
 if(typeof token==='string'&&token.length>0&&token.length<=2048)try {
  const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:config.secret,response:token,remoteip:ip}),redirect:'manual',signal:AbortSignal.timeout(10000)})
  const result=await response.json() as Row
  valid=response.ok&&result.success===true&&result.hostname===new URL(env.AUTH_ORIGIN).hostname&&result.action==='giving'
 }catch{/* Unavailable verification never permits checkout. */}
 if(!valid){await failedAttempt(env,campaignId);fail('challenge_required','Complete the security check before giving.',403)}
}
export async function radarFailure(env: GivingEnv,event: Row) {
 if(!['charge.failed','payment_intent.payment_failed'].includes(event.type))return
 if(!await one({db:env.DB},'SELECT id FROM cf_giving_intents WHERE customer_id IS NOT NULL LIMIT 1'))return
 const object=await stripe(env,(event.type==='charge.failed'?'/charges/':'/payment_intents/')+encodeURIComponent(event.data.object.id))
 const intentId=object.metadata?.coffer_intent??object.last_payment_error?.payment_intent?.metadata?.coffer_intent
 if(!intentId)return
 const saved=await one({db:env.DB},'SELECT campaign_id FROM cf_giving_intents WHERE id=?',intentId)
 if(!saved)return
 const claimed=await env.DB.prepare('INSERT OR IGNORE INTO cf_giving_fraud_events VALUES(?,?,?) RETURNING event_id').bind(event.id,saved.campaign_id,new Date().toISOString()).first()
 if(claimed)await failedAttempt(env,saved.campaign_id)
}

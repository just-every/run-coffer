import { smsConsentStatement } from './sms-permission'
import { all, choice, commit, date, event, fail, guard, id, integer, newId, one, sql, text, today, type Context, type Row, type Stmt } from './db'
import { settings } from './settings'
import { prepareSolicitationRun, solicitationAskStatements, solicitationRunGuards } from './solicitation'

type SmsEnv=Row & {DB:D1Database;TWILIO_ACCOUNT_SID?:string;TWILIO_AUTH_TOKEN?:string;TWILIO_FROM?:string}
const managers=(c:Context)=>{if(!['owner','admin'].includes(c.actor.role))fail('FORBIDDEN','Only an owner or admin prepares, approves and sends texts.',403)}
const live=(donorId:string)=>guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL AND d.constituent_status='active' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`,'DONOR_CHANGED','This donor is no longer available for texts.',donorId)
const phone=(value:unknown)=>{const number=text(value,'Phone number',20);if(!/^\+[1-9]\d{7,14}$/.test(number))fail('INPUT','Use the complete phone number with + and country code.',400);return number}
function zone(value:unknown){const timezone=text(value,'Donor time zone',100);try{new Intl.DateTimeFormat('en',{timeZone:timezone})}catch{fail('INPUT','Choose a valid donor time zone, such as America/New_York.',400)}return timezone}
function quiet(timezone:string,at:string){const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'}).format(new Date(at)));return hour<8||hour>=21}
const latest=`(SELECT MAX(id) FROM cf_sms_preferences WHERE donor_id=?)`
const unpaidPledge=`EXISTS(SELECT 1 FROM cf_pledges p JOIN cf_pledge_balances i ON i.pledge_id=p.id WHERE p.donor_id=? AND i.amount_cents>i.paid_cents)`
const pledgeEligibility=(purpose:string,donorId:string):Stmt[]=>purpose==='pledge-reminder'?[guard(unpaidPledge,'PLEDGE_CHANGED','This donor has no unpaid pledge installment to remind them about.',donorId)]:[]
export async function smsPreference(c:Pick<Context,'db'>,donorId:string):Promise<Row|null>{
 const row=await one(c,"SELECT p.*,(SELECT status FROM cf_consents WHERE donor_id=p.donor_id AND channel='sms' ORDER BY id DESC LIMIT 1) AS current_channel_status FROM cf_sms_preferences p WHERE donor_id=? ORDER BY id DESC LIMIT 1",donorId)
 return row?{...row,status:row.current_channel_status??row.status}:null
}
export const smsPreferenceHistory=(c:Pick<Context,'db'>,donorId:string)=>all(c,'SELECT * FROM cf_sms_preferences WHERE donor_id=? OR donor_id IN (SELECT donor_id FROM cf_donor_merges WHERE into_id=?) ORDER BY id DESC',donorId,donorId)
export async function smsState(c:Context,runId?:string):Promise<Row>{
 const runs=await all(c,'SELECT * FROM cf_sms_runs ORDER BY prepared_at DESC,id')
 if(!runId)return {runs:runs.map(r=>({...r,excluded:JSON.parse(r.excluded)})),donors:await all(c,"SELECT id,name,phone FROM cf_donors d WHERE erased_at IS NULL AND constituent_status='active' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) ORDER BY name")}
 const run=runs.find(r=>r.id===runId);if(!run)fail('NOT_FOUND','Text run not found.',404)
 const excluded=JSON.parse(run.excluded) as Row[],names=new Map((await all(c,'SELECT id,name FROM cf_donors WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify(excluded.map(r=>r.donorId)))).map(d=>[d.id,d.name]))
 return {run:{...run,excluded:excluded.map(r=>({...r,name:names.get(r.donorId)??'Unavailable donor'}))},recipients:await all(c,'SELECT r.*,d.name FROM cf_sms_recipients r JOIN cf_donors d ON d.id=r.donor_id WHERE run_id=? ORDER BY d.name',runId)}
}
const eligibility=(r:Row):Stmt[]=>[live(r.donor_id),guard(`EXISTS(SELECT 1 FROM cf_sms_preferences WHERE id=? AND id=${latest} AND status='granted' AND phone=? AND timezone=? AND (SELECT status FROM cf_consents WHERE donor_id=cf_sms_preferences.donor_id AND channel='sms' ORDER BY id DESC LIMIT 1)='granted') AND EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND phone=?)`,'SMS_CONSENT_CHANGED','The frozen phone, consent or donor changed. Prepare a new text run.',r.preference_id,r.donor_id,r.phone,r.timezone,r.donor_id,r.donor_version,r.phone)]
// Keep solicitation integration here: the host can replace these wrappers with
// statement-returning variants without changing the Twilio submission path.
const freezeRestrictions=(c:Context,runId:string,isAsk:boolean,donorIds:string[],includes?:{donorId:string;reason:string}[])=>prepareSolicitationRun(c,{kind:'sms',id:runId,channel:'sms',isAsk,donorIds,includes})
const restrictionGuards=(c:Context,runId:string,donorIds?:string[])=>solicitationRunGuards(c,'sms',runId,donorIds)
const askSubmission=(c:Context,runId:string,donorId:string)=>solicitationAskStatements(c,'sms',runId,[donorId])

export async function smsCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(!['sms.preference','sms.prepare','sms.approve','sms.send','sms.discard'].includes(command))return undefined
 if(command==='sms.preference'){
  if(!['owner','admin','member'].includes(c.actor.role))fail('FORBIDDEN','A staff person must record SMS permission.',403)
  const donorId=id(p.donorId,'Donor'),status=choice(p.status,['granted','withdrawn'] as const,'SMS permission'),number=phone(p.phone),timezone=zone(p.timezone)
  const evidence=text(p.evidence,'Permission evidence',1000),capturedOn=date(p.capturedOn??today((await settings(c)).timezone,new Date(c.now)),'Permission date'),version=integer(Number(p.version??0),'Permission version',0)
  if(capturedOn>today((await settings(c)).timezone,new Date(c.now)))fail('INPUT','Permission cannot be dated in the future.',400)
  await commit(c,[guard(`COALESCE(${latest},0)=?`,'VERSION','SMS permission changed. Refresh before saving.',donorId,version),
   guard('EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.phone=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))','PHONE_CHANGED','Save this phone number on the current donor first.',donorId,number),
   sql("INSERT INTO cf_sms_preferences(donor_id,status,phone,timezone,source,evidence,captured_on,recorded_at,recorded_by) VALUES(?,?,?,?,'person',?,?,?,?)",donorId,status,number,timezone,evidence,capturedOn,c.now,c.actor.name),
   smsConsentStatement(donorId,evidence,c.now),
   event(c,command,'donor',donorId,donorId,{status,timezone,source:'person',capturedOn}),
  ]);return {donorId,preference:await smsPreference(c,donorId)}
 }
 managers(c)
 if(command==='sms.prepare'){
  const runId=newId(),name=text(p.name,'Text run name',150),purpose=choice(p.purpose,['appeal','thank-you','pledge-reminder'] as const,'text purpose'),body=text(p.body,'Text message',1600)
  if(typeof p.donorIds==='string')p.donorIds=p.donorIds.split(',').map((s:string)=>s.trim()).filter(Boolean)
  if(!Array.isArray(p.donorIds)||!p.donorIds.length||p.donorIds.length>200)fail('INPUT','Choose between 1 and 200 donors for this text run.',400)
  const donorIds=[...new Set(p.donorIds.map((d:unknown)=>id(d,'Donor')))],candidates:Row[]=[],excluded:Row[]=[]
  for(const donorId of donorIds){
   const d=await one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id)',donorId),pref=await smsPreference(c,donorId)
   let reason=!d?'unavailable donor':d.constituent_status!=='active'?d.constituent_status:!d.phone?'no phone':!/^\+[1-9]\d{7,14}$/.test(d.phone)?'invalid phone':!pref?'no SMS consent recorded':pref.status!=='granted'?'SMS consent withdrawn':pref.phone!==d.phone?'phone changed':null
   if(purpose==='pledge-reminder'&&d&&!await one(c,`SELECT 1 AS ok WHERE ${unpaidPledge}`,donorId))reason='no unpaid donor pledge'
   if(reason)excluded.push({donorId,reason});else candidates.push({...d,preference:pref})
  }
  const classification=await freezeRestrictions(c,runId,purpose==='appeal',candidates.map(d=>d.id),p.includes)
  excluded.push(...classification.excluded)
  const accepted=new Set(classification.recipients.map((r:Row)=>r.donor_id)),recipients=candidates.filter(d=>accepted.has(d.id))
  await commit(c,[...classification.statements,sql("INSERT INTO cf_sms_runs VALUES(?,1,?,?,?,'prepared',?,?,?,NULL,NULL)",runId,name,purpose,body,JSON.stringify(excluded),c.now,c.actor.name),
   ...recipients.flatMap(d=>{const r={donor_id:d.id,preference_id:d.preference.id,phone:d.phone,timezone:d.preference.timezone,donor_version:d.version};return [...eligibility(r),...pledgeEligibility(purpose,d.id),sql("INSERT INTO cf_sms_recipients(run_id,donor_id,phone,timezone,preference_id,donor_version,state,claimed_at,provider_id,provider_status,phone_contact_id,phone_contact_version) VALUES(?,?,?,?,?,?,'pending',NULL,NULL,NULL,(SELECT id FROM cf_contact_points WHERE donor_id=? AND kind='phone' AND active=1 AND is_primary=1),(SELECT version FROM cf_contact_points WHERE donor_id=? AND kind='phone' AND active=1 AND is_primary=1))",runId,d.id,d.phone,d.preference.timezone,d.preference.id,d.version,d.id,d.id)]}),
   event(c,command,'sms',runId,null,{purpose,recipients:recipients.length,excluded}),
  ]);return {id:runId,version:1,recipients:recipients.length,excluded}
 }
 const runId=id(p.runId,'Text run'),version=integer(Number(p.version),'Text run version',1),state=await smsState(c,runId),run=state.run,recipients=state.recipients as Row[]
 if(command==='sms.discard') {
  await commit(c,[guard("EXISTS(SELECT 1 FROM cf_sms_runs WHERE id=? AND version=? AND state IN ('prepared','approved')) AND NOT EXISTS(SELECT 1 FROM cf_sms_recipients WHERE run_id=? AND state IN ('submitting','submitted','uncertain'))",'SMS_ALREADY_SUBMITTED','Only a run with no submitted or uncertain texts may be discarded.',runId,version,runId),sql("UPDATE cf_sms_runs SET state='discarded',version=version+1 WHERE id=?",runId),event(c,command,'sms',runId,null,{})]);return {id:runId,version:version+1,state:'discarded'}
 }
 if(['redacted','discarded'].includes(run.state))fail('REDACTED','This text run was redacted after erasure and cannot be sent. Prepare a new run.',409)
 const runGuard=guard('EXISTS(SELECT 1 FROM cf_sms_runs WHERE id=? AND version=? AND state=?)','VERSION','This text run changed. Refresh before continuing.',runId,version,command==='sms.approve'?'prepared':'approved')
 if(command==='sms.approve'){
  await commit(c,[runGuard,...recipients.flatMap(r=>[...eligibility(r),...pledgeEligibility(run.purpose,r.donor_id)]),...await restrictionGuards(c,runId),sql("UPDATE cf_sms_runs SET state='approved',version=version+1,approved_at=?,approved_by=? WHERE id=?",c.now,c.actor.name,runId),event(c,command,'sms',runId,null,{purpose:run.purpose,recipients:recipients.length})])
  return {id:runId,version:version+1,state:'approved'}
 }
 const env=c.env as unknown as SmsEnv
 if(!env?.TWILIO_ACCOUNT_SID||!env.TWILIO_AUTH_TOKEN||!env.TWILIO_FROM)fail('SMS_UNAVAILABLE','Configure Twilio account, auth token and registered sender before sending texts.',409)
 const from=phone(env.TWILIO_FROM),result:Row={id:runId,submitted:0,held:0,uncertain:0,failed:0}
 for(const r of recipients){
  if(!['pending','held'].includes(r.state))continue
  if(quiet(r.timezone,c.now)){await commit(c,[runGuard,sql("UPDATE cf_sms_recipients SET state='held' WHERE run_id=? AND donor_id=? AND state IN ('pending','held')",runId,r.donor_id)]);result.held++;continue}
  // Claim once in the same transaction as permission/limit checks and the ask
  // ledger. A crash leaves 'submitting': uncertain, never automatically retried.
  await commit(c,[runGuard,...eligibility(r),...pledgeEligibility(run.purpose,r.donor_id),...await askSubmission(c,runId,r.donor_id),guard("EXISTS(SELECT 1 FROM cf_sms_recipients WHERE run_id=? AND donor_id=? AND state IN ('pending','held'))",'SMS_CLAIMED','Another sender already claimed this text.',runId,r.donor_id),sql("UPDATE cf_sms_recipients SET state='submitting',claimed_at=? WHERE run_id=? AND donor_id=?",c.now,runId,r.donor_id),event(c,'sms.claim','sms',runId,r.donor_id,{purpose:run.purpose})])
  let outcome='uncertain',providerId:string|null=null,providerStatus:string|null=null
  try{
   const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`,{method:'POST',headers:{authorization:'Basic '+btoa(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:r.phone,From:from,Body:run.body})})
   const value=await response.json() as Row
   if(response.ok&&typeof value.sid==='string'&&['accepted','queued','sending','sent','delivered'].includes(value.status)){outcome='submitted';providerId=value.sid;providerStatus=value.status}
   else if(response.status>=400&&response.status<500){outcome='failed';providerStatus='rejected'}
  }catch{/* An unknown network/provider outcome is held for human reconciliation. */}
  await commit(c,[sql('UPDATE cf_sms_recipients SET state=?,provider_id=?,provider_status=? WHERE run_id=? AND donor_id=? AND state=\'submitting\'',outcome,providerId,providerStatus,runId,r.donor_id),event(c,'sms.'+outcome,'sms',runId,r.donor_id,{providerStatus})])
  if(outcome==='failed')await commit(c,[sql('DELETE FROM cf_solicitation_asks WHERE kind=? AND run_id=? AND donor_id=?','sms',runId,r.donor_id)])
  result[outcome]++
 }
 return result
}

/** Signed form POST only. URL includes the exact configured path and query.
 * Twilio algorithm: https://www.twilio.com/docs/usage/security */
export async function smsWebhook(request:Request,env:SmsEnv,at=new Date().toISOString()):Promise<Response>{
 if(request.method!=='POST'||!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return new Response('Form POST required',{status:415})
 if(!env.TWILIO_AUTH_TOKEN||!env.TWILIO_ACCOUNT_SID||!env.TWILIO_FROM)return new Response('SMS unavailable',{status:503})
 const raw=await request.text();if(raw.length>16384)return new Response('Too large',{status:413})
 const fields=new URLSearchParams(raw),keys=[...new Set(fields.keys())].sort()
 if(keys.some(k=>fields.getAll(k).length!==1))return new Response('Duplicate parameter',{status:400})
 const payload=request.url+keys.map(k=>k+fields.get(k)).join(''),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.TWILIO_AUTH_TOKEN),{name:'HMAC',hash:'SHA-1'},false,['sign'])
 const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))))),received=request.headers.get('x-twilio-signature')??''
 let difference=signature.length^received.length;for(let i=0;i<signature.length;i++)difference|=signature.charCodeAt(i)^(received.charCodeAt(i)||0)
 if(difference||fields.get('AccountSid')!==env.TWILIO_ACCOUNT_SID||fields.get('To')!==env.TWILIO_FROM)return new Response('Invalid signature',{status:403})
 const messageId=fields.get('MessageSid'),from=fields.get('From'),isStop=/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/i.test((fields.get('Body')??'').trim())
 if(!messageId||!from)return new Response('Missing message identity',{status:400})
 if(!isStop)return new Response('<Response/>',{headers:{'content-type':'text/xml'}})
 const c:Context={db:env.DB,env:env as any,now:at,actor:{id:'twilio-stop',name:'Twilio STOP',role:'owner'},authority:{sql:'1',params:[]}}
 const donors=await all(c,`SELECT p.* FROM cf_sms_preferences p JOIN cf_donors d ON d.id=p.donor_id WHERE p.phone=? AND p.id=(SELECT MAX(id) FROM cf_sms_preferences WHERE donor_id=p.donor_id) AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`,from)
 // Replay-safe: each insert/event is conditioned on absence of the receipt;
 // the receipt is the last statement in this same atomic transaction.
 const day=today((await settings(c)).timezone,new Date(at))
 await commit(c,[...donors.flatMap(d=>[
  sql("INSERT INTO cf_sms_preferences(donor_id,status,phone,timezone,source,evidence,captured_on,recorded_at,recorded_by) SELECT ?,'withdrawn',?,?,'twilio-stop',?,?,?,'Twilio STOP' WHERE NOT EXISTS(SELECT 1 FROM cf_sms_inbound WHERE message_id=?)",d.donor_id,from,d.timezone,messageId,day,at,messageId),
  smsConsentStatement(d.donor_id,messageId,at,messageId),
  sql("INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) SELECT ?,'twilio-stop','Twilio STOP','owner','sms.stop','donor',?,?,? WHERE NOT EXISTS(SELECT 1 FROM cf_sms_inbound WHERE message_id=?)",at,d.donor_id,d.donor_id,JSON.stringify({source:'twilio-stop',messageId}),messageId),
 ]),sql('INSERT OR IGNORE INTO cf_sms_inbound VALUES(?,?)',messageId,at)])
 return new Response('<Response/>',{headers:{'content-type':'text/xml'}})
}

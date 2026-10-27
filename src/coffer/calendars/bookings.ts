import { requireRole } from '../auth'
import { commit, event, fail, guard, id, newId, one, sha256, sql, text, today, type Context, type Row } from '../db'
import { givingConnection, openGiving, sealGiving } from '../giving/connections'
import type { GivingEnv } from '../giving/stripe'
import type { Bindings } from '../../auth.server'
import { settings } from '../settings'

const NAME='meeting-calendly'
const staff=(c:Context)=>requireRole(c.actor,['owner','admin','member'],'share meeting links')
const saved=(c:Context)=>one(c,'SELECT sealed FROM cf_giving_connections WHERE name=?',NAME)
const approved=(config:Row)=>guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active' AND role IN ('owner','admin'))",'BOOKING_APPROVAL','An owner or admin must approve this booking connection again.',config.approvedBy,config.approverVersion)
export async function bookingState(c:Context) {
 staff(c)
 const config=await givingConnection(c.env as GivingEnv,NAME)
 return {configured:!!config,bookingUrl:config?.bookingUrl??null,endpoint:new URL('/api/coffer/calendar/bookings',c.env!.AUTH_ORIGIN).href}
}
function calendlyUrl(value:unknown,kind:'link'|'type') {
 let url:URL
 try {url=new URL(text(value,kind==='link'?'Calendly scheduling link':'Calendly event type URI',1000))}catch{return fail('INPUT','Use a complete Calendly HTTPS URL.',400)}
 const host=kind==='link'?'calendly.com':'api.calendly.com'
 if(url.protocol!=='https:'||url.hostname!==host||url.port||url.username||url.password||url.search||url.hash||(kind==='type'?!/^\/event_types\/[A-Za-z0-9_-]+$/.test(url.pathname):!/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)))fail('INPUT','Use the exact Calendly scheduling link or event type URI without query parameters.',400)
 return url.href
}
export async function bookingCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(!['booking.configure','booking.disconnect','booking.link','booking.revoke'].includes(command))return undefined
 staff(c)
 if(command==='booking.configure'||command==='booking.disconnect') {
  requireRole(c.actor,['owner','admin'],'configure booking intake')
  if(command==='booking.disconnect') {
   await commit(c,[sql('DELETE FROM cf_giving_connections WHERE name=?',NAME),sql('UPDATE cf_meeting_links SET revoked_at=? WHERE revoked_at IS NULL',c.now),event(c,command,'settings',NAME,null)])
   return {configured:false}
  }
  if(p.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Approve signed booking intake before saving.',400)
  const config={bookingUrl:calendlyUrl(p.bookingUrl,'link'),eventType:calendlyUrl(p.eventType,'type'),secret:text(p.signingKey,'Calendly webhook signing key',4000),approvedBy:c.actor.id,approverVersion:(await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id))!.version}
  const sealed=await sealGiving(c.env as GivingEnv,config)
  await commit(c,[sql('INSERT INTO cf_giving_connections VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET sealed=excluded.sealed,updated_at=excluded.updated_at',NAME,sealed,c.now),sql('UPDATE cf_meeting_links SET revoked_at=? WHERE revoked_at IS NULL',c.now),event(c,command,'settings',NAME,null,{explicitApproval:true,localRecordsOnly:true})])
  return {configured:true}
 }
 const donorId=id(p.donorId,'Donor')
 if(command==='booking.revoke') {
  const linkId=id(p.id,'Booking link')
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_meeting_links WHERE id=? AND donor_id=? AND operator_id=?)','BOOKING_LINK','Choose your own booking link.',linkId,donorId,c.actor.id),sql('UPDATE cf_meeting_links SET revoked_at=? WHERE id=?',c.now,linkId),event(c,command,'booking_link',linkId,donorId)])
  return {revoked:true}
 }
 if(p.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm this donor-specific booking link and its local preparation task.',400)
 const connection=await saved(c)
 if(!connection)fail('BOOKING_UNCONFIGURED','Ask an owner or admin to configure Calendly booking intake.',409)
 const config=await openGiving(c.env as GivingEnv,connection.sealed),token=newId()+newId(),key=newId(),expiresAt=new Date(Date.parse(c.now)+30*86400000).toISOString()
 const operator=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id)
 await commit(c,[approved(config),guard("EXISTS(SELECT 1 FROM cf_donors d WHERE id=? AND erased_at IS NULL AND constituent_status='active' AND email IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))",'DONOR_CHANGED','Choose an active donor with a primary email.',donorId),sql('INSERT INTO cf_meeting_links(id,donor_id,operator_id,operator_version,token_hash,sealed_token,connection_sealed,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',key,donorId,c.actor.id,operator!.version,await sha256(token),await sealGiving(c.env as GivingEnv,{token}),connection.sealed,expiresAt,c.now),event(c,command,'booking_link',key,donorId,{expiresAt,localRecordsOnly:true})])
 const url=new URL(config.bookingUrl);url.searchParams.set('utm_content',token)
 return {id:key,url:url.href,expiresAt}
}
export async function donorBookingLinks(c:Context,donorId:string) {
 staff(c)
 const rows=(await c.db.prepare("SELECT l.id,l.sealed_token,l.expires_at,g.sealed FROM cf_meeting_links l JOIN cf_giving_connections g ON g.name=? AND g.sealed=l.connection_sealed JOIN oa_operators o ON o.id=l.operator_id AND o.version=l.operator_version AND o.status='active' WHERE l.donor_id=? AND l.operator_id=? AND l.revoked_at IS NULL AND l.expires_at>? ORDER BY l.created_at DESC,l.id").bind(NAME,donorId,c.actor.id,c.now).all<Row>()).results
 return Promise.all(rows.map(async row=>{const config=await openGiving(c.env as GivingEnv,row.sealed),value=await openGiving(c.env as GivingEnv,row.sealed_token),url=new URL(config.bookingUrl);url.searchParams.set('utm_content',value.token);return {id:row.id,url:url.href,expiresAt:row.expires_at}}))
}
async function signature(raw:string,header:string|null,secret:string,now:string) {
 if(!header)return false
 const parts=header.split(',').map(v=>v.trim().split('=')),timestamps=parts.filter(v=>v[0]==='t')
 if(timestamps.length!==1||timestamps[0].length!==2||!/^\d+$/.test(timestamps[0][1]))return false
 const stamp=timestamps[0][1]
 if(!Number.isSafeInteger(Number(stamp))||Math.abs(Date.parse(now)/1000-Number(stamp))>180)return false
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify'])
 for(const [kind,value,extra] of parts)if(kind==='v1'&&!extra&&/^[a-fA-F0-9]{64}$/.test(value??'')) {
  const bytes=Uint8Array.from(value.match(/../g)!,v=>parseInt(v,16))
  if(await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(stamp+'.'+raw)))return true
 }
 return false
}
function instant(value:unknown) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail('BOOKING_TIME','Calendly did not supply a valid timed meeting.',400)
 return new Date(value).toISOString()
}
export async function bookingWebhook(request:Request,env:Bindings) {
 const headers={'content-type':'application/json','cache-control':'no-store'}
 try {
  if(request.method!=='POST')fail('METHOD','Use POST for a signed Calendly event.',405)
  const now=new Date().toISOString(),base={db:env.DB},connection=await one(base,'SELECT sealed FROM cf_giving_connections WHERE name=?',NAME)
  if(!connection)fail('BOOKING_UNCONFIGURED','Calendly booking intake is disconnected.',409)
  const config=await openGiving(env as GivingEnv,connection.sealed)
  const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let length=0
  if(!reader)fail('BOOKING_BODY','A signed booking body is required.',400)
  while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>65536){await reader.cancel();fail('BOOKING_SIZE','The booking event is too large.',413)}chunks.push(chunk.value)}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  const raw=new TextDecoder().decode(bytes)
  if(!await signature(raw,request.headers.get('Calendly-Webhook-Signature'),config.secret,now))fail('BOOKING_SIGNATURE','The Calendly signature is missing, expired or invalid.',400)
  let message:Row;try{message=JSON.parse(raw)}catch{return fail('BOOKING_BODY','The signed booking event is not JSON.',400)}
  if(!message||typeof message!=='object'||Array.isArray(message))fail('BOOKING_BODY','The signed booking event must be an object.',400)
  if(message.event!=='invitee.created')return new Response(JSON.stringify({ignored:true}),{headers})
  const p=message.payload,scheduled=p?.scheduled_event
  if(!p||!scheduled||p.status!=='active'||scheduled.status!=='active'||scheduled.event_type!==config.eventType)fail('BOOKING_EVENT','This event is not an active booking of the approved event type.',409)
  if(typeof scheduled.uri!=='string'||!/^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9_-]+$/.test(scheduled.uri)||p.event!==scheduled.uri||typeof p.uri!=='string'||!p.uri.startsWith(scheduled.uri+'/invitees/')||!/^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9_-]+\/invitees\/[A-Za-z0-9_-]+$/.test(p.uri))fail('BOOKING_EVENT','The booking references do not agree.',400)
  const token=text(p.tracking?.utm_content,'Donor booking reference',300),link=await one(base,'SELECT l.*,d.email,o.display_name,o.role FROM cf_meeting_links l JOIN cf_donors d ON d.id=l.donor_id JOIN oa_operators o ON o.id=l.operator_id WHERE l.token_hash=?',await sha256(token))
  if(!link||typeof p.email!=='string'||link.email?.toLowerCase()!==p.email.toLowerCase())fail('BOOKING_DONOR','The booking does not match an approved donor link and primary email.',409)
  const starts=instant(scheduled.start_time),ends=instant(scheduled.end_time)
  if(Date.parse(ends)<=Date.parse(starts))fail('BOOKING_TIME','The booking end must follow its start.',400)
  const meetingId=await sha256('calendly:'+p.uri),taskId=await sha256('preparation:'+meetingId),prepareAt=new Date(Date.parse(starts)-86400000).toISOString()
  const authority={sql:"EXISTS(SELECT 1 FROM cf_meeting_links l JOIN oa_operators o ON o.id=l.operator_id AND o.version=l.operator_version AND o.status='active' AND o.role IN ('owner','admin','member') JOIN cf_donors d ON d.id=l.donor_id AND d.erased_at IS NULL AND d.constituent_status='active' JOIN cf_giving_connections g ON g.name=? AND g.sealed=l.connection_sealed WHERE l.id=? AND l.revoked_at IS NULL AND l.expires_at>? AND g.sealed=? AND lower(d.email)=lower(?) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))",params:[NAME,link.id,now,connection.sealed,p.email]}
  const c:Context={db:env.DB,env,now,actor:{id:link.operator_id,name:link.display_name,role:link.role},authority}
  await commit(c,[approved(config)])
  const zone=(await settings(c)).timezone
  const existing=await one(c,'SELECT * FROM cf_donor_meetings WHERE id=?',meetingId)
  if(existing&&(existing.starts_at!==starts||existing.donor_id!==link.donor_id))fail('BOOKING_CHANGED','This booking was already recorded with different facts. Review it in Coffer.',409)
  await commit(c,[approved(config),guard('NOT EXISTS(SELECT 1 FROM cf_donor_meetings WHERE id=? AND (donor_id<>? OR starts_at<>?))','BOOKING_CHANGED','This booking was already recorded with different facts.',meetingId,link.donor_id,starts),sql("INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) SELECT ?,?,?,?,'booking.received','meeting',?,?,'{\"provider\":\"calendly\",\"localRecordsOnly\":true}' WHERE NOT EXISTS(SELECT 1 FROM cf_donor_meetings WHERE id=?)",now,c.actor.id,c.actor.name,c.actor.role,meetingId,link.donor_id,meetingId),sql("INSERT OR IGNORE INTO cf_donor_meetings(id,donor_id,starts_at,prepare_at,created_at,created_by,source,source_ref,source_operator_id) VALUES(?,?,?,?,?,?,'calendly',?,?)",meetingId,link.donor_id,starts,prepareAt,now,link.operator_id,p.uri,link.operator_id),sql("INSERT OR IGNORE INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask,task_kind) VALUES(?,?,?,'meeting','Prepare for donor meeting',0,?,?,?,0,'follow_up')",taskId,link.donor_id,'meeting:'+meetingId,link.operator_id,today(zone,new Date(prepareAt)),now)])
  return new Response(JSON.stringify({meetingId,taskId,duplicate:!!existing}),{headers})
 }catch(error){
  const {CofferError}=await import('../db')
  if(error instanceof CofferError)return new Response(JSON.stringify({error:error.code,message:error.message}),{status:error.status,headers})
  throw error
 }
}

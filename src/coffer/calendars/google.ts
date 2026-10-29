import { requireRole } from '../auth'
import { commit, event, fail, guard, id, newId, one, sha256, sql, text, type Context, type Row } from '../db'
import { givingConnection, openGiving, sealGiving } from '../giving/connections'
import type { GivingEnv } from '../giving/stripe'

const SCOPE='https://www.googleapis.com/auth/calendar.events.readonly'
const staff=(c:Context)=>requireRole(c.actor,['owner','admin','member'],'read your calendar')
const env=(c:Context)=>c.env as GivingEnv
const callback=(c:Context)=>new URL('/app/calendar/google/callback',c.env!.AUTH_ORIGIN).href
const connectionName=(c:Context)=>'calendar-google:'+c.actor.id
const saved=(c:Context,name:string)=>one(c,'SELECT sealed FROM cf_giving_connections WHERE name=?',name)
async function put(c:Context,name:string,value:Row) {
 return sql('INSERT INTO cf_giving_connections(name,sealed,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET sealed=excluded.sealed,updated_at=excluded.updated_at',name,await sealGiving(env(c),value),c.now)
}
async function provider(url:string,init:RequestInit):Promise<Row> {
 let response:Response
 try { response=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(15000)}) }
 catch { return fail('CALENDAR_UNREACHABLE','Google Calendar could not be reached. Try the connection again.',502) }
 if(!response.ok)fail('CALENDAR_REJECTED','Google refused the calendar request. Reconnect your calendar or check its permissions.',response.status===401||response.status===403?409:502)
 const value=await response.json().catch(()=>null)
 if(!value||typeof value!=='object'||Array.isArray(value))fail('CALENDAR_RESPONSE','Google returned an unreadable calendar response.',502)
 return value as Row
}
async function token(parameters:Row) {
 const result=await provider('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(parameters)})
 if(typeof result.access_token!=='string'||!result.access_token||result.token_type?.toLowerCase()!=='bearer')fail('CALENDAR_RESPONSE','Google did not supply a usable calendar token.',502)
 if(result.scope&&!String(result.scope).split(' ').includes(SCOPE))fail('CALENDAR_SCOPE','Google did not grant read access to calendar events.',409)
 return result
}
export async function calendarState(c:Context) {
 staff(c)
 const [app,connection]=await Promise.all([saved(c,'calendar-google-app'),givingConnection(env(c),connectionName(c))])
 const current=await one(c,"SELECT version FROM oa_operators WHERE id=? AND status='active'",c.actor.id)
 return {configured:!!app,connected:!!connection&&connection.operatorVersion===current?.version&&connection.appSealed===app?.sealed,callback:callback(c)}
}
export async function calendarCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(!['calendar.configure','calendar.start','calendar.disconnect','calendar.log'].includes(command))return undefined
 staff(c)
 if(command==='calendar.configure') {
  requireRole(c.actor,['owner','admin'],'configure the calendar application')
  if(p.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm the read-only calendar application.',400)
  const clientId=text(p.clientId,'Google client ID',1000),clientSecret=text(p.clientSecret,'Google client secret',4000)
  await commit(c,[await put(c,'calendar-google-app',{clientId,clientSecret}),sql('DELETE FROM cf_calendar_oauth'),sql("DELETE FROM cf_giving_connections WHERE name GLOB 'calendar-google:*'"),event(c,command,'settings','calendar-google',null,{readOnly:true})])
  return {configured:true}
 }
 if(command==='calendar.disconnect') {
  await commit(c,[sql('DELETE FROM cf_giving_connections WHERE name=?',connectionName(c)),sql('DELETE FROM cf_calendar_oauth WHERE operator_id=?',c.actor.id),event(c,command,'operator',c.actor.id,null)])
  return {connected:false}
 }
 if(command==='calendar.log')return logCalendarMeeting(c,p)
 if(p.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm access to your own calendar before continuing to Google.',400)
 const app=await saved(c,'calendar-google-app')
 if(!app)fail('CALENDAR_UNCONFIGURED','Ask an owner or admin to configure the Google application.',409)
 const details=await openGiving(env(c),app.sealed),state=newId()+newId(),operator=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id)
 await commit(c,[sql('INSERT INTO cf_calendar_oauth VALUES(?,?,?,?,?) ON CONFLICT(operator_id) DO UPDATE SET operator_version=excluded.operator_version,state_hash=excluded.state_hash,app_sealed=excluded.app_sealed,expires_at=excluded.expires_at',c.actor.id,operator!.version,await sha256(state),app.sealed,new Date(Date.parse(c.now)+600000).toISOString()),event(c,command,'operator',c.actor.id,null,{readOnly:true})])
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth')
 url.search=new URLSearchParams({client_id:details.clientId,redirect_uri:callback(c),response_type:'code',scope:SCOPE,state,access_type:'offline',prompt:'consent'}).toString()
 return {authorizeUrl:url.href}
}
export async function calendarCallback(c:Context,url:URL) {
 staff(c)
 const pending=await one(c,'SELECT * FROM cf_calendar_oauth WHERE operator_id=?',c.actor.id)
 const state=await sha256(text(url.searchParams.get('state'),'Calendar authorization state',300))
 if(!pending||pending.state_hash!==state)fail('CALENDAR_STATE','This calendar authorization does not belong to your session. Connect again.',409)
 const checks=[guard("EXISTS(SELECT 1 FROM cf_calendar_oauth s JOIN oa_operators o ON o.id=s.operator_id AND o.version=s.operator_version AND o.status='active' JOIN cf_giving_connections a ON a.name='calendar-google-app' AND a.sealed=s.app_sealed WHERE s.operator_id=? AND s.state_hash=? AND s.expires_at>?)",'CALENDAR_STATE','This calendar authorization expired or changed. Connect again.',c.actor.id,state,c.now)]
 // Consume the state before the network exchange; a callback is never replayable.
 await commit(c,[...checks,sql('DELETE FROM cf_calendar_oauth WHERE operator_id=?',c.actor.id)])
 if(url.searchParams.has('error'))fail('CALENDAR_DECLINED','Google Calendar access was not granted. You can connect again from Settings.',409)
 const app=await openGiving(env(c),pending.app_sealed),code=text(url.searchParams.get('code'),'Google authorization code',4000)
 await commit(c,[])
 const result=await token({grant_type:'authorization_code',code,client_id:app.clientId,client_secret:app.clientSecret,redirect_uri:callback(c)})
 if(typeof result.refresh_token!=='string'||!result.refresh_token)fail('CALENDAR_REFRESH','Google did not grant ongoing read access. Reconnect and approve the calendar permission.',409)
 await commit(c,[guard("EXISTS(SELECT 1 FROM cf_giving_connections WHERE name='calendar-google-app' AND sealed=?)",'CALENDAR_CHANGED','The calendar application changed. Connect again.',pending.app_sealed),await put(c,connectionName(c),{refreshToken:result.refresh_token,appSealed:pending.app_sealed,operatorVersion:pending.operator_version}),event(c,'calendar.connected','operator',c.actor.id,null,{provider:'google',readOnly:true})])
 return {connected:true}
}
async function access(c:Context) {
 staff(c)
 const connection=await saved(c,connectionName(c)),app=await saved(c,'calendar-google-app')
 if(!connection||!app)fail('CALENDAR_UNCONNECTED','Connect your Google Calendar in Settings first.',409)
 const details=await openGiving(env(c),connection.sealed),application=await openGiving(env(c),app.sealed)
 const checks=[guard("EXISTS(SELECT 1 FROM cf_giving_connections g JOIN oa_operators o ON o.id=? AND o.status='active' AND o.version=? WHERE g.name=? AND g.sealed=?) AND EXISTS(SELECT 1 FROM cf_giving_connections WHERE name='calendar-google-app' AND sealed=?)",'CALENDAR_CHANGED','Your calendar connection changed. Connect again.',c.actor.id,details.operatorVersion,connectionName(c),connection.sealed,details.appSealed)]
 await commit(c,checks)
 const result=await token({grant_type:'refresh_token',refresh_token:details.refreshToken,client_id:application.clientId,client_secret:application.clientSecret})
 return {token:result.access_token,checks}
}
export function calendarEvent(value:Row) {
 const start=value.start?.dateTime,end=value.end?.dateTime
 if(value.status==='cancelled'||typeof value.id!=='string'||!start||!end||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start))fail('CALENDAR_EVENT','Choose a current timed calendar event. All-day and cancelled entries cannot be logged.',409)
 return {id:text(value.id,'Calendar event',1000),summary:text(value.summary||'Calendar meeting','Calendar title',1000),startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString()}
}
export async function calendarEvents(c:Context,pageToken?:string) {
 const auth=await access(c),url=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
 url.search=new URLSearchParams({singleEvents:'true',orderBy:'startTime',maxResults:'50',timeMin:new Date(Date.parse(c.now)-30*86400000).toISOString(),timeMax:new Date(Date.parse(c.now)+90*86400000).toISOString(),fields:'items(id,summary,start,end,status),nextPageToken',...(pageToken?{pageToken:text(pageToken,'Calendar page',2000)}:{})}).toString()
 await commit(c,auth.checks)
 const result=await provider(url.href,{headers:{authorization:'Bearer '+auth.token}})
 if(!Array.isArray(result.items))fail('CALENDAR_RESPONSE','Google did not return a calendar event list.',502)
 await commit(c,auth.checks)
 return {events:result.items.filter((v:Row)=>v.status!=='cancelled'&&v.start?.dateTime&&v.end?.dateTime).map(calendarEvent),nextPageToken:result.nextPageToken??null}
}
async function logCalendarMeeting(c:Context,p:Row) {
 if(p.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm that this calendar meeting belongs on this donor record.',400)
 const donorId=id(p.donorId,'Donor'),eventId=text(p.eventId,'Calendar event',1000),auth=await access(c)
 await commit(c,auth.checks)
 const raw=await provider('https://www.googleapis.com/calendar/v3/calendars/primary/events/'+encodeURIComponent(eventId),{headers:{authorization:'Bearer '+auth.token}})
 const value=calendarEvent(raw)
 if(value.id!==eventId)fail('CALENDAR_EVENT','Google returned a different calendar event.',502)
 const key=await sha256('google:'+c.actor.id+':'+eventId),prepareAt=new Date(Date.parse(value.startsAt)-86400000).toISOString()
 const existing=await one(c,'SELECT * FROM cf_donor_meetings WHERE id=?',key)
 if(existing&&existing.donor_id!==donorId)fail('CALENDAR_LINKED','This calendar event is already linked to another donor.',409)
 if(existing&&existing.starts_at!==value.startsAt)fail('CALENDAR_CHANGED','This meeting was logged at a different time. Review the existing meeting before recording another.',409)
 await commit(c,[...auth.checks,guard('EXISTS(SELECT 1 FROM cf_donors d WHERE id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))','DONOR_CHANGED','Choose a current donor.',donorId),guard('NOT EXISTS(SELECT 1 FROM cf_donor_meetings WHERE id=? AND donor_id<>?)','CALENDAR_LINKED','This calendar event is already linked to another donor.',key,donorId),guard('NOT EXISTS(SELECT 1 FROM cf_donor_meetings WHERE id=? AND starts_at<>?)','CALENDAR_CHANGED','This meeting was logged at a different time.',key,value.startsAt),sql("INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) SELECT ?,?,?,?,'calendar.log','meeting',?,?,'{}' WHERE NOT EXISTS(SELECT 1 FROM cf_donor_meetings WHERE id=?)",c.now,c.actor.id,c.actor.name,c.actor.role,key,donorId,key),sql("INSERT OR IGNORE INTO cf_donor_meetings(id,donor_id,starts_at,prepare_at,created_at,created_by,source,source_ref,source_operator_id) VALUES(?,?,?,?,?,?,'google',?,?)",key,donorId,value.startsAt,prepareAt,c.now,c.actor.id,eventId,c.actor.id)])
 return {id:key,donorId,startsAt:value.startsAt,prepareAt,version:existing?.version??1}
}

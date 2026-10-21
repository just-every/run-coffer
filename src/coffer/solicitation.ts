import { all, choice, commit, date, event, fail, guard, id, integer, one, optional, sql, text, today, type Context, type Row, type Stmt } from './db'
import { settings } from './settings'

export const SOLICITATION_CHANNELS = ['email','mail','sms','phone'] as const
export type SolicitationChannel = typeof SOLICITATION_CHANNELS[number]
type ReadContext = Pick<Context,'db'>
export type SolicitationReason = { reason: 'do not solicit' | 'solicitation limit'; lastAskOn: string | null }
const currentVersion = `COALESCE((SELECT version FROM cf_solicitation WHERE donor_id=?),0)`
const assigned = `EXISTS(SELECT 1 FROM cf_portfolio_members m JOIN cf_portfolios p ON p.id=m.portfolio_id JOIN oa_operators o ON o.id=p.manager_id WHERE m.donor_id=? AND o.id=? AND o.status='active' AND o.role IN ('owner','admin','member'))`
const live = (donorId:string) => guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`,'DONOR_CHANGED','Choose a current donor.',donorId)
const versionGuard = (donorId:string,version:number) => guard(`${currentVersion}=?`,'SOLICITATION_CHANGED','The solicitation restriction changed. Prepare or refresh again.',donorId,version)
const staff = (c:Context) => { if(!['owner','admin','member'].includes(c.actor.role))fail('FORBIDDEN','A person must record solicitation choices.',403) }
async function calendarDay(c:ReadContext,at?:string) {
 if(at && /^\d{4}-\d{2}-\d{2}$/.test(at))return date(at,'Ask date')
 const instant=new Date(at??('now' in c ? String(c.now) : new Date().toISOString()))
 if(!Number.isFinite(instant.getTime()))fail('INPUT','Choose a valid ask date.',400)
 return today((await settings(c)).timezone,instant)
}

/** Array includes an explicit version-zero/none state for every requested ID. */
export async function solicitationState(c:ReadContext,donorIds:string[]):Promise<Row[]> {
 if(!donorIds.length)return []
 const rows=await all(c,'SELECT * FROM cf_solicitation WHERE donor_id IN (SELECT value FROM json_each(?))',JSON.stringify([...new Set(donorIds)]))
 const day=await calendarDay(c)
 return [...new Set(donorIds)].map(donorId=>{
  const row=rows.find(r=>r.donor_id===donorId)
  return row?{...row,asOf:day,channels:JSON.parse(row.channels),active:row.type!=='none'&&row.starts_on<=day&&(!row.ends_on||row.ends_on>=day)}:{donor_id:donorId,version:0,type:'none',channels:[],active:false,asOf:day}
 })
}

export async function solicitationReason(c:ReadContext,donorId:string,channel:SolicitationChannel,at?:string):Promise<SolicitationReason|null> {
 choice(channel,SOLICITATION_CHANNELS,'ask channel')
 const day=await calendarDay(c,at),r=await one(c,'SELECT * FROM cf_solicitation WHERE donor_id=?',donorId)
 if(!r||r.type==='none'||r.starts_on>day||(r.ends_on&&r.ends_on<day))return null
 const last=await one(c,'SELECT MAX(asked_on) AS last FROM cf_solicitation_asks WHERE donor_id=? AND asked_on<=?',donorId,day)
 if(r.type==='stop'||(r.type==='channels'&&JSON.parse(r.channels).includes(channel)))return {reason:'do not solicit',lastAskOn:last?.last??null}
 if(r.type==='limit') {
  const count=await one(c,'SELECT COUNT(*) AS n FROM cf_solicitation_asks WHERE donor_id=? AND asked_on>=? AND asked_on<=?',donorId,day.slice(0,4)+'-01-01',day)
  if(count!.n>=r.max_asks)return {reason:'solicitation limit',lastAskOn:last?.last??null}
 }
 return null
}

export async function solicitationCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(!['solicitation.set','solicitation.include'].includes(command))return undefined
 staff(c)
 const donorId=id(p.donorId,'Donor'),version=integer(Number(p.version),'Restriction version',0)
 if(command==='solicitation.include') {
  const kind=id(p.kind,'Run kind'),runId=id(p.runId,'Run'),reason=text(p.reason,'Reason for including this donor',1000)
  const run=await one(c,'SELECT * FROM cf_solicitation_runs WHERE kind=? AND run_id=?',kind,runId)
  if(!run||!run.is_ask)fail('ASK_RUN','Choose an existing ask run.',400)
  await commit(c,[live(donorId),versionGuard(donorId,version),
   guard('NOT EXISTS(SELECT 1 FROM cf_solicitation_asks WHERE kind=? AND run_id=?)','RUN_SUBMITTED','This run has already been submitted.',kind,runId),
   sql('INSERT INTO cf_solicitation_inclusions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(kind,run_id,donor_id) DO UPDATE SET restriction_version=excluded.restriction_version,reason=excluded.reason,actor_id=excluded.actor_id,actor_name=excluded.actor_name,recorded_at=excluded.recorded_at',kind,runId,donorId,version,reason,c.actor.id,c.actor.name,c.now),
   event(c,command,kind,runId,donorId,{reason,restrictionVersion:version}),
  ])
  return {donorId,kind,runId,reason,actorId:c.actor.id,actorName:c.actor.name}
 }
 const write=await solicitationWriteStatements(c,p)
 await commit(c,write.statements)
 return (await solicitationState(c,[donorId]))[0]
}

/** Trusted portal/import adapters may compose these statements into their own
 * atomic transaction. They must first authenticate the portal donor or approve
 * the reviewed import; no public command forwards the trustedSource argument.
 * Import sourceRef names its source system/run; portal sourceRef its request.
 */
export async function solicitationWriteStatements(c:Context,p:Row,trustedSource?:'portal'|'import'):Promise<{donorId:string;version:number;statements:Stmt[]}> {
 const donorId=id(p.donorId,'Donor'),version=integer(Number(p.version),'Restriction version',0)
 if(!trustedSource)staff(c)
 const type=choice(p.type,['none','stop','channels','limit'] as const,'restriction type')
 const startsOn=date(p.startsOn??await calendarDay(c),'Start date'),endsOn=p.endsOn?date(p.endsOn,'End date'):null
 if(endsOn&&endsOn<startsOn)fail('INPUT','End date must be on or after the start date.',400)
 let channels:unknown=p.channels??[]
 if(typeof channels==='string')channels=channels.split(',').map(s=>s.trim()).filter(Boolean)
 if(!Array.isArray(channels))fail('INPUT','Choose restricted channels.',400)
 const selected=[...new Set(channels.map(v=>choice(v,SOLICITATION_CHANNELS,'restricted channel')))].sort()
 if(type==='channels'&&!selected.length)fail('INPUT','Choose at least one restricted channel.',400)
 const maxAsks=type==='limit'?integer(Number(p.maxAsks),'Asks per calendar year',1,10000):null
 const source=choice(p.source??'person',['person','portal','interaction','import'] as const,'restriction source')
 const sourceRef=optional(p.sourceRef,'Source reference',500),sourceOn=date(p.sourceOn??await calendarDay(c),'Source date')
 // Portal/import provenance must be supplied by those trusted adapters, never
 // claimed by a staff form. A logged request must identify its interaction.
 if((source==='portal'||source==='import')&&source!==trustedSource)fail('SOURCE','Use the portal or reviewed importer to record this source.',400)
 if(trustedSource&&(source!==trustedSource||!sourceRef))fail('SOURCE','A trusted source needs its system or request reference.',400)
 if(source==='interaction'&&!sourceRef)fail('INPUT','Choose the donor request interaction.',400)
 const existing=await one(c,'SELECT type FROM cf_solicitation WHERE donor_id=?',donorId)
 // Changing an existing restriction can relax it as surely as clearing it.
 const requiresManager=!!existing&&existing.type!=='none'
 if(requiresManager&&!['owner','admin'].includes(c.actor.role)&&!await one(c,`SELECT 1 AS ok WHERE ${assigned}`,donorId,c.actor.id))fail('FORBIDDEN','Only an owner, admin or assigned relationship manager can replace or clear a restriction.',403)
 const answer={type,startsOn,endsOn,channels:type==='channels'?selected:[],maxAsks,period:type==='limit'?'calendar-year':null,source,sourceRef,sourceOn,actorId:c.actor.id,actorName:c.actor.name,at:c.now}
 const statements=[live(donorId),versionGuard(donorId,version),
  ...(requiresManager&&!['owner','admin'].includes(c.actor.role)?[guard(assigned,'MANAGER_CHANGED','The assigned relationship manager changed.',donorId,c.actor.id)]:[]),
  ...(source==='interaction'?[guard('EXISTS(SELECT 1 FROM cf_interactions WHERE id=? AND donor_id=?)','SOURCE_CHANGED','Choose a request on this donor’s timeline.',sourceRef,donorId)]:[]),
  sql('INSERT INTO cf_solicitation VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(donor_id) DO UPDATE SET version=excluded.version,type=excluded.type,starts_on=excluded.starts_on,ends_on=excluded.ends_on,channels=excluded.channels,max_asks=excluded.max_asks,source=excluded.source,source_ref=excluded.source_ref,source_on=excluded.source_on,recorded_at=excluded.recorded_at,recorded_by_id=excluded.recorded_by_id,recorded_by_name=excluded.recorded_by_name',donorId,version+1,type,startsOn,endsOn,JSON.stringify(answer.channels),maxAsks,source,sourceRef,sourceOn,c.now,c.actor.id,c.actor.name),
  sql('INSERT INTO cf_solicitation_history VALUES(?,?,?)',donorId,version+1,JSON.stringify(answer)),
  event(c,'solicitation.set','donor',donorId,donorId,{...answer,version:version+1}),
 ]
 return {donorId,version:version+1,statements}
}

/** Persist this classification before allowing deliberate includes. This does
 * not send anything; the host run owns its lifecycle and authorization. */
export async function prepareSolicitationRun(c:Context,input:{kind:string;id:string;channel:SolicitationChannel;isAsk:boolean;donorIds:string[];includes?:{donorId:string;reason:string}[]}):Promise<Row> {
 const {kind,id:runId,channel,isAsk,donorIds}=input
 const explicit=new Map((input.includes??[]).map(x=>[id(x.donorId,'Included donor'),text(x.reason,'Reason for including this donor',1000)]))
 if(explicit.size&&!['owner','admin','member'].includes(c.actor.role))fail('FORBIDDEN','Only a staff person deliberately includes a restricted donor in this run.',403)
 if([...explicit.keys()].some(x=>!donorIds.includes(x)))fail('INPUT','An included donor must be in the selected segment.',400)
 id(kind,'Run kind');id(runId,'Run');choice(channel,SOLICITATION_CHANNELS,'ask channel')
 if(typeof isAsk!=='boolean')fail('INPUT','Mark the outbound run as an ask or not an ask.',400)
 const states=await solicitationState(c,donorIds),recipients:Row[]=[],excluded:Row[]=[]
 for(const state of states) {
  const savedException=await one(c,'SELECT * FROM cf_solicitation_inclusions WHERE kind=? AND run_id=? AND donor_id=? AND restriction_version=?',kind,runId,state.donor_id,state.version)
  const exception=explicit.has(state.donor_id)?{donor_id:state.donor_id,restriction_version:state.version,reason:explicit.get(state.donor_id),actor_id:c.actor.id,actor_name:c.actor.name,recorded_at:c.now}:savedException
  const reason=isAsk?await solicitationReason(c,state.donor_id,channel,c.now):null
  if(reason&&!exception)excluded.push({donorId:state.donor_id,...reason})
  else recipients.push({...state,inclusion:exception})
 }
 const statements=[guard('NOT EXISTS(SELECT 1 FROM cf_solicitation_asks WHERE kind=? AND run_id=?)','RUN_SUBMITTED','This run has already been submitted.',kind,runId),
  guard('NOT EXISTS(SELECT 1 FROM cf_solicitation_runs WHERE kind=? AND run_id=? AND (channel<>? OR is_ask<>?))','RUN_CHANGED','A run cannot change channel or ask classification.',kind,runId,channel,isAsk?1:0),
  sql('INSERT INTO cf_solicitation_runs VALUES(?,?,?,?,?) ON CONFLICT(kind,run_id) DO UPDATE SET prepared_at=excluded.prepared_at',kind,runId,channel,isAsk?1:0,c.now),
  sql('DELETE FROM cf_solicitation_recipients WHERE kind=? AND run_id=?',kind,runId),
  ...recipients.filter(r=>explicit.has(r.donor_id)).flatMap(r=>[sql('INSERT INTO cf_solicitation_inclusions VALUES(?,?,?,?,?,?,?,?)',kind,runId,r.donor_id,r.version,r.inclusion.reason,c.actor.id,c.actor.name,c.now),event(c,'solicitation.include',kind,runId,r.donor_id,{reason:r.inclusion.reason,restrictionVersion:r.version})]),
  ...recipients.flatMap(r=>[live(r.donor_id),...(isAsk?[versionGuard(r.donor_id,r.version)]:[]),sql('INSERT INTO cf_solicitation_recipients VALUES(?,?,?,?)',kind,runId,r.donor_id,r.version)]),
 ]
 return {kind,id:runId,isAsk,channel,recipients,excluded,statements}
}

/** Recheck inside the host transaction. Independent sends cannot exceed a limit:
 * each sender's guard and ledger insert must be committed in the same batch. */
export async function solicitationRunGuards(c:Context,kind:string,runId:string,donorIds?:string[],prepared?:Row):Promise<Stmt[]> {
 const run=prepared?{is_ask:prepared.isAsk?1:0,channel:prepared.channel}:await one(c,'SELECT * FROM cf_solicitation_runs WHERE kind=? AND run_id=?',kind,runId)
 if(!run)fail('ASK_RUN','Prepare the outbound classification first.',409)
 const rows:Row[]=prepared?prepared.recipients.map((r:Row)=>({...r,restriction_version:r.version})):await all(c,'SELECT * FROM cf_solicitation_recipients WHERE kind=? AND run_id=?',kind,runId)
 const selected=donorIds?[...new Set(donorIds)].map(d=>rows.find(r=>r.donor_id===d)??fail('ASK_RECIPIENT','This donor is outside the frozen run.',409)):rows
 const day=await calendarDay(c,c.now),year=day.slice(0,4)+'-01-01'
 return selected.flatMap(r=>[live(r.donor_id),...(run.is_ask?[versionGuard(r.donor_id,r.restriction_version)]:[]),
  guard('EXISTS(SELECT 1 FROM cf_solicitation_recipients WHERE kind=? AND run_id=? AND donor_id=? AND restriction_version=?)','ASK_RUN_CHANGED','The frozen audience changed. Prepare again.',kind,runId,r.donor_id,r.restriction_version),...(run.is_ask?[guard(`
  EXISTS(SELECT 1 FROM cf_solicitation_asks WHERE kind=? AND run_id=? AND donor_id=?) OR
  EXISTS(SELECT 1 FROM cf_solicitation_inclusions WHERE kind=? AND run_id=? AND donor_id=? AND restriction_version=?) OR
  NOT EXISTS(SELECT 1 FROM cf_solicitation s WHERE s.donor_id=? AND s.type<>'none' AND s.starts_on<=? AND (s.ends_on IS NULL OR s.ends_on>=?) AND
   (s.type='stop' OR (s.type='channels' AND EXISTS(SELECT 1 FROM json_each(s.channels) WHERE value=?)) OR
    (s.type='limit' AND (SELECT COUNT(*) FROM cf_solicitation_asks a WHERE a.donor_id=s.donor_id AND a.asked_on>=? AND a.asked_on<=?)>=s.max_asks)))`,
  'SOLICITATION_RESTRICTED','This donor is now excluded by their solicitation restriction. Prepare again.',kind,runId,r.donor_id,kind,runId,r.donor_id,r.restriction_version,r.donor_id,day,day,run.channel,year,day)]:[])])
}

/** Commit only at durable sender submission/mail export, never at preparation.
 * The same kind/run/donor key makes export + markSent or retries count once. */
export async function solicitationAskStatements(c:Context,kind:string,runId:string,donorIds?:string[],prepared?:Row):Promise<Stmt[]> {
 const statements=await solicitationRunGuards(c,kind,runId,donorIds,prepared),day=await calendarDay(c,c.now)
 statements.push(sql(`INSERT OR IGNORE INTO cf_solicitation_asks SELECT r.kind,r.run_id,r.donor_id,u.channel,?,? FROM cf_solicitation_recipients r JOIN cf_solicitation_runs u USING(kind,run_id) WHERE r.kind=? AND r.run_id=? AND u.is_ask=1 AND (? IS NULL OR r.donor_id IN (SELECT value FROM json_each(?)))`,day,c.now,kind,runId,donorIds?JSON.stringify(donorIds):null,JSON.stringify(donorIds??[])))
 return statements
}

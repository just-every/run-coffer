import { all, choice, commit, date, event, fail, guard, id, integer, one, optional, sql, text, today, type Context, type Row, type Stmt } from './db'
import { settings } from './settings'
import { SOLICITATION_PERIODS, SOLICITATION_COUNT_COLUMNS, solicitationCounts, solicitationCountCase, solicitationPeriodWindows, type SolicitationPeriod } from './solicitation-periods'

export const SOLICITATION_CHANNELS = ['email','mail','sms','phone'] as const
export type SolicitationChannel = typeof SOLICITATION_CHANNELS[number]
type ReadContext = Pick<Context,'db'>
export type SolicitationReason = { reason: 'do not solicit' | 'solicitation limit'; lastAskOn: string | null }
export type SolicitationState = Row & { asOf: string; lastAskOn: string | null }
const canonical=(column:string)=>`COALESCE((SELECT into_id FROM cf_donor_merges WHERE donor_id=${column}),${column})`
const ownVersion = `COALESCE((SELECT version FROM cf_solicitation WHERE donor_id=?),0)`
const assigned = `EXISTS(SELECT 1 FROM cf_portfolio_members m JOIN cf_portfolios p ON p.id=m.portfolio_id JOIN oa_operators o ON o.id=p.manager_id WHERE m.donor_id=? AND o.id=? AND o.status='active' AND o.role IN ('owner','admin','member'))`
const live = (donorId:string) => guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`,'DONOR_CHANGED','Choose a current donor.',donorId)
const staff = (c:Context) => { if(!['owner','admin','member'].includes(c.actor.role))fail('FORBIDDEN','A person must record solicitation choices.',403) }
async function calendarDay(c:ReadContext,at?:string) {
 if(at && /^\d{4}-\d{2}-\d{2}$/.test(at))return date(at,'Ask date')
 const instant=new Date(at??('now' in c ? String(c.now) : new Date().toISOString()))
 if(!Number.isFinite(instant.getTime()))fail('INPUT','Choose a valid ask date.',400)
 return today((await settings(c)).timezone,instant)
}

/** Array includes an explicit version-zero/none state for every requested ID. */
export async function solicitationState(c:ReadContext,donorIds:string[],at?:string):Promise<SolicitationState[]> {
 if(!donorIds.length)return []
 const day=await calendarDay(c,at),ids=JSON.stringify([...new Set(donorIds)])
 const [rows,asks]=await Promise.all([
  all(c,`SELECT s.*,${canonical('s.donor_id')} AS canonical_id FROM cf_solicitation s WHERE ${canonical('s.donor_id')} IN (SELECT value FROM json_each(?))`,ids),
  all(c,`SELECT ${canonical('a.donor_id')} AS canonical_id,MAX(a.asked_on) AS last FROM cf_solicitation_asks a WHERE ${canonical('a.donor_id')} IN (SELECT value FROM json_each(?)) AND a.asked_on<=? GROUP BY ${canonical('a.donor_id')}`,ids,day),
 ])
 const lastAsks=new Map(asks.map(row=>[row.canonical_id,row.last])),groups=new Map<string,Row[]>()
 for(const row of rows){const group=groups.get(row.canonical_id);if(group)group.push(row);else groups.set(row.canonical_id,[row])}
 return [...new Set(donorIds)].map(donorId=>{
  const group=groups.get(donorId)??[],row=group.find(r=>r.donor_id===donorId)
  const active=(r:Row)=>r.type!=='none'&&r.starts_on<=day&&(!r.ends_on||r.ends_on>=day)
  const inherited=group.filter(r=>r.donor_id!==donorId).map(r=>({...r,channels:JSON.parse(r.channels),active:active(r)}))
  return {...(row?{...row,channels:JSON.parse(row.channels),active:active(row)}:{donor_id:donorId,version:0,type:'none',channels:[],active:false,period:'rolling-12-months'}),asOf:day,lastAskOn:lastAsks.get(donorId)??null,scope_version:group.reduce((n,r)=>n+r.version,0),inherited}

 })
}

/** Two bulk reads regardless of audience size. Every requested identity has an
 * explicit null or reason; merged originals retain their full restriction union
 * and every original ask counts toward each restriction's calendar period. */
export async function solicitationReasons(c:ReadContext,donorIds:string[],channel:SolicitationChannel,at?:string):Promise<Map<string,SolicitationReason|null>> {
 choice(channel,SOLICITATION_CHANNELS,'ask channel')
 const result=new Map<string,SolicitationReason|null>([...new Set(donorIds)].map(d=>[d,null]))
 if(!result.size)return result
 const day=await calendarDay(c,at),ids=JSON.stringify([...result.keys()])
 const periods=solicitationPeriodWindows(day,(await settings(c)).fiscal_year_start),count=solicitationCounts(periods)
 const [rows,asks]=await Promise.all([
  all(c,`SELECT s.*,${canonical('s.donor_id')} AS canonical_id FROM cf_solicitation s WHERE ${canonical('s.donor_id')} IN (SELECT value FROM json_each(?)) AND s.type<>'none' AND s.starts_on<=? AND (s.ends_on IS NULL OR s.ends_on>=?)`,ids,day,day),
  all(c,`SELECT ${canonical('a.donor_id')} AS canonical_id,MAX(a.asked_on) AS last,
   ${count.sql}
   FROM cf_solicitation_asks a WHERE ${canonical('a.donor_id')} IN (SELECT value FROM json_each(?)) AND a.asked_on<=? GROUP BY ${canonical('a.donor_id')}`,...count.params,ids,day),
 ])
 const counts=new Map(asks.map(r=>[r.canonical_id,r]))
 for(const r of rows){
  const asked=counts.get(r.canonical_id),stop=r.type==='stop'||r.type==='channels'&&JSON.parse(r.channels).includes(channel)
  if(stop)result.set(r.canonical_id,{reason:'do not solicit',lastAskOn:asked?.last??null})
  else if(r.type==='limit'&&(asked?.[SOLICITATION_COUNT_COLUMNS[r.period as SolicitationPeriod]]??0)>=r.max_asks&&!result.get(r.canonical_id))result.set(r.canonical_id,{reason:'solicitation limit',lastAskOn:asked?.last??null})
 }
 return result
}
export async function solicitationReason(c:ReadContext,donorId:string,channel:SolicitationChannel,at?:string):Promise<SolicitationReason|null> {
 return (await solicitationReasons(c,[donorId],channel,at)).get(donorId)??null
}

const expectedRecipients=`expected AS (SELECT json_extract(value,'$.donor_id') AS donor_id,json_extract(value,'$.restriction_version') AS restriction_version FROM json_each(?))`
const scopeVersions=`versions AS (SELECT ${canonical('s.donor_id')} AS donor_id,SUM(s.version) AS version FROM cf_solicitation s GROUP BY ${canonical('s.donor_id')})`
function frozenVector(rows:Row[]){return JSON.stringify(rows.map(r=>({donor_id:r.donor_id,restriction_version:r.restriction_version??r.version})))}
const liveRecipients=(vector:string)=>guard(`(WITH ${expectedRecipients} SELECT NOT EXISTS(SELECT 1 FROM expected e LEFT JOIN cf_donors d ON d.id=e.donor_id LEFT JOIN cf_donor_merges m ON m.donor_id=d.id WHERE d.id IS NULL OR d.erased_at IS NOT NULL OR m.donor_id IS NOT NULL))`,'DONOR_CHANGED','Choose a current donor.',vector)
const recipientVersions=(vector:string)=>guard(`(WITH ${expectedRecipients},${scopeVersions} SELECT NOT EXISTS(SELECT 1 FROM expected e LEFT JOIN versions v ON v.donor_id=e.donor_id WHERE COALESCE(v.version,0)<>e.restriction_version))`,'SOLICITATION_CHANGED','The solicitation restriction changed. Prepare or refresh again.',vector)

export async function solicitationCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(command!=='solicitation.set')return undefined
 staff(c)
 const donorId=id(p.donorId,'Donor')
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
 const period=choice(p.period??'rolling-12-months',SOLICITATION_PERIODS,'calendar limit period')
 const maxAsks=type==='limit'?integer(Number(p.maxAsks),'Asks per calendar period',1,10000):null
 const source=choice(p.source??'person',['person','portal','interaction','import'] as const,'restriction source')
 const sourceRef=optional(p.sourceRef,'Source reference',500),sourceOn=date(p.sourceOn??await calendarDay(c),'Source date')
 // Portal/import provenance must be supplied by those trusted adapters, never
 // claimed by a staff form. A logged request must identify its interaction.
 if((source==='portal'||source==='import')&&source!==trustedSource)fail('SOURCE','Use the portal or reviewed importer to record this source.',400)
 if(trustedSource&&(source!==trustedSource||!sourceRef))fail('SOURCE','A trusted source needs its system or request reference.',400)
 if(source==='interaction'&&!sourceRef)fail('INPUT','Choose the donor request interaction.',400)
 const originals=await all(c,`SELECT s.* FROM cf_solicitation s WHERE ${canonical('s.donor_id')}=?`,donorId)
 // Changing an existing restriction can relax it as surely as clearing it.
 const requiresManager=originals.some(r=>r.type!=='none')
 if(requiresManager&&!['owner','admin'].includes(c.actor.role)&&!await one(c,`SELECT 1 AS ok WHERE ${assigned}`,donorId,c.actor.id))fail('FORBIDDEN','Only an owner, admin or assigned relationship manager can replace or clear a restriction.',403)
 const answer={type,startsOn,endsOn,channels:type==='channels'?selected:[],maxAsks,period:type==='limit'?period:null,source,sourceRef,sourceOn,actorId:c.actor.id,actorName:c.actor.name,at:c.now}
 const statements=[live(donorId),guard(`${ownVersion}=?`,'SOLICITATION_CHANGED','The solicitation restriction changed. Refresh again.',donorId,version),
  ...(requiresManager&&!['owner','admin'].includes(c.actor.role)?[guard(assigned,'MANAGER_CHANGED','The assigned relationship manager changed.',donorId,c.actor.id)]:[]),
  ...(source==='interaction'?[guard('EXISTS(SELECT 1 FROM cf_interactions WHERE id=? AND donor_id=?)','SOURCE_CHANGED','Choose a request on this donor’s timeline.',sourceRef,donorId)]:[]),
  sql('INSERT INTO cf_solicitation(donor_id,version,type,starts_on,ends_on,channels,max_asks,source,source_ref,source_on,recorded_at,recorded_by_id,recorded_by_name,period) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(donor_id) DO UPDATE SET version=excluded.version,type=excluded.type,starts_on=excluded.starts_on,ends_on=excluded.ends_on,channels=excluded.channels,max_asks=excluded.max_asks,source=excluded.source,source_ref=excluded.source_ref,source_on=excluded.source_on,recorded_at=excluded.recorded_at,recorded_by_id=excluded.recorded_by_id,recorded_by_name=excluded.recorded_by_name,period=excluded.period',donorId,version+1,type,startsOn,endsOn,JSON.stringify(answer.channels),maxAsks,source,sourceRef,sourceOn,c.now,c.actor.id,c.actor.name,type==='limit'?period:'rolling-12-months'),
  sql('INSERT INTO cf_solicitation_history VALUES(?,?,?)',donorId,version+1,JSON.stringify(answer)),
  ...originals.filter(r=>r.donor_id!==donorId&&r.type!=='none').flatMap(r=>[
   guard('EXISTS(SELECT 1 FROM cf_solicitation WHERE donor_id=? AND version=?)','SOLICITATION_CHANGED','An original merged restriction changed.',r.donor_id,r.version),
   sql("UPDATE cf_solicitation SET version=version+1,type='none',channels='[]',max_asks=NULL,period='calendar-year',source=?,source_ref=?,source_on=?,recorded_at=?,recorded_by_id=?,recorded_by_name=? WHERE donor_id=?",source,sourceRef,sourceOn,c.now,c.actor.id,c.actor.name,r.donor_id),
   sql('INSERT INTO cf_solicitation_history VALUES(?,?,?)',r.donor_id,r.version+1,JSON.stringify({...answer,type:'none',channels:[],maxAsks:null,period:null,resolvedAtDonorId:donorId})),
   event(c,'solicitation.resolveMerged','donor',r.donor_id,donorId,{originalDonorId:r.donor_id,version:r.version+1,answer}),
  ]),
  event(c,'solicitation.set','donor',donorId,donorId,{...answer,version:version+1}),
 ]
 return {donorId,version:version+1,statements}
}

/** Persist this classification before allowing deliberate includes. This does
 * not send anything; the host run owns its lifecycle and authorization. */
export async function prepareSolicitationRun(c:Context,input:{kind:string;id:string;channel:SolicitationChannel;isAsk:boolean;donorIds:string[];includes?:{donorId:string;reason:string}[]}):Promise<Row> {
 const {kind,id:runId,channel,isAsk,donorIds}=input
 const selectedIds=new Set(donorIds)
 const explicit=new Map((input.includes??[]).map(x=>[id(x.donorId,'Included donor'),text(x.reason,'Reason for including this donor',1000)]))
 await deliberateInclusionGuards(c,[...explicit.keys()])
 if([...explicit.keys()].some(x=>!selectedIds.has(x)))fail('INPUT','An included donor must be in the selected segment.',400)
 id(kind,'Run kind');id(runId,'Run');choice(channel,SOLICITATION_CHANNELS,'ask channel')
 if(typeof isAsk!=='boolean')fail('INPUT','Mark the outbound run as an ask or not an ask.',400)
 const day=await calendarDay(c,c.now),ids=JSON.stringify([...new Set(donorIds)])
 const [states,savedExceptions,reasons]=await Promise.all([
  solicitationState(c,donorIds,day),
  all(c,'SELECT * FROM cf_solicitation_inclusions WHERE kind=? AND run_id=? AND donor_id IN (SELECT value FROM json_each(?))',kind,runId,ids),
  isAsk?solicitationReasons(c,donorIds,channel,day):Promise.resolve(new Map<string,SolicitationReason|null>()),
 ])
 const savedByDonor=new Map(savedExceptions.map(r=>[r.donor_id,r])),recipients:Row[]=[],excluded:Row[]=[]
 for(const ownState of states) {
  const state:Row={...ownState,version:ownState.scope_version}
  const saved=savedByDonor.get(state.donor_id),savedException=saved?.restriction_version===state.version?saved:null
  const exception=explicit.has(state.donor_id)?{donor_id:state.donor_id,restriction_version:state.version,reason:explicit.get(state.donor_id),actor_id:c.actor.id,actor_name:c.actor.name,recorded_at:c.now}:savedException
  const reason=reasons.get(state.donor_id)??null
  if(reason&&!exception)excluded.push({donorId:state.donor_id,...reason})
  else recipients.push({...state,inclusion:exception})
 }
 const vector=frozenVector(recipients),inclusions=JSON.stringify(recipients.filter(r=>explicit.has(r.donor_id)).map(r=>({donor_id:r.donor_id,version:r.version,reason:r.inclusion.reason})))
 const statements=[guard('NOT EXISTS(SELECT 1 FROM cf_solicitation_asks WHERE kind=? AND run_id=?)','RUN_SUBMITTED','This run has already been submitted.',kind,runId),
  guard('NOT EXISTS(SELECT 1 FROM cf_solicitation_runs WHERE kind=? AND run_id=? AND (channel<>? OR is_ask<>?))','RUN_CHANGED','A run cannot change channel or ask classification.',kind,runId,channel,isAsk?1:0),
  sql('INSERT INTO cf_solicitation_runs VALUES(?,?,?,?,?) ON CONFLICT(kind,run_id) DO UPDATE SET prepared_at=excluded.prepared_at',kind,runId,channel,isAsk?1:0,c.now),
  sql('DELETE FROM cf_solicitation_recipients WHERE kind=? AND run_id=?',kind,runId),
  sql(`INSERT INTO cf_solicitation_inclusions SELECT ?,?,json_extract(value,'$.donor_id'),json_extract(value,'$.version'),json_extract(value,'$.reason'),?,?,? FROM json_each(?)`,kind,runId,c.actor.id,c.actor.name,c.now,inclusions),
  sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) SELECT ?,?,?,?,'solicitation.include',?,?,json_extract(value,'$.donor_id'),json_object('reason',json_extract(value,'$.reason'),'restrictionVersion',json_extract(value,'$.version')) FROM json_each(?)`,c.now,c.actor.id,c.actor.name,c.actor.role,kind,runId,inclusions),
  liveRecipients(vector),...await deliberateInclusionGuards(c,[...explicit.keys()]),...(isAsk?[recipientVersions(vector)]:[]),
  sql(`INSERT INTO cf_solicitation_recipients SELECT ?,?,json_extract(value,'$.donor_id'),json_extract(value,'$.restriction_version') FROM json_each(?)`,kind,runId,vector),
 ]
 return {kind,id:runId,isAsk,channel,recipients,excluded,statements}
}

/** Recheck inside the host transaction. Independent sends cannot exceed a limit:
 * each sender's guard and ledger insert must be committed in the same batch. */
export async function solicitationRunGuards(c:Context,kind:string,runId:string,donorIds?:string[],prepared?:Row):Promise<Stmt[]> {
 const run=prepared?{is_ask:prepared.isAsk?1:0,channel:prepared.channel}:await one(c,'SELECT * FROM cf_solicitation_runs WHERE kind=? AND run_id=?',kind,runId)
 if(!run)fail('ASK_RUN','Prepare the outbound classification first.',409)
 const rows:Row[]=prepared?prepared.recipients.map((r:Row)=>({...r,restriction_version:r.version})):await all(c,'SELECT * FROM cf_solicitation_recipients WHERE kind=? AND run_id=?',kind,runId)
 const byDonor=new Map(rows.map(r=>[r.donor_id,r]))
 const selected=donorIds?[...new Set(donorIds)].map(d=>byDonor.get(d)??fail('ASK_RECIPIENT','This donor is outside the frozen run.',409)):rows
 const day=await calendarDay(c,c.now),periods=solicitationPeriodWindows(day,(await settings(c)).fiscal_year_start),count=solicitationCounts(periods)
 const vector=frozenVector(selected)
 return [liveRecipients(vector),...(run.is_ask?[recipientVersions(vector)]:[]),
  guard(`(WITH ${expectedRecipients} SELECT NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(SELECT 1 FROM cf_solicitation_recipients r WHERE r.kind=? AND r.run_id=? AND r.donor_id=e.donor_id AND r.restriction_version=e.restriction_version)))`,'ASK_RUN_CHANGED','The frozen audience changed. Prepare again.',vector,kind,runId),
  ...(run.is_ask?[guard(`(WITH ${expectedRecipients},
   counts AS (SELECT ${canonical('a.donor_id')} AS donor_id,${count.sql}
    FROM cf_solicitation_asks a WHERE a.asked_on<=? GROUP BY ${canonical('a.donor_id')}),
   restricted AS (SELECT ${canonical('s.donor_id')} AS donor_id FROM cf_solicitation s LEFT JOIN counts a ON a.donor_id=${canonical('s.donor_id')}
    WHERE s.type<>'none' AND s.starts_on<=? AND (s.ends_on IS NULL OR s.ends_on>=?) AND
     (s.type='stop' OR (s.type='channels' AND EXISTS(SELECT 1 FROM json_each(s.channels) WHERE value=?)) OR (s.type='limit' AND COALESCE(${solicitationCountCase},0)>=s.max_asks)))
   SELECT NOT EXISTS(SELECT 1 FROM expected e JOIN restricted s ON s.donor_id=e.donor_id
    WHERE NOT EXISTS(SELECT 1 FROM cf_solicitation_asks a WHERE a.kind=? AND a.run_id=? AND a.donor_id=e.donor_id)
     AND NOT EXISTS(SELECT 1 FROM cf_solicitation_inclusions i WHERE i.kind=? AND i.run_id=? AND i.donor_id=e.donor_id AND i.restriction_version=e.restriction_version)))`,
   'SOLICITATION_RESTRICTED','This donor is now excluded by their solicitation restriction. Prepare again.',vector,...count.params,day,day,day,run.channel,kind,runId,kind,runId)]:[])]
}

/** Commit only at durable sender submission/mail export, never at preparation.
 * The same kind/run/donor key makes export + markSent or retries count once. */
export async function solicitationAskStatements(c:Context,kind:string,runId:string,donorIds?:string[],prepared?:Row):Promise<Stmt[]> {
 const statements=await solicitationRunGuards(c,kind,runId,donorIds,prepared),day=await calendarDay(c,c.now)
 statements.push(sql(`INSERT OR IGNORE INTO cf_solicitation_asks SELECT r.kind,r.run_id,r.donor_id,u.channel,?,? FROM cf_solicitation_recipients r JOIN cf_solicitation_runs u USING(kind,run_id) WHERE r.kind=? AND r.run_id=? AND u.is_ask=1 AND (? IS NULL OR r.donor_id IN (SELECT value FROM json_each(?)))`,day,c.now,kind,runId,donorIds?JSON.stringify(donorIds):null,JSON.stringify(donorIds??[])))
 return statements
}

/** Rechecked inside the host transaction as well as before audience construction. */
export async function deliberateInclusionGuards(c:Context,donorIds:string[]):Promise<Stmt[]> {
 if(!donorIds.length||['owner','admin'].includes(c.actor.role))return []
 if(c.actor.role!=='member')fail('FORBIDDEN','Only an owner, admin or the assigned relationship manager deliberately includes a donor.',403)
 const statements:Stmt[]=[]
 for(const donorId of donorIds){
  if(!await one(c,`SELECT 1 WHERE ${assigned}`,donorId,c.actor.id))fail('FORBIDDEN','Only the donor’s assigned relationship manager may deliberately include this donor.',403)
  statements.push(guard(assigned,'MANAGER_CHANGED','The assigned relationship manager changed.',donorId,c.actor.id))
 }
 return statements
}

import { requireRole } from '../auth'
import { all, choice, commit, event, fail, guard, id, integer, one, sha256, sql, type Context, type Row } from '../db'
import { likelyDuplicates } from '../duplicates'
import { totalsCheck } from '../move-in/service'
import { journal as stripeJournal } from '../imports/service'
import { DUE } from '../acknowledgements'
import { settings } from '../settings'

type SourceKind = 'crm' | 'stripe'
type SourceRecord = {kind:string;nativeId:string;donorId:string|null;fact:Row|null}
type Citation = {href:string;pointer:string;label:string;page?:string}
type Finding = {kind:string;summary:string;source:unknown;native:unknown;citations:Citation[];excludedFromRecovery?:boolean}
const root='/api/coffer/agent/move-in'
const sourceUrl=(kind:SourceKind,jobId:string)=>root+'/source?kind='+kind+'&jobId='+encodeURIComponent(jobId)
const authorize=(c:Context)=>requireRole(c.actor,['owner','admin'],'prepare migration comparisons')
const clock=async(c:Context)=>(await one(c,'SELECT version FROM cf_migration_analysis_clock WHERE id=1'))!.version as number

/** The immutable reviewed import is the source. Current native choices are read
 * separately; neither a missing source fact nor an opaque payment reference is permission. */
export async function migrationSource(c:Context,p:Row) {
 authorize(c)
 const version=await clock(c)
 if(p.version!==undefined&&Number(p.version)!==version)fail('MIGRATION_CHANGED','This source citation is stale. Run a new comparison.',409)
 const kind=choice(p.kind,['crm','stripe'] as const,'source import'),jobId=id(p.jobId,'Import')
 let records:SourceRecord[],money:Row,job:Row
 if(kind==='crm') {
  const held=await one(c,'SELECT * FROM cf_move_in_jobs WHERE id=?',jobId)
  if(!held)fail('NOT_FOUND','That import does not exist.',404)
  if(held.redacted)fail('MIGRATION_ERASED','Source evidence was erased. It cannot be analyzed.',409)
  if(held.state!=='completed'||held.parts!==held.applied_parts)fail('MIGRATION_INCOMPLETE','Finish the import before comparing it.',409)
  job=held
  const reviewed=await all(c,'SELECT kind,native_id,donor_id,fact FROM cf_migration_source_records WHERE job_id=? ORDER BY kind,native_id',jobId)
  if(reviewed.length)records=reviewed.map(r=>({kind:r.kind,nativeId:r.native_id,donorId:r.donor_id,fact:JSON.parse(r.fact)}))
  else {
   // Legacy journals retain native custody snapshots. Include prior mappings
   // referenced by this review, rather than treating reuse as absent evidence.
   const legacy=await all(c,`WITH selected AS (
    SELECT r.kind,r.native_id FROM cf_move_in_source_records i JOIN cf_move_in_records r
     ON r.source=? AND r.source_key=i.source_key AND r.kind=CASE i.kind WHEN 'constituent' THEN 'donor' ELSE i.kind END
    WHERE i.job_id=?
   ), credits AS (SELECT native_id FROM cf_move_in_records WHERE source=? AND kind='softCredit'
    AND json_extract(snapshot,'$.gift_id') IN(SELECT native_id FROM selected WHERE kind='gift'))
   SELECT r.kind,r.native_id,r.donor_id,r.snapshot,r.owned FROM cf_move_in_records r WHERE r.source=? AND (
    r.job_id=? OR r.kind='donor' AND r.native_id IN(SELECT native_id FROM selected WHERE kind='donor')
    OR r.kind='consent' AND r.donor_id IN(SELECT native_id FROM selected WHERE kind='donor')
    OR r.kind IN('gift','acknowledgment') AND r.native_id IN(SELECT native_id FROM selected WHERE kind='gift')
    OR r.kind IN('softCredit','softCreditAcknowledgment') AND r.native_id IN(SELECT native_id FROM credits)
   ) ORDER BY r.kind,r.native_id`,held.source,jobId,held.source,held.source,jobId)
   records=legacy.map(r=>({kind:r.kind,nativeId:r.native_id,donorId:r.donor_id,
    fact:!r.snapshot?null:r.kind==='donor'&&!r.owned?{name:null,sourceProfile:'unknown; original exports must be reviewed again'}:JSON.parse(r.snapshot)}))
  }
  if(records.some(r=>!r.fact))fail('MIGRATION_ERASED','Source evidence was erased. It cannot be analyzed.',409)
  money=await totalsCheck(c,held)
 } else {
  const read=await stripeJournal(c.db,c.actor,jobId,c.authority)
  job=read.job
  if(job.state!=='completed'||job.checkpoint!==job.total)fail('MIGRATION_INCOMPLETE','Finish the import before comparing it.',409)
  if(read.plan.entries.some(e=>e.erased))fail('MIGRATION_ERASED','Source evidence was erased. It cannot be analyzed.',409)
  records=read.plan.entries.flatMap(e=>e.effects).map(effect=>{const fact=effect.value as Row;return {kind:effect.targetKind,nativeId:String(fact.id),donorId:fact.donorId??(effect.targetKind==='donor'?fact.id:null),fact}})
  const t=read.totals
  money={matches:t.matches,rows:[{scope:'all',key:'All gifts',sourceCount:t.expectedCount,sourceCents:t.expectedCents,cofferCount:t.actualCount,cofferCents:t.actualCents,matches:t.matches}]}
 }
 if(await clock(c)!==version)fail('MIGRATION_CHANGED','Source or native records changed while reading. Refresh and compare again.',409)
 if(!(await one(c,`SELECT CASE WHEN (${c.authority.sql}) THEN 1 ELSE 0 END AS ok`,...c.authority.params))?.ok)fail('SESSION_CHANGED','Your access changed. Sign in again.',401)
 return {kind,jobId,source:kind==='stripe'?'stripe':job.source,state:job.state,fingerprint:job.fingerprint,nativeVersion:version,records,money}
}

export async function migrationState(c:Context,p:Row={}) {
 authorize(c)
 const version=await clock(c)
 const imports:Row[]=[...(await all(c,'SELECT id,source,state,parts,applied_parts,redacted FROM cf_move_in_jobs ORDER BY created_at DESC')).map(r=>({...r,kind:'crm'})),
  ...(await all(c,"SELECT id,'stripe' AS source,state,total,checkpoint FROM ik_jobs WHERE destination='coffer:donor-ledger' ORDER BY rowid DESC")).map(r=>({...r,kind:'stripe'}))]
 let analysis:Row|null=null
 if(p.analysisId) {
  const saved=await one(c,'SELECT * FROM cf_migration_analyses WHERE id=?',id(p.analysisId,'Analysis'))
  if(!saved)fail('NOT_FOUND','That comparison does not exist.',404)
  analysis={id:saved.id,kind:saved.kind,jobId:saved.job_id,createdAt:saved.created_at,status:'stale',findings:[],money:null}
  if(saved.native_version===version) {
   const result=await compareMigration(c,{kind:saved.kind,jobId:saved.job_id})
   if(result.fingerprint===saved.fingerprint)analysis={...analysis,...result,status:'current'}
  }
 }
 // A source edit during a read must not expose an apparently current result.
 if(await clock(c)!==version)fail('MIGRATION_CHANGED','Records changed while comparing. Refresh and run again.',409)
 if(!(await one(c,`SELECT CASE WHEN (${c.authority.sql}) THEN 1 ELSE 0 END AS ok`,...c.authority.params))?.ok)fail('SESSION_CHANGED','Your access changed. Sign in again.',401)
 return {version,imports,analysis}
}

async function compareMigration(c:Context,p:Row) {
 const source=await migrationSource(c,p),findings:Finding[]=[]
 const {kind,jobId,records,money}=source,href=sourceUrl(kind,jobId)+'&version='+source.nativeVersion
 const sourcePage='/app/agent/move-in/source?kind='+kind+'&jobId='+encodeURIComponent(jobId)+'&version='+source.nativeVersion
 const cite=(index:number):Citation=>({href,pointer:'/records/'+index,label:'Reviewed source '+records[index].kind,page:sourcePage+'&record='+index})
 const native=(donorId:string):Citation=>({href:'/api/coffer/donors/'+encodeURIComponent(donorId),pointer:'',label:'Current donor record',page:'/app/donors/'+encodeURIComponent(donorId)})
 const aliases=new Map((await all(c,'SELECT donor_id,into_id FROM cf_donor_merges')).map(r=>[r.donor_id,r.into_id]))
 const canonical=(key:string)=>aliases.get(key)??key
 const imported=new Set(records.filter(r=>r.kind==='donor').map(r=>canonical(r.nativeId)))
 for(const r of records)if(r.donorId)imported.add(canonical(r.donorId))
 const donorNames=new Map<string,string>()
 for(const donorId of imported){const d=await one(c,'SELECT id,name FROM cf_donors WHERE id=? AND erased_at IS NULL',donorId);if(!d)fail('MIGRATION_ERASED','An imported identity is no longer current. Review its source journal.',409);donorNames.set(donorId,d.name)}
 for(const [i,row] of (money.rows as Row[]).entries())if(!row.matches)findings.push({kind:'money',summary:(row.key||'Unspecified fund')+' totals differ',source:{count:row.sourceCount,cents:row.sourceCents},native:{count:row.cofferCount,cents:row.cofferCents},citations:[{href,pointer:'/money/rows/'+i,label:'Source and native reconciliation',page:sourcePage}]})
 // Walk all pages, preserving the existing household exception and identity rules.
 for(let page=0;;page++) {
  const duplicate=await likelyDuplicates(c,{page})
  for(const pair of duplicate.pairs)if(imported.has(pair.source.id)||imported.has(pair.target.id)) {
   const donorId=imported.has(pair.source.id)?pair.source.id:pair.target.id,index=records.findIndex(r=>r.kind==='donor'&&canonical(r.nativeId)===donorId)
   findings.push({kind:'duplicate_identity',summary:'Possible duplicate identity: '+pair.source.name+' and '+pair.target.name,source:index<0?{donorId}:records[index].fact,native:{donors:[{id:pair.source.id,name:pair.source.name},{id:pair.target.id,name:pair.target.name}],reasons:pair.reasons.map((r:Row)=>r.code)},citations:[...(index<0?[]:[cite(index)]),native(pair.source.id),native(pair.target.id)]})
  }
  if(!duplicate.more)break
 }
 const cutoff=(await one(c,'SELECT acknowledge_from FROM cf_receipt_autonomy WHERE id=1'))?.acknowledge_from??'0001-01-01'
 const due=new Set((await all(c,`SELECT g.id FROM cf_gift_balances g JOIN cf_donors d ON d.id=g.donor_id WHERE ${DUE}`,(await settings(c)).threshold_cents)).map(r=>r.id))
 for(const [index,r] of records.entries())if(r.kind==='gift'||r.kind==='softCredit') {
  const soft=r.kind==='softCredit',a=records.find(e=>e.kind===(soft?'softCreditAcknowledgment':'acknowledgment')&&e.nativeId===r.nativeId)
  const current=await one(c,`SELECT * FROM ${soft?'cf_soft_credit_acknowledgments':'cf_gift_acknowledgments'} WHERE ${soft?'soft_credit_id':'gift_id'}=?`,r.nativeId)
  const gift=await one(c,'SELECT * FROM cf_gifts WHERE id=?',soft?r.fact!.gift_id:r.nativeId)
  if(!gift)continue
  const old=gift.received_on<cutoff
  if(!a||['status','acknowledged_on','method','source_reference','interaction_id'].some(k=>(a.fact?.[k]??null)!==(current?.[k]??null)))findings.push({kind:a?'acknowledgment_discrepancy':'acknowledgment_unknown',summary:a?'Current acknowledgment differs from the reviewed source':'Source acknowledgment is unknown',source:a?.fact??{status:'unknown'},native:{...current,due:!soft&&due.has(r.nativeId),acknowledgeFrom:cutoff},excludedFromRecovery:old,citations:[cite(index),...(a?[cite(records.indexOf(a))]:[]),native(gift.donor_id)]})
  if(a?.fact?.status==='not acknowledged')findings.push({kind:old?'historical_acknowledgment':'acknowledgment_missing',summary:old?'Historical not-acknowledged gift stays outside due-letter and recovery work':'Source records an outstanding acknowledgment',source:a.fact,native:{status:current?.status??'not acknowledged',due:!soft&&due.has(r.nativeId),acknowledgeFrom:cutoff},excludedFromRecovery:old,citations:[cite(records.indexOf(a)),native(gift.donor_id)]})
 }
 for(const donorId of imported)for(const channel of ['email','mail','sms','phone']) {
  const facts=records.filter(r=>r.kind==='consent'&&r.donorId&&canonical(r.donorId)===donorId&&r.fact?.channel===channel).sort((a,b)=>Number(a.nativeId)-Number(b.nativeId)),attested=facts.at(-1)
  const current=await one(c,'SELECT * FROM cf_consents WHERE donor_id=? AND channel=? ORDER BY id DESC LIMIT 1',donorId,channel)
  if(!attested||attested.fact?.status==='unknown'||current?.status==='unknown'||!current) {
   const index=attested?records.indexOf(attested):records.findIndex(r=>r.kind==='donor'&&canonical(r.nativeId)===donorId)
   findings.push({kind:attested?'preference_unknown':'preference_missing',summary:donorNames.get(donorId)+' · '+channel+': '+(attested?'source preference is unknown':'source preference is missing'),source:{channel,status:attested?.fact?.status??'missing',fact:attested?.fact??null},native:{status:current?.status??'unknown',fact:current??null,newerChoice:!!current&&(!attested||Number(current.id)>Number(attested.nativeId))},citations:[...(index<0?[]:[cite(index)]),native(donorId)]})
  } else if(Number(current.id)>Number(attested.nativeId))findings.push({kind:'current_preference',summary:donorNames.get(donorId)+' · '+channel+': current native choice retained',source:attested.fact,native:current,citations:[cite(records.indexOf(attested)),native(donorId)]})
 }
 return {...source,records:undefined,findings,fingerprint:await sha256(JSON.stringify(source))}
}

/** Only the comparison receipt is stored: source and native facts remain in
 * their original custody, so an old analysis cannot resurrect erased evidence. */
export async function runMigration(c:Context,p:Row) {
 authorize(c)
 const version=integer(Number(p.version),'Review version',0)
 if(version!==await clock(c))fail('MIGRATION_CHANGED','Records changed since review. Refresh and compare again.',409)
 const result=await compareMigration(c,p)
 const key=await sha256(JSON.stringify([result.kind,result.jobId,result.fingerprint,version]))
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_migration_analysis_clock WHERE id=1 AND version=?)','MIGRATION_CHANGED','Records changed during analysis. Refresh and compare again.',version),
  sql('INSERT OR IGNORE INTO cf_migration_analyses(id,kind,job_id,native_version,fingerprint,created_at,created_by) VALUES(?,?,?,?,?,?,?)',key,result.kind,result.jobId,version,result.fingerprint,c.now,c.actor.id),
  event(c,'migration.compare','migration_analysis',key,null,{kind:result.kind,jobId:result.jobId,findings:result.findings.length})])
 return {id:key,status:'current',...result}
}

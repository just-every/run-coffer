import { stageSourceIndex } from './source-index'
import { customCustodyWrites } from './custom-custody'
import { buildCustomReview } from './custom-review-plan'
import { sourceRecords } from './custom-source-records'
import { customTagUndoGuards, customTagUndoWrites } from './custom-review-tags'
import { neonInput } from './neon'
import { importedAcknowledgmentEvents } from './acknowledgment-import'
import { spreadsheetAddresses } from './spreadsheet-addresses'
import { resolveSpreadsheetMatches } from './spreadsheet-matches'
import { spreadsheetDefinitionUndoGuards, spreadsheetDefinitionUndoWrites } from './spreadsheet-definitions'
import { customFields } from '../custom-fields'
import { importedCustomWrites, customImportUndoGuards, customImportUndoWrites } from './custom-fields'
import { solicitationImportHistory, restrictionReconciliation } from './solicitation-import'
import { manager } from '../auth'
import { all, commit, CofferError, date, event, fail, guard, one, optional, sha256, sql, today, type Context, type Row, type Stmt } from '../db'
import { settings } from '../settings'
import { parseExports } from './parse'
import { contentHash, planImport, type Plan } from './plan'
import { compare } from './reconcile'
import { importedHouseholdWrites, importHouseholdUndoFence, importHouseholdUndoWrites } from './household-writes'
import { stageParts } from './stage'
import { accumulate, emptyTotals } from './source-totals'
import { custodySnapshot, kinds, snapshot, tables, type Kind } from './tables'
import { compact, ordered, reportOf, store } from './review'
import type { Diagnostic, ParseInput, ParsedImport, SourceCoverage } from './types'

const APPLY_BUDGET_MS = 20_000
function confirmedNeonCurrency(job:Row) {
 if(job.source==='neon'&&JSON.parse(job.report).sourceCoverage?.currency!=='USD')fail('NEON_CURRENCY','This Neon review has no USD confirmation. Read and review it again before applying money.',409)
}
function authorize(c: Context) {if(!manager(c.actor))fail('manager_required','Only the owner or an admin moves records in.',403)}
export async function jobs(c: Context) {return all(c,"SELECT id,source,state,parts,applied_parts,created_at,json_extract(report,'$.canApply') AS can_apply FROM cf_move_in_jobs ORDER BY created_at DESC LIMIT 20")}
const summary=(p:ParsedImport)=>({...Object.fromEntries(['donors','households','gifts','pledges','installments','relationships','softCredits','notes'].map(k=>[k,((p as any)[k]??[]).length])),...(['givebutter','zeffy'].includes(p.source)?{recurringReferences:(p.recurringReferences??[]).length}:{}),solicitations:(p.solicitations??[]).length,channelWithdrawals:(p.channelWithdrawals??[]).filter(r=>!r.status||r.status==='withdrawn').length,...(['spreadsheet','givebutter','zeffy','neon'].includes(p.source)?{channelPreferences:(p.channelWithdrawals??[]).length}:{}),householdsWithHead:p.households.filter(h=>h.headExternalId).length,householdsWithoutHead:p.households.filter(h=>!h.headExternalId).length})

export async function spreadsheetMappings(c:Context) {
 authorize(c)
 const rows=await all(c,"SELECT id,report FROM cf_move_in_jobs WHERE source='spreadsheet' AND state IN ('completed','undone') AND redacted=0 ORDER BY created_at DESC,id DESC")
 const names=new Set<string>()
 return rows.flatMap(row=>{const report=JSON.parse(row.report),mapping=report.spreadsheet;if(!mapping||names.has(mapping.name))return [];names.add(mapping.name);return [{id:row.id,mapping:{...mapping,donorMatches:undefined},customFields:report.customFields??[],solicitCodes:report.solicitCodes??{}}]})
}

/** Reads and checks the whole export, plans every part against Coffer as apply will, then stores the review.
 * Donor records do not change. */
export async function preview(c: Context,input: ParseInput) {
 authorize(c)
 if(!input || !Array.isArray(input.files) || input.files.some(f=>!f||typeof f.name!=='string'||typeof f.base64!=='string'))fail('MOVE_IN_INPUT','Supply named CSV or XLSX files and their base64 contents.',400)
 // Reuse the last successfully reviewed code dictionary unless this review supplies one.
 if(input.solicitCodes===undefined) {
  const saved=await one(c,"SELECT json_extract(report,'$.solicitCodes') AS mapping FROM cf_move_in_jobs WHERE source=? AND state='completed' AND json_type(report,'$.solicitCodes')='object' ORDER BY created_at DESC LIMIT 1",input.source)
  if(saved?.mapping)input={...input,solicitCodes:JSON.parse(saved.mapping)}
 }
 if(input.source==='spreadsheet')input=await resolveSpreadsheetMatches(c,input)
 let sourceCoverage:SourceCoverage|undefined
 if(input.source==='neon'){
  if(input.neonExportCurrency!==undefined){
   if(input.neonExportCurrency!=='USD')fail('NEON_CURRENCY','Confirm that your Neon export records USD amounts before reviewing money. No conversion is performed.',400)
   sourceCoverage={currency:'USD',counts:{},unsupported:['Export history only; no Neon API read or provider qualification']}
  }else{const result=await neonInput(input,today((await settings(c)).timezone,new Date(c.now)));input=result.input;sourceCoverage=result.coverage}
 }
 const parsed=await parseExports(input)
 if(sourceCoverage)parsed.sourceCoverage=sourceCoverage
 const fileFingerprint=await contentHash({source:input.source,files:input.files.map(f=>f.base64).sort(),noGoodsOrServices:input.noGoodsOrServices===true,solicitCodes:input.solicitCodes??null,customFields:parsed.customFields,...(input.neonExportCurrency!==undefined?{neonExportCurrency:input.neonExportCurrency}:{}),...(input.source==='spreadsheet'?{spreadsheet:parsed.spreadsheet,...(input.deferCustomValues===true?{deferCustomValues:true}:{})}: {})})
 const id=fileFingerprint.slice(0,40)
 const prior=await one(c,'SELECT id,state,fingerprint,parts,applied_parts,redacted FROM cf_move_in_jobs WHERE file_fingerprint=?',fileFingerprint)
 if(prior?.redacted)parsed.diagnostics.push({severity:'error',code:'MOVE_IN_ERASED',message:'An imported constituent was erased. This move-in cannot restore their contact or history.'})
 if(prior?.state==='completed'&&!prior.redacted){
  const held=await one(c,'SELECT report FROM cf_move_in_jobs WHERE id=?',prior.id)
  if(JSON.parse(held!.report).sourceIndexComplete!==true)await stageSourceIndex(c,prior.id,input.source,sourceRecords(parsed))
 }
 const parts=stageParts(parsed),nativeDonors=new Set<string>()
 // A bad source row must not hide independent conflicts elsewhere in the files.
 if(!prior || ['reviewed','undone'].includes(prior.state)) {
  const seen=new Set(parsed.diagnostics.map(d=>`${d.code}|${d.file}|${d.sheet}|${d.row}|${d.column}|${d.message}`))
  for(const part of parts) {
   const plan=await planImport(c,part,{preview:true})
   for(const [externalId,id] of plan.donorIds){nativeDonors.add(id);const donor=part.donors.find(d=>d.externalId===externalId);if(donor)donor.expectedNativeId=id}
   for(const d of plan.diagnostics) {
    const key=`${d.code}|${d.file}|${d.sheet}|${d.row}|${d.column}|${d.message}`
    if(!seen.has(key)){seen.add(key);parsed.diagnostics.push(d as Diagnostic)}
   }
  }
 }
 const rows=compare(parsed)
 const restrictionIds=[...new Set([...(parsed.solicitations??[]),...(parsed.channelWithdrawals??[]).filter(r=>!r.status||r.status==='withdrawn')].map(r=>r.donorExternalId))]
 for(const [key,count] of [['Restricted constituents',restrictionIds.length],['Solicitation restrictions',(parsed.solicitations??[]).length],...['email','mail','phone','sms'].map(channel=>[`${channel} withdrawals`,(parsed.channelWithdrawals??[]).filter(r=>r.channel===channel&&(!r.status||r.status==='withdrawn')).length])] as [string,number][])rows.push({scope:'restriction',key,sourceCount:count,cofferCount:count,sourceCents:null,cofferCents:0,matches:true})
 const diagnostics=ordered(parsed.diagnostics)
 const fingerprint=await contentHash({fileFingerprint,rows,diagnostics})
 const canApply=!diagnostics.some(d=>d.severity==='error'), needsAcceptance=rows.some(r=>!r.matches)||parsed.unmapped.length>0, counts=summary(parsed)
 if(!prior || ['reviewed','undone'].includes(prior.state)){
  await store(c,{id,fileFingerprint,fingerprint,source:input.source,prior,report:{...reportOf(parsed,{rows,canApply,needsAcceptance,counts,parts:canApply?parts.length:0}),...(input.source==='spreadsheet'?{spreadsheetNativeDonors:[...nativeDonors]}:{}),previewNativeDonors:[...nativeDonors],spreadsheet:parsed.spreadsheet,customFields:parsed.customFields,sourceColumns:parsed.sourceColumns,customDefinitions:await customFields(c),...(parsed.columnDefinitions?.length?{customReview:await buildCustomReview(parsed.columnDefinitions,parsed.columnMappings??[],[],1)}:{})},parts:canApply?parts:[],issues:diagnostics.filter(d=>d.code!=='UNMAPPED')})
  await stageSourceIndex(c,id,input.source,sourceRecords(parsed))
 }
 return { ...parsed, id, fingerprint, fileFingerprint, reconciliation:rows, diagnostics, counts, parts:canApply?parts.length:0,
  prior:prior?.state==='completed'||prior?.state==='applying'?prior:null, canApply, needsAcceptance }
}

/** Approves the staged review and applies its first parts. */
export async function apply(c: Context,input:{id:string;fingerprint:string;acceptedReason?:string;acknowledged?:string;acknowledgedBefore?:string;acknowledgeFrom?:string}) {
 authorize(c)
 const job=await one(c,'SELECT * FROM cf_move_in_jobs WHERE id=?',String(input.id??''))
 if(!job)fail('MOVE_IN_CHANGED','Upload the exports and review them again.',409)
 if(job.redacted)fail('MOVE_IN_ERASED','A donor in this move-in was erased. This review cannot restore their records.',409)
 confirmedNeonCurrency(job)
 if(job.state==='completed')return {id:job.id,state:'completed',unchanged:true,parts:job.parts,appliedParts:job.applied_parts}
 if(job.state==='applying')return continueApply(c,job.id)
 if(job.state!=='reviewed' || !job.fingerprint || input.fingerprint!==job.fingerprint)fail('MOVE_IN_CHANGED','The files changed after review. Upload them and review again.',409)
 const report=JSON.parse(job.report)
 if(report.sourceIndexComplete===false)fail('MOVE_IN_CHANGED','The source index is incomplete. Preview the exports again.',409)
 if(report.canApply===false || !job.parts)fail('MOVE_IN_ERRORS','This review has rows that must be fixed first. Fix them in your files and upload them again.',409)
 const acceptedReason=optional(input.acceptedReason,'Reason for accepting differences',2000)
 if(report.needsAcceptance && !acceptedReason)fail('MOVE_IN_TOTALS','Say why the differences or unused columns are acceptable before moving in, or fix the files and upload again.')
 const acknowledgeFrom=input.acknowledgeFrom?date(input.acknowledgeFrom,'Acknowledge from'):null
 if(acknowledgeFrom&&c.actor.role!=='owner')fail('FORBIDDEN','Only the owner sets the installation acknowledge-from date during move-in.',403)
 const acknowledgedBefore=input.acknowledged==='no'?null:date(input.acknowledgedBefore||today((await settings(c)).timezone,new Date(c.now)),'Thanked before')
 await commit(c,[guard("EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND state='reviewed' AND fingerprint=?)",'MOVE_IN_CHANGED','This move-in changed. Review it again.',job.id,job.fingerprint),
  ...(acknowledgeFrom?[sql('UPDATE cf_receipt_autonomy SET version=version+1,acknowledge_from=?,updated_at=?,updated_by=? WHERE id=1',acknowledgeFrom,c.now,c.actor.id),event(c,'agent.receipts.cutoff','receipt_autonomy','1',null,{acknowledgeFrom,moveInId:job.id})]:[]),
  sql("UPDATE cf_move_in_jobs SET state='applying',accepted_reason=?,acknowledged_before=?,created_at=?,created_by=? WHERE id=?",acceptedReason,acknowledgedBefore,c.now,c.actor.name,job.id),
  event(c,'move-in.apply','move-in',job.id,null,{source:job.source,counts:report.counts,parts:job.parts,acceptedDifferences:!!acceptedReason,acknowledgedBefore})])
 return continueApply(c,job.id)
}

/** Applies parts in order until the time budget runs out. Safe to repeat: each part applies once. */
export async function continueApply(c: Context,id:string) {
 authorize(c)
 const started=Date.now()
 for(;;) {
  const job=await one(c,'SELECT * FROM cf_move_in_jobs WHERE id=?',id)
  if(!job)fail('NOT_FOUND','That move-in does not exist.',404)
  if(job.redacted)fail('MOVE_IN_ERASED','A donor in this move-in was erased. This review cannot continue.',409)
  confirmedNeonCurrency(job)
  if(job.state!=='applying')return {id,state:job.state,parts:job.parts,appliedParts:job.applied_parts,unchanged:true}
  const next=await one(c,'SELECT position,payload FROM cf_move_in_parts WHERE job_id=? AND applied_at IS NULL ORDER BY position LIMIT 1',id)
  if(!next){await finish(c,job);return {id,state:'completed',parts:job.parts,appliedParts:job.parts,unchanged:false}}
  if(Date.now()-started>APPLY_BUDGET_MS)return {id,state:'applying',parts:job.parts,appliedParts:job.applied_parts,unchanged:false}
  const part=JSON.parse(next.payload) as ParsedImport, plan=await planImport(c,part), errors=plan.diagnostics.filter(d=>d.severity==='error')
  if(errors.length)fail('MOVE_IN_ERRORS',`Part ${next.position+1} of ${job.parts} (${contents(part)}) could not be applied. ${errors.length} row${errors.length===1?'':'s'}: ${errors.slice(0,5).map(d=>`${d.file} row ${d.row}: ${d.message}`).join(' ')} Nothing from this part was saved; the ${job.applied_parts} part${job.applied_parts===1?'':'s'} before it stay in Coffer. Fix the record in Coffer and press Continue, or undo the whole move-in.`,409,errors.slice(0,50))
  const addresses=part.source==='spreadsheet'?await spreadsheetAddresses(c,plan):[]
  const writes:Stmt[]=[...plan.checks,guard('EXISTS(SELECT 1 FROM cf_move_in_parts WHERE job_id=? AND position=? AND applied_at IS NULL)','MOVE_IN_CHANGED','This part was applied in another window. Refresh the journal.',id,next.position)]
  writes.push(sql('INSERT INTO cf_identity_ingest VALUES(1)'))
  for(const kind of kinds)writeKind(writes,plan,kind,job.source,id)
  writes.push(...addresses)
  writes.push(...importedAcknowledgmentEvents(c,plan,job.source,id))
  writes.push(...await importedCustomWrites(c,plan,job.source,id))
  writes.push(...solicitationImportHistory(c,plan.effects,job.source,id))
  writes.push(...importedHouseholdWrites(c,plan.householdChanges,job.source,id))
  if(job.acknowledged_before)writes.push(sql(`INSERT OR IGNORE INTO cf_prior_acknowledgements(gift_id,job_id,acknowledged_before) SELECT json_extract(value,'$.id'),?,? FROM json_each(?) WHERE json_extract(value,'$.received_on')<?`,id,job.acknowledged_before,JSON.stringify(plan.effects.filter(e=>e.kind==='gift'&&e.owned).map(e=>({id:e.nativeId,received_on:e.row.received_on}))),job.acknowledged_before))
  const jobGifts=await Promise.all(part.gifts.map(async g=>({giftId:plan.giftIds.get(g.externalId),donorKey:await sha256(g.donorExternalId)})))
  writes.push(sql("INSERT OR IGNORE INTO cf_move_in_job_gifts(job_id,gift_id,donor_source_key) SELECT ?,json_extract(value,'$.giftId'),json_extract(value,'$.donorKey') FROM json_each(?)",id,JSON.stringify(jobGifts)))
  writes.push(sql('UPDATE cf_move_in_parts SET applied_at=? WHERE job_id=? AND position=?',c.now,id,next.position),sql('UPDATE cf_move_in_jobs SET applied_parts=applied_parts+1 WHERE id=?',id))
  writes.push(sql('DELETE FROM cf_identity_ingest'))
  try {await commit(c,writes)} catch(error) {
   if(error instanceof CofferError && !UNIQUE_CODES[error.code])throw error
   await partFailed(c,job,next.position,part,plan,error)
  }
 }
}

async function finish(c: Context,job: Row) {
 const check=await totalsCheck(c,job)
 await commit(c,[...await customCustodyWrites(c,job.id,job.source),sql("UPDATE cf_move_in_jobs SET state='completed',checked_at=?,check_report=? WHERE id=? AND state='applying'",c.now,JSON.stringify(check),job.id),sql('DELETE FROM cf_move_in_parts WHERE job_id=?',job.id),
  event(c,'move-in.complete','move-in',job.id,null,{parts:job.parts,totalsMatch:check.matches})])
}
/** Source totals from the files against the gifts now in Coffer for this move-in. */
async function totalsCheck(c: Context,job: Row) {
 const report=JSON.parse(job.report)
 if(!report.sourceTotals)return {matches:false,rows:[]}
 // Donors from any earlier move-in from the same CRM count under their CRM ID, as in the files.
 const donorKeys=await all(c,"SELECT source_key,native_id FROM cf_move_in_records WHERE source=? AND kind='donor'",job.source)
 const byNative=new Map(donorKeys.map(r=>[r.native_id,r.source_key])), external=new Map<string,string>()
 for(const id of Object.keys(report.sourceTotals.byDonor))external.set(await sha256(id),id)
 const destination=emptyTotals()
 for(const g of await all(c,"SELECT g.received_on,g.fund,g.donor_id,r.donor_source_key,b.net_cents FROM cf_move_in_job_gifts r JOIN cf_gifts g ON g.id=r.gift_id JOIN cf_gift_balances b ON b.id=g.id WHERE r.job_id=?",job.id))
  if(g.net_cents>0)accumulate(destination,g.net_cents,g.received_on,g.fund??'',external.get(g.donor_source_key??byNative.get(g.donor_id)??'')??g.donor_id)
 const rows=compare({sourceTotals:report.sourceTotals,controlTotals:report.controlTotals??[]} as ParsedImport,destination)
 rows.push(...await restrictionReconciliation(c,job.source,report))
 return {matches:rows.every(r=>r.matches),...compact(rows)}
}
export async function recheck(c: Context,id:string) {
 authorize(c)
 const job=await one(c,"SELECT * FROM cf_move_in_jobs WHERE id=? AND state='completed'",id)
 if(!job)fail('NOT_FOUND','Only a finished move-in can be checked.',404)
 const check=await totalsCheck(c,job)
 await c.db.prepare('UPDATE cf_move_in_jobs SET checked_at=?,check_report=? WHERE id=?').bind(c.now,JSON.stringify(check),id).run()
 return {id,...check}
}

function writeKind(writes:Stmt[],plan:Plan,kind:Kind,source:string,jobId:string) {
 const effects=plan.effects.filter(e=>e.kind===kind);if(!effects.length)return
 if(kind==='contact'){
  const donorIds=[...new Set(effects.filter(e=>e.owned).map(e=>e.donorId))]
  // Only newly owned donors have contact effects. Replace the automatically
  // mirrored primary rows before inserting the complete reviewed contact set.
  writes.push(sql('DELETE FROM cf_contact_history WHERE donor_id IN(SELECT value FROM json_each(?))',JSON.stringify(donorIds)),sql('DELETE FROM cf_contact_points WHERE donor_id IN(SELECT value FROM json_each(?))',JSON.stringify(donorIds)))
 }
 const t=tables[kind], rows=JSON.stringify(effects.map(e=>({...e.row,_owned:e.owned?1:0})))
 writes.push(sql(`INSERT INTO ${t.table}(${t.columns.join(',')}) SELECT ${t.columns.map(k=>kind==='household'&&['head_donor_id','head_source','head_imported_at'].includes(k)?'NULL':`json_extract(value,'$.${k}')`).join(',')} FROM json_each(?) WHERE json_extract(value,'$._owned')=1`,rows))
 const records=JSON.stringify(effects.map(e=>({sourceKey:e.sourceKey,contentHash:e.contentHash,nativeId:e.nativeId,owned:e.owned?1:0,donorId:e.donorId,relatedId:e.relatedId})))
 writes.push(sql(`INSERT INTO cf_move_in_records(source,kind,source_key,native_id,content_hash,job_id,owned,donor_id,related_id,snapshot)
 SELECT ?,?,json_extract(j.value,'$.sourceKey'),n.${t.key},json_extract(j.value,'$.contentHash'),?,json_extract(j.value,'$.owned'),json_extract(j.value,'$.donorId'),json_extract(j.value,'$.relatedId'),${snapshot(kind)}
 FROM json_each(?) j JOIN ${t.table} n ON n.${t.key}=json_extract(j.value,'$.nativeId')`,source,kind,jobId,records))
}

export async function journal(c: Context,id:string):Promise<{job:Row;records:Row[]}> {
 authorize(c)
 const job=await one(c,'SELECT * FROM cf_move_in_jobs WHERE id=?',id)
 if(!job)fail('NOT_FOUND','That import does not exist.',404)
 const records=await all(c,'SELECT kind,count(*) AS n,sum(owned) AS added FROM cf_move_in_records WHERE job_id=? GROUP BY kind ORDER BY kind',id)
 return {job:{...job,report:JSON.parse(job.report),check_report:job.check_report?JSON.parse(job.check_report):null},records}
}

/** Every guard and every deletion share one transaction. Any new use blocks it. */
export async function undo(c: Context,id:string) {
 authorize(c)
 const result=await journal(c,id)
 if(result.job.state==='undone')return {id,state:'undone',unchanged:true}
 if(result.job.state==='reviewed')fail('MOVE_IN_CHANGED','Nothing from this review has been moved in yet.',409)
 if(result.job.redacted)fail('MOVE_IN_USED','An imported donor was erased. This import can no longer be undone.')
 const writes:Stmt[]=[guard("EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND state IN ('applying','completed') AND redacted=0)",'MOVE_IN_CHANGED','This import changed. Refresh its journal.',id)]
 for(const kind of kinds) {
  const t=tables[kind]
  writes.push(guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records r LEFT JOIN ${t.table} n ON n.${t.key}=r.native_id WHERE r.job_id=? AND r.kind=? AND (n.${t.key} IS NULL OR r.snapshot IS NULL OR ${snapshot(kind)}<>${custodySnapshot(kind)}))`,'MOVE_IN_USED','Imported records changed since the move-in. Nothing was undone.',id,kind))
 }
 writes.push(importHouseholdUndoFence(id),...customImportUndoGuards(id),...customTagUndoGuards(id))
 if(['spreadsheet','givebutter','zeffy','neon'].includes(result.job.source))writes.push(...spreadsheetDefinitionUndoGuards(id))
 const owned=(kind:Kind)=>`SELECT native_id FROM cf_move_in_records WHERE job_id=? AND kind='${kind}' AND owned=1`
 if(result.job.source==='spreadsheet')writes.push(guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records r JOIN cf_address_checks a ON a.donor_id=r.native_id WHERE r.job_id=? AND r.kind='donor' AND r.owned=1 AND (a.version<>1 OR a.source<>'smarty' OR a.checked_at<>json_extract(r.snapshot,'$.created_at')))`,'MOVE_IN_USED','An imported address was checked again. Nothing was undone.',id))
 writes.push(guard(`NOT EXISTS(SELECT 1 FROM cf_contact_points p WHERE p.donor_id IN (${owned('donor')}) AND (p.version<>1 OR p.is_primary<>1) AND p.id NOT IN(SELECT native_id FROM cf_move_in_records WHERE job_id=? AND kind='contact' AND owned=1))`,'MOVE_IN_USED','A contact point was edited or added after this import. Nothing was undone.',id,id))
 writes.push(guard(`NOT EXISTS(SELECT 1 FROM cf_donor_tags t WHERE t.donor_id IN (${owned('donor')}) AND NOT EXISTS(SELECT 1 FROM cf_move_in_records r WHERE r.job_id=? AND r.kind='customTag' AND r.donor_id=t.donor_id AND json_extract(r.snapshot,'$.tag')=t.tag))`,'MOVE_IN_USED','Someone added a tag after import. Nothing was undone.',id,id))
 writes.push(guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records r JOIN cf_move_in_jobs j ON j.id=r.job_id WHERE r.job_id<>? AND r.kind='customCapture' AND j.state IN('applying','completed') AND r.donor_id IN (${owned('donor')}))`,'MOVE_IN_USED','A later source review uses these donors. Undo that review first.',id,id))
 const dependencies:[string,string,Kind,Kind|null,string][]=[
  ['cf_recurring_source_references','donor_id','donor','recurringReference','id'],['cf_platform_gifts','gift_id','gift','platformGift','gift_id'],
  ['cf_auction_rows','donor_id','donor',null,'id'],['cf_auction_rows','gift_id','gift',null,'id'],
  ['cf_development_report_donors','donor_id','donor',null,'report_id'],
  ['cf_hygiene_evidence','donor_id','donor',null,'id'],['cf_hygiene_proposals','donor_id','donor',null,'id'],['cf_hygiene_proposals','related_donor_id','donor',null,'id'],
  ['cf_gift_tributes','notification_donor_id','donor',null,'gift_id'],
  ['cf_acks','household_id','household',null,'id'],
  ['cf_gifts','donor_id','donor','gift','id'],['cf_pledges','donor_id','donor','pledge','id'],['cf_relationships','donor_id','donor','relationship','id'],['cf_relationships','related_donor_id','donor','relationship','id'],
  ['cf_soft_credits','donor_id','donor','softCredit','id'],['cf_soft_credits','gift_id','gift','softCredit','id'],['cf_donor_notes','donor_id','donor','note','id'],['cf_interactions','donor_id','donor','interaction','id'],
  ['cf_gift_acknowledgments','gift_id','gift','acknowledgment','gift_id'],
  ['cf_gift_acknowledgments','interaction_id','interaction','acknowledgment','gift_id'],
  ['cf_soft_credit_acknowledgments','interaction_id','interaction','softCreditAcknowledgment','soft_credit_id'],
  ['cf_soft_credit_acknowledgments','note_id','note','softCreditAcknowledgment','soft_credit_id'],
  ['cf_soft_credit_acknowledgments','soft_credit_id','softCredit','softCreditAcknowledgment','soft_credit_id'],
  ['cf_donors','household_id','household','donor','id'],['cf_pledge_installments','pledge_id','pledge','installment','id'],['cf_pledge_allocations','installment_id','installment','allocation','id'],['cf_pledge_allocations','gift_id','gift','allocation','id'],
  ['cf_consents','donor_id','donor','consent','id'],['cf_solicitation','donor_id','donor','solicitation','donor_id'],['cf_solicitation_asks','donor_id','donor',null,'donor_id'],['cf_solicitation_recipients','donor_id','donor',null,'donor_id'],['cf_solicitation_inclusions','donor_id','donor',null,'donor_id'],['cf_acks','gift_id','gift',null,'id'],['cf_appeal_recipients','donor_id','donor',null,'donor_id'],['cf_gift_tributes','gift_id','gift','tribute','gift_id'],['cf_tribute_notifications','gift_id','gift',null,'id'],['cf_employer_matches','gift_id','gift',null,'id'],['cf_gifts','reverses','gift',null,'id'],['cf_gift_allocations','gift_id','gift',null,'id'],
  ['cf_planned_gifts','donor_id','donor',null,'id'],['cf_legacy_memberships','donor_id','donor',null,'id'],['cf_planned_distributions','gift_id','gift',null,'gift_id'],
  ['cf_donor_recognition','donor_id','donor','recognition','donor_id'],['cf_gift_recognition','gift_id','gift',null,'gift_id'],
  ['cf_research_results','donor_id','donor',null,'id'],
  ['cf_volunteering','donor_id','donor',null,'id'],
  ['cf_in_kind_gifts','donor_id','donor',null,'id'],
  ['cf_pledge_adjustments','pledge_id','pledge',null,'id'],['cf_pledge_plans','pledge_id','pledge',null,'pledge_id'],
  ['cf_record_documents','donor_id','donor',null,'id'],['cf_record_documents','gift_id','gift',null,'id'],['cf_record_documents','pledge_id','pledge',null,'id'],
  ['cf_grants','donor_id','donor',null,'id'],['cf_grants','pledge_id','pledge',null,'id'],
  ['cf_prospects','donor_id','donor',null,'id'],['cf_prospects','pledge_id','pledge',null,'id'],['cf_prospects','gift_id','gift',null,'id'],['cf_call_tasks','donor_id','donor',null,'id'],['cf_call_tasks','interaction_id','interaction',null,'id'],
 ]
 for(const [table,fk,parent,child,key] of dependencies)writes.push(guard(`NOT EXISTS(SELECT 1 FROM ${table} WHERE ${fk} IN (${owned(parent)})${child?` AND ${key} NOT IN (${owned(child)})`:''})`,'MOVE_IN_USED','Someone has used these imported records. Nothing was undone.',id,...(child?[id]:[])))
 writes.push(guard(`NOT EXISTS(SELECT 1 FROM cf_custom_values v WHERE (v.donor_id IN (${owned('donor')}) OR v.record_id IN(SELECT native_id FROM cf_move_in_records WHERE job_id=? AND owned=1)) AND NOT EXISTS(SELECT 1 FROM cf_move_in_records r WHERE r.job_id=? AND r.kind='customValue' AND r.native_id=v.record_id AND json_extract(r.snapshot,'$.field_key')=v.field_key))`,'MOVE_IN_USED','Custom values were added after this move-in. Nothing was undone.',id,id,id))
 writes.push(guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_job_gifts WHERE job_id<>? AND gift_id IN (${owned('gift')}))`,'MOVE_IN_USED','A later move-in counts gifts from this one. Undo that move-in first.',id,id))
 // This transaction-local marker authorizes only exact snapshot-owned consent
 // deletions in the migration's append-only exception. Failed guards roll it back.
 writes.push(sql("UPDATE cf_move_in_jobs SET report=json_set(report,'$.solicitationUndoInProgress',json('true')) WHERE id=?",id))
 writes.push(sql(`DELETE FROM cf_solicitation_history WHERE donor_id IN (${owned('solicitation')})`,id))
 writes.push(...customTagUndoWrites(id),...customImportUndoWrites(id))
 if(['spreadsheet','givebutter','zeffy','neon'].includes(result.job.source))writes.push(...spreadsheetDefinitionUndoWrites(id))
 writes.push(...importHouseholdUndoWrites(c,id))
 writes.push(sql('DELETE FROM cf_prior_acknowledgements WHERE job_id=?',id),sql('DELETE FROM cf_move_in_job_gifts WHERE job_id=?',id))
 writes.push(sql(`DELETE FROM cf_contact_history WHERE donor_id IN (${owned('donor')})`,id),sql(`DELETE FROM cf_contact_points WHERE donor_id IN (${owned('donor')})`,id))
 if(result.job.source==='spreadsheet')writes.push(sql(`DELETE FROM cf_address_checks WHERE donor_id IN (${owned('donor')})`,id))
 for(const kind of [...kinds].reverse()) {const t=tables[kind];writes.push(sql(`DELETE FROM ${t.table} WHERE ${t.key} IN (${owned(kind)})`,id))}
 // Retained source reviews still need donor erasure custody after undo releases import ownership.
 writes.push(sql('DELETE FROM cf_move_in_records WHERE job_id=?',id),sql('DELETE FROM cf_move_in_parts WHERE job_id=?',id),sql("UPDATE cf_move_in_jobs SET state='undone',undone_at=?,applied_parts=0,report=json_remove(report,'$.solicitationUndoInProgress') WHERE id=?",c.now,id),event(c,'move-in.undo','move-in',id,null))
 try {await commit(c,writes)} catch(error) {
  if(/FOREIGN KEY constraint failed/i.test(String(error)))fail('MOVE_IN_USED','Other records now use this import. Nothing was undone.')
  throw error
 }
 return {id,state:'undone',unchanged:false}
}

const kindName: Record<string,string> = {donors:'donors',households:'households',gifts:'gifts',pledges:'pledges',installments:'installments',relationships:'relationships',softCredits:'soft credits',notes:'notes'}
/** What a part holds, in the files' own terms: counts and the source rows it came from. */
function contents(part: ParsedImport) {
 const main=(['gifts','softCredits','relationships','pledges','notes','donors'] as const).find(k=>part[k].length)||'donors'
 const rows=part[main].map(x=>x.location), files=[...new Set(rows.map(l=>l.file))]
 return `${part[main].length} ${kindName[main]} from ${files.map(f=>{const r=rows.filter(l=>l.file===f).map(l=>l.row);return `${f} rows ${Math.min(...r)}–${Math.max(...r)}`}).join(', ')}`
}
const label=(kind: Kind)=>({contact:'contact point',solicitation:'solicitation restriction',consent:'channel withdrawal',softCredit:'soft credit',household:'household',donor:'donor',gift:'gift',tribute:'gift tribute',acknowledgment:'gift acknowledgment',softCreditAcknowledgment:'soft-credit acknowledgment',pledge:'pledge',installment:'installment',campaign:'gift appeal',channel:'gift channel',allocation:'pledge payment',relationship:'relationship',note:'note',interaction:'conversation',platformGift:'source transaction',recurringReference:'recurring source reference'} as Record<Kind,string>)[kind]
/** Unique indexes that commit() reports by name. */
const UNIQUE_CODES: Record<string,[string,string[]]> = {DUPLICATE_EMAIL:['cf_donors',['email']],DUPLICATE_REFERENCE:['cf_gifts',['source','reference']],DUPLICATE_HOUSEHOLD:['cf_households',['name']]}
/** A database refusal names its part, the rows behind it and the reason, never only "the operation failed". */
async function partFailed(c: Context,job: Row,position: number,part: ParsedImport,plan: Plan,error: unknown): Promise<never> {
 const text=String(error instanceof Error?error.message:error), unique=/UNIQUE constraint failed: ([a-z_]+)\.([a-z_]+(?:, [a-z_]+\.[a-z_]+)*)/i.exec(text)
 const known=error instanceof CofferError?UNIQUE_CODES[error.code]:undefined
 let reason='the database refused it', rows: Plan['effects'] = []
 if(unique || known) {
  const table=known?known[0]:unique![1], columns=known?known[1]:unique![2].split(', ').map(x=>x.split('.')[1]), kind=kinds.find(k=>tables[k].table===table)
  const effects=plan.effects.filter(e=>e.kind===kind&&e.owned), groups=new Map<string,typeof effects>(), value=(e: Plan['effects'][number])=>columns.map(k=>String(e.row[k]??'').toLowerCase()).join('\u0000')
  for(const e of effects)groups.set(value(e),[...(groups.get(value(e))??[]),e])
  rows=[...groups.values()].filter(g=>g.length>1).flat()
  // The other copy may already be in Coffer: find those rows too.
  const held=new Set((await all(c,`SELECT ${columns.map(k=>`lower(${k})`).join("||char(0)||")} AS v FROM ${table} WHERE ${columns.map(k=>`lower(${k})`).join("||char(0)||")} IN (SELECT value FROM json_each(?))`,JSON.stringify(effects.map(value)))).map(r=>r.v))
  rows.push(...effects.filter(e=>held.has(value(e))))
  reason=`${kind?label(kind):table} records would share one ${columns.filter(k=>k!=='source').join(' and ')}, ${held.size?'with a record already in Coffer':'within this part'}`
 } else if(/FOREIGN KEY/i.test(text)) reason='a record it links to is not in Coffer'
 else if(/CHECK constraint/i.test(text)) reason='a value is outside what Coffer accepts'
 else if(/too (big|large)|limit/i.test(text)) reason='it is larger than one database request allows'
 const named=[...new Set(rows.filter(e=>e.location).map(e=>`${e.location!.file} row ${e.location!.row}`))]
 return fail('MOVE_IN_PART_FAILED',`Part ${position+1} of ${job.parts} (${contents(part)}) could not be applied: ${reason}.${named.length?` Rows: ${named.slice(0,20).join(', ')}${named.length>20?` and ${named.length-20} more`:''}.`:''} Nothing from this part was saved; the ${job.applied_parts} part${job.applied_parts===1?'':'s'} before it stay in Coffer. Fix those rows in your files and preview them again, or change the record in Coffer and press Continue, or undo this move-in.`,409,{part:position+1,parts:job.parts,reason:text,rows:rows.filter(e=>e.location).slice(0,100).map(e=>e.location)})
}

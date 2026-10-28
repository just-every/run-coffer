import { canonicalDonor } from '../donor-merge'
import { readSourceIndex } from './source-index'
import { customCustodyWrites } from './custom-custody'
import { readSourceCustom, type SourceCredentials } from './source-custom-reader'
import { customFields } from '../custom-fields'
import { all, commit, event, fail, guard, one, sha256, sql, type Context, type Row, type Stmt } from '../db'
import { importedCustomWrites, type CustomImportWrite } from './custom-fields'
import { createImportDefinitionWrites } from './custom-definition-undo'
import { buildCustomReview, defaultMappings } from './custom-review-plan'
import type { CustomReview, FieldMapping, ValueResolution } from './custom-review-types'
import type { Plan } from './plan'
import { customTagWrites } from './custom-review-tags'

export async function customReview(c:Context,id:string) {
 const job=await one(c,"SELECT * FROM cf_move_in_jobs WHERE id=? AND state='completed' AND redacted=0",id)
 if(!job)fail('MOVE_IN_CHANGED','Choose a finished, unerased CRM import.',409)
 return {...job,rawReport:job.report,report:JSON.parse(job.report)} as Row
}
const fence=(id:string,report:string)=>guard("EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND state='completed' AND redacted=0 AND report=?)",'MOVE_IN_CHANGED','This custom review changed. Refresh it before continuing.',id,report)
export async function captureCustom(c:Context,input:SourceCredentials&{id:string}) {
 const job=await customReview(c,input.id)
 if(!['bloomerang','lgl','re-nxt','neon'].includes(job.source))fail('CUSTOM_SOURCE','Choose one of the current CRM sources for custom enrichment.',400)
 if(job.report.customReview)return {id:job.id,review:job.report.customReview,unchanged:true}
 const records=await readSourceIndex(c,job.id)

 await commit(c,await customCustodyWrites(c,job.id,job.source))
 const definitions=await readSourceCustom(job.source,input,records)
 const previous=await one(c,"SELECT json_extract(report,'$.customReview.mappings') AS mappings FROM cf_move_in_jobs WHERE source=? AND id<>? AND state='completed' AND redacted=0 AND json_type(report,'$.customReview.mappings')='array' ORDER BY created_at DESC LIMIT 1",job.source,job.id)
 const review=await buildCustomReview(definitions,defaultMappings(job.source,definitions,previous?.mappings?JSON.parse(previous.mappings):[],await customFields(c)),[],1)
 await commit(c,[fence(job.id,job.rawReport),sql("UPDATE cf_move_in_jobs SET report=json_set(report,'$.customReview',json(?)) WHERE id=?",JSON.stringify(review),job.id),event(c,'move-in.custom.capture','move-in',job.id,null,{definitions:definitions.length})])
 return {id:job.id,review,unchanged:false}
}
export async function reviseCustom(c:Context,input:{id:string;version:number;mappings:FieldMapping[];resolutions:ValueResolution[]}) {
 const job=await customReview(c,input.id),previous=job.report.customReview as CustomReview|undefined
 if(!previous||input.version!==previous.version)fail('MOVE_IN_CHANGED','This custom review changed. Refresh it.',409)
 if(previous.applied&&JSON.stringify(input.mappings)!==JSON.stringify(previous.mappings))fail('MOVE_IN_USED','Values already moved in. Undo this import before changing its field mapping.',409)
 const review=await buildCustomReview(previous.definitions,input.mappings,input.resolutions,previous.version+1)
 if(previous.applied&&previous.values.some(v=>(previous.appliedValues??[]).includes(v.id)&&!review.values.some(next=>next.id===v.id&&next.state==='ready'&&next.value===v.value)))fail('MOVE_IN_USED','A carried value cannot be replaced or skipped. Undo before changing it.',409)
 if(previous.applied){review.applied=1;review.appliedValues=previous.appliedValues??[]}
 await commit(c,[fence(job.id,job.rawReport),sql("UPDATE cf_move_in_jobs SET report=json_set(report,'$.customReview',json(?)) WHERE id=?",JSON.stringify(review),job.id),event(c,'move-in.custom.review','move-in',job.id,null,{version:review.version,waiting:review.values.filter(v=>v.state==='waiting').length})])
 return {id:job.id,review}
}

/** Exact source custody and native authority are checked again in the write transaction. */
export async function applyCustom(c:Context,input:{id:string;version:number}) {
 const job=await customReview(c,input.id),review=job.report.customReview as CustomReview|undefined
 if(!review||input.version!==review.version)fail('MOVE_IN_CHANGED','This custom review changed. Refresh it.',409)
 const fields=await customFields(c),customWrites:CustomImportWrite[]=[],writes:Stmt[]=[fence(job.id,job.rawReport)],records=await readSourceIndex(c,job.id)
 let tagAssignments=0
 const staged=new Set<string>(),custody=await all(c,'SELECT * FROM cf_move_in_records WHERE source=?',job.source)
 for(const value of review.values.filter(v=>v.state==='ready')){
  const definition=review.definitions.find(d=>d.id===value.fieldId)!,mapping=review.mappings.find(m=>m.id===value.fieldId)!,record=records.find(r=>r.kind===definition.kind&&r.externalId===value.recordId)
  if(!record)fail('CUSTOM_RECORD','A source value has no reviewed source record.',409)
  const kind=record.kind==='constituent'?'donor':record.kind,recordKey=await sha256(record.externalId)
  const native=custody.find(r=>r.kind===kind&&r.source_key===recordKey)
  if(!native?.snapshot||!native.donor_id)fail('MOVE_IN_CHANGED','A source record was erased or changed. Review the original import.',409)
  const donorId=await canonicalDonor(c,native.donor_id)
  writes.push(guard('EXISTS(SELECT 1 FROM cf_move_in_records WHERE source=? AND kind=? AND source_key=? AND native_id=? AND snapshot IS NOT NULL) AND COALESCE((SELECT into_id FROM cf_donor_merges WHERE donor_id=?),?)=? AND EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','MOVE_IN_CHANGED','This imported record is no longer current.',job.source,kind,recordKey,native.native_id,native.donor_id,native.donor_id,donorId,donorId,donorId))
  if(mapping.action==='tags'){const tags=await customTagWrites(c,job.source,job.id,definition,value,{...native,donor_id:donorId});writes.push(...tags.writes);tagAssignments+=tags.added;continue}
  const m=mapping.field!,held=fields.find(f=>f.key===m.key),sourceKey=await sha256(JSON.stringify([kind,record.externalId,m.key])),hash=await sha256(JSON.stringify([kind,record.externalId,m.key,value.value]))
  const prior=custody.find(r=>r.kind==='customValue'&&r.source_key===sourceKey)
  if(prior){if(prior.content_hash!==hash||!prior.snapshot)fail('MOVE_IN_CHANGED','An already carried source value changed. Undo before replacing it.',409);continue}
  if(held&&(held.kind!==m.kind||held.type!==m.type||held.entry!==m.entry||held.choices!==JSON.stringify(m.choices)||held.label!==m.label||m.version&&held.version!==m.version))fail('MOVE_IN_CHANGED','A target field changed after review. Refresh its mapping.',409)
  if(!held&&m.version)fail('MOVE_IN_CHANGED','A selected existing field was removed.',409)
  const recordId=kind==='donor'?donorId:native.native_id
  const field=held??{...m,choices:JSON.stringify(m.choices),version:1,created_at:c.now}
  if(!staged.has(m.key))writes.push(held?guard('EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=? AND version=?)','MOVE_IN_CHANGED','A target field changed.',m.key,held.version):guard('NOT EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=?)','MOVE_IN_CHANGED','A target field was created after review.',m.key))
  writes.push(guard('NOT EXISTS(SELECT 1 FROM cf_custom_values WHERE field_key=? AND record_id=?)','MOVE_IN_CHANGED','This record already has a target field value.',m.key,recordId))
  customWrites.push({field,createField:!held&&!staged.has(m.key),recordId,donorId,sourceKey,hash,externalId:record.externalId,donorExternalId:record.donorExternalId,imported:{mapping:m,value:value.value!,original:typeof value.original==='string'?value.original:JSON.stringify(value.original),location:{file:job.source+' API',sheet:definition.kind,row:1}}})
  staged.add(m.key)
 }
 // Definitions with all values waiting still appear, while their values remain in review.
 const emptyFields=review.mappings.filter(m=>m.action==='field'&&!staged.has(m.field!.key)&&!fields.some(f=>f.key===m.field!.key)).map(m=>({...m.field,choices:JSON.stringify(m.field!.choices),version:1,created_at:c.now}))
 writes.push(...await createImportDefinitionWrites(c,emptyFields,job.source,job.id),...await importedCustomWrites(c,{customWrites} as Plan,job.source,job.id))
 writes.push(sql("UPDATE cf_move_in_jobs SET report=json_set(report,'$.customReview.applied',1,'$.customReview.appliedValues',json(?)) WHERE id=?",JSON.stringify([...new Set([...(review.appliedValues??[]),...review.values.filter(v=>v.state==='ready').map(v=>v.id)])]),job.id),event(c,'move-in.custom.apply','move-in',job.id,null,{carried:customWrites.length,waiting:review.values.filter(v=>v.state==='waiting').length}))
 await commit(c,writes)
 return {id:job.id,review,carried:customWrites.length,tagAssignments,waiting:review.values.filter(v=>v.state==='waiting').length,unchanged:customWrites.length===0&&tagAssignments===0&&emptyFields.length===0}
}

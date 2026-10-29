import { customJsonBatches } from './custom-review-storage'
import { columnDefinitions, stageColumnValue } from './column-definitions'
import { customValue } from '../custom-fields'
import { spreadsheetDefinitionWrites } from './spreadsheet-definitions'
import { all, guard, sha256, sql, type Context, type Row, type Stmt } from '../db'
import { valueText, type SourceRow } from './source-rows'
import type { CustomImportMapping, ImportedCustomValue, Located, ParseInput, ParsedImport } from './types'
import type { Plan } from './plan'
import { createImportDefinitionWrites, customDefinitionUndoGuards, customDefinitionUndoWrites } from './custom-definition-undo'
export { createImportDefinitionWrites } from './custom-definition-undo'

/** A mapping is explicit and belongs to one CRM and worksheet, never inferred from a label. */
export function reviewedCustomMappings(input: ParseInput, out: ParsedImport) {
 try {
  const raw = typeof input.customFields === 'string' ? JSON.parse(input.customFields) : input.customFields ?? []
  if (!Array.isArray(raw) || raw.length > 100) throw Error('Review at most 100 custom column mappings.')
  const seen = new Set<string>()
  out.customFields = raw.map((m: CustomImportMapping) => {
   if (!m || m.source !== input.source || !m.column?.trim() || typeof m.label !== 'string' || !m.label.trim() || m.label.length > 100 || !/^[a-z][a-z0-9_]{0,79}$/.test(m.key)) throw Error('Each custom mapping needs its source CRM, source column, field key and label.')
   if (!['constituent','gift','pledge','interaction','note'].includes(m.kind) || !['text','number','currency','date','year','checkbox'].includes(m.type) || !['free-form','pick-one','pick-many'].includes(m.entry)) throw Error('Choose a supported custom record kind, value type and entry method. Opportunities have no CRM export importer yet.')
   if (m.sheet !== undefined && typeof m.sheet !== 'string' || m.version !== undefined && (!Number.isSafeInteger(m.version) || m.version < 0)) throw Error('Invalid custom mapping sheet or definition version.')
   if (!Array.isArray(m.choices) || m.choices.length > 100 || m.entry !== 'free-form' && !m.choices.length || m.entry === 'free-form' && m.choices.length) throw Error('Pick lists need 1–100 choices; free-form fields have no choices.')
   const choices = m.choices.map(v => m.version ? String(v) : JSON.parse(customValue({...m,entry:'free-form',choices:'[]'},v)))
   if (new Set(choices).size !== choices.length) throw Error('Custom pick-list choices must be distinct.')
   const identity = JSON.stringify([m.sheet ?? '',m.column,m.kind])
   if (seen.has(identity)) throw Error('Map each source column and record kind once.')
   seen.add(identity)
   return {source:m.source,column:m.column,sheet:m.sheet||undefined,key:m.key,label:m.label,kind:m.kind,type:m.type,entry:m.entry,choices,version:m.version??0}
  })
 } catch (e) { out.customFields = []; out.diagnostics.push({severity:'error',code:'CUSTOM_MAPPING',message:String(e instanceof Error ? e.message : e)}) }
}

export function mapCustomColumns(rows: SourceRow[], out: ParsedImport, deferCustomValues=false) {
 if(out.source==='spreadsheet'&&deferCustomValues){const columns=columnDefinitions(out);out.columnDefinitions=columns.definitions;out.columnMappings=columns.mappings}
 const inventory = new Map<string,{column:string;sheet:string;kind:string}>(), used = new Set<CustomImportMapping>()
 for (const r of rows) {
  const sourceKind = r.kind(), kind = sourceKind === 'donor' ? 'constituent' : sourceKind === 'note' ? ['call','meeting','email'].includes(r.peek('noteType').toLowerCase()) ? 'interaction' : 'note' : sourceKind
  if (!['constituent','gift','pledge','interaction','note'].includes(kind)) continue
  for (const [i,column] of r.headers.entries()) if (!r.used.has(i) || out.customFields?.some(m=>m.column===column&&m.kind===kind)) inventory.set(JSON.stringify([r.location.sheet,column,kind]),{column,sheet:r.location.sheet,kind})
  for (const mapping of out.customFields ?? []) {
   const targetKind=['givebutter','zeffy'].includes(out.source)&&kind==='gift'&&mapping.kind==='constituent'?'constituent':kind
   if (mapping.kind !== targetKind || mapping.sheet && mapping.sheet !== r.location.sheet) continue
   const indexes = r.headers.flatMap((h,i) => h === mapping.column ? [i] : [])
   if (!indexes.length) continue
   used.add(mapping)
   if (indexes.length !== 1) { r.error('CUSTOM_MAPPING','The mapped custom column occurs more than once; export one unambiguous column.',mapping.column); continue }
   const original = r.cells[indexes[0]] instanceof Date ? valueText(r.cells[indexes[0]]) : String(r.cells[indexes[0]] ?? '')
   if (!original.trim()) continue
   if(targetKind!==kind){inventory.delete(JSON.stringify([r.location.sheet,mapping.column,kind]));inventory.set(JSON.stringify([r.location.sheet,mapping.column,targetKind]),{column:mapping.column,sheet:r.location.sheet,kind:targetKind})}
   const collection = targetKind === 'constituent' ? out.donors : kind === 'gift' ? out.gifts : kind === 'pledge' ? out.pledges : out.notes
   const entity = collection.find(x => x.location.file === r.location.file && x.location.sheet === r.location.sheet && x.location.row === r.location.row) ?? (targetKind === 'constituent' ? out.donors.find(d => d.externalId === r.peek('donorId')) : undefined)
   if (!entity) { r.error('CUSTOM_MAPPING','This custom value has no successfully mapped source record.',mapping.column); continue }
   if(out.source==='spreadsheet'&&stageColumnValue(out,mapping,entity.externalId,original)){
    out.unmapped=out.unmapped.filter(u=>!(u.file===r.location.file&&u.sheet===r.location.sheet&&u.row===r.location.row&&u.column===mapping.column))
    continue
   }
   try {
    const value = customValue({...mapping,choices:JSON.stringify(mapping.choices)},mapping.entry === 'pick-many' ? JSON.parse(original) : original.trim())
    const prior = entity.customValues?.find(v => v.mapping.key === mapping.key)
    if (prior && prior.value !== value) throw Error('Repeated source records disagree on this custom field.')
    if (!prior) (entity.customValues ??= []).push({mapping,value,original,location:r.location})
    out.unmapped = out.unmapped.filter(u => !(u.file === r.location.file && u.sheet === r.location.sheet && u.row === r.location.row && u.column === mapping.column))
   } catch (e) { r.error('CUSTOM_VALUE',`${mapping.label}: ${e instanceof Error ? e.message : String(e)} Correct this exported value or its reviewed mapping.`,mapping.column) }
  }
 }
 for (const m of out.customFields ?? []) if (!used.has(m)) out.diagnostics.push({severity:'error',code:'CUSTOM_MAPPING',column:m.column,message:`${m.label}: no ${m.kind} source rows contain this exact mapped column and worksheet.`})
 out.sourceColumns = [...inventory.values()]
}

export type CustomImportWrite = { field: Row; createField: boolean; recordId:string; donorId:string; sourceKey:string; hash:string; imported:ImportedCustomValue; externalId:string; donorExternalId:string }
const definitionMatches = (a:Row,b:Row) => a.kind === b.kind && a.type === b.type && a.entry === b.entry && a.choices === JSON.stringify(b.choices)

/** Resolve source IDs only through this plan and its established importer custody. */
export async function planCustomValues(c:Context, parsed:ParsedImport, plan:Plan, existing:Map<string,Row>) {
 const definitions = new Map((await all(c,'SELECT * FROM cf_custom_fields')).map(f => [f.key,f])), staged = new Map<string,Row>()
 const entities: {kind:string;entity:Located & {externalId:string;donorExternalId?:string}}[] = [
  ...parsed.donors.map(entity=>({kind:'donor',entity})),...parsed.gifts.map(entity=>({kind:'gift',entity})),...parsed.pledges.map(entity=>({kind:'pledge',entity})),...parsed.notes.map(entity=>({kind:['call','meeting','email'].includes(entity.type)?'interaction':'note',entity})),
 ]
 const candidates = await Promise.all(entities.flatMap(({kind,entity}) => (entity.customValues ?? []).map(async imported => ({kind,entity,imported,recordKey:await sha256(entity.externalId),sourceKey:await sha256(JSON.stringify([kind,entity.externalId,imported.mapping.key])),hash:await sha256(JSON.stringify([kind,entity.externalId,imported.mapping.key,imported.value]))}))))
 if (!candidates.length) return
 const custodyByKey = new Map((await all(c,"SELECT * FROM cf_move_in_records WHERE source=? AND kind='customValue' AND source_key IN(SELECT value FROM json_each(?))",parsed.source,JSON.stringify(candidates.map(v=>v.sourceKey)))).map(r=>[r.source_key,r]))
 const current = new Set((await all(c,'SELECT field_key,record_id FROM cf_custom_values WHERE donor_id IN(SELECT value FROM json_each(?))',JSON.stringify([...plan.donorIds.values()]))).map(v=>JSON.stringify([v.field_key,v.record_id])))
 const planned = new Set<string>()
 for (const {kind,entity,imported,recordKey,sourceKey,hash} of candidates) {
  const m = imported.mapping, held = definitions.get(m.key), earlier = staged.get(m.key)
  const error = (message:string) => plan.diagnostics.push({...imported.location,column:m.column,severity:'error',code:'CUSTOM_MAPPING',message})
  if (held && !definitionMatches(held,m) || earlier && !definitionMatches(earlier,m)) { error(`Custom field ${m.key} has a different kind, type, entry method or choices. Review its current definition.`); continue }
  if (held && (held.label !== m.label || m.version && held.version !== m.version)) { error(`Custom field ${m.key} changed after its mapping was selected. Review its current definition.`); continue }
  // A new-field mapping may meet the same definition created by an earlier part.
  const field = held ?? earlier ?? {...m,choices:JSON.stringify(m.choices),version:1,created_at:c.now}
  const recordId = plan.effects.find(e=>e.kind === kind && e.sourceKey === recordKey)?.nativeId ?? existing.get(`${kind}:${recordKey}`)?.native_id
  const donorId = plan.donorIds.get(entity.donorExternalId ?? entity.externalId)
  if (!recordId || !donorId) { error(`Custom field ${m.key} has no resolved ${kind} or constituent.`); continue }
  const custody = custodyByKey.get(sourceKey), identity = JSON.stringify([m.key,recordId])
  if (custody) {
   if (custody.content_hash !== hash || !custody.snapshot) error(`Custom value ${m.key} differs from the earlier source move-in or was erased. Undo that move-in or correct the export.`)
   continue // Replay never rewrites later staff edits or a renamed definition.
  }
  if (current.has(identity) || planned.has(identity)) { error(`Record ${entity.externalId} already has custom value ${m.key}, or several source IDs resolve to it. Coffer keeps existing values; review this conflict.`); continue }
  planned.add(identity)
  if (held && !earlier) plan.checks.push(guard('EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=? AND version=?)','MOVE_IN_CHANGED','This custom definition changed. Review again.',m.key,held.version))
  else if (!earlier) plan.checks.push(guard('NOT EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=?)','MOVE_IN_CHANGED','This custom definition was added. Review again.',m.key))
  plan.customWrites.push({field,createField:!held&&!earlier,recordId,donorId,sourceKey,hash,imported,externalId:entity.externalId,donorExternalId:entity.donorExternalId ?? entity.externalId})
  staged.set(m.key,field)
 }
 if (plan.customWrites.length) plan.checks.push(guard(`NOT EXISTS(SELECT 1 FROM cf_custom_values v JOIN json_each(?) j ON v.field_key=json_extract(j.value,'$.key') AND v.record_id=json_extract(j.value,'$.recordId'))`,'MOVE_IN_CHANGED','A custom value changed. Review the files again.',JSON.stringify(plan.customWrites.map(w=>({key:w.field.key,recordId:w.recordId})))))
}

export async function importedCustomWrites(c:Context, plan:Plan, source:string, jobId:string):Promise<Stmt[]> {
 const writes:Stmt[] = []
 if (!plan.customWrites.length) return writes
 const fields = plan.customWrites.filter(w=>w.createField).map(w=>w.field)
 writes.push(...await createImportDefinitionWrites(c,fields,source,jobId))
 if(['spreadsheet','givebutter','zeffy','neon'].includes(source))writes.push(...spreadsheetDefinitionWrites(fields,jobId))
 const values = plan.customWrites.map(w=>{
  const provenance = {source,column:w.imported.mapping.column,location:w.imported.location,sourceRecordId:w.externalId,sourceDonorId:w.donorExternalId,original:w.imported.original}
  const row = {field_key:w.field.key,record_id:w.recordId,donor_id:w.donorId,value:w.imported.value,version:1,source:JSON.stringify(provenance),updated_at:c.now}
  return {...row,sourceKey:w.sourceKey,hash:w.hash,snapshot:JSON.stringify(row)}
 })
 for(const payload of customJsonBatches(values)){
 writes.push(sql(`INSERT INTO cf_custom_values(field_key,record_id,donor_id,value,version,source,updated_at) SELECT json_extract(value,'$.field_key'),json_extract(value,'$.record_id'),json_extract(value,'$.donor_id'),json_extract(value,'$.value'),1,json_extract(value,'$.source'),? FROM json_each(?)`,c.now,payload),
  sql(`INSERT INTO cf_custom_value_history(field_key,record_id,donor_id,version,value,source,recorded_at,actor_id) SELECT json_extract(value,'$.field_key'),json_extract(value,'$.record_id'),json_extract(value,'$.donor_id'),1,json_extract(value,'$.value'),json_extract(value,'$.source'),?,? FROM json_each(?)`,c.now,c.actor.id,payload),
  sql(`INSERT INTO cf_move_in_records(source,kind,source_key,native_id,content_hash,job_id,owned,donor_id,related_id,snapshot) SELECT ?,'customValue',json_extract(value,'$.sourceKey'),json_extract(value,'$.record_id'),json_extract(value,'$.hash'),?,1,json_extract(value,'$.donor_id'),NULL,json_extract(value,'$.snapshot') FROM json_each(?)`,source,jobId,payload))
 }
 // New donor snapshots must include the version produced by the imported values.
 const donors = [...new Set(plan.customWrites.map(w=>w.donorId))]
 if (donors.length) writes.push(sql('UPDATE cf_donors SET version=version+1 WHERE id IN(SELECT value FROM json_each(?))',JSON.stringify(donors)),
  sql(`UPDATE cf_move_in_records SET snapshot=json_set(snapshot,'$.version',(SELECT version FROM cf_donors WHERE id=native_id)) WHERE source=? AND kind='donor' AND native_id IN(SELECT value FROM json_each(?))`,source,JSON.stringify(donors)))
 return writes
}

const customOwned = "SELECT snapshot FROM cf_move_in_records WHERE job_id=? AND kind='customValue'"
export function customImportUndoGuards(jobId:string):Stmt[] {
 return [guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records r LEFT JOIN cf_custom_values v ON v.record_id=r.native_id AND v.field_key=json_extract(r.snapshot,'$.field_key') WHERE r.job_id=? AND r.kind='customValue' AND (r.snapshot IS NULL OR v.record_id IS NULL OR v.value<>json_extract(r.snapshot,'$.value') OR v.version<>json_extract(r.snapshot,'$.version') OR v.source<>json_extract(r.snapshot,'$.source') OR v.donor_id<>r.donor_id OR v.updated_at<>json_extract(r.snapshot,'$.updated_at')))`,'MOVE_IN_USED','An imported custom value changed after the move-in. Nothing was undone.',jobId),...customDefinitionUndoGuards(jobId)]
}
export function customImportUndoWrites(jobId:string):Stmt[] {
 return [sql(`DELETE FROM cf_custom_value_history WHERE (field_key,record_id) IN(SELECT json_extract(snapshot,'$.field_key'),json_extract(snapshot,'$.record_id') FROM (${customOwned}))`,jobId),
  sql(`DELETE FROM cf_custom_values WHERE (field_key,record_id) IN(SELECT json_extract(snapshot,'$.field_key'),json_extract(snapshot,'$.record_id') FROM (${customOwned}))`,jobId),...customDefinitionUndoWrites(jobId)]
}

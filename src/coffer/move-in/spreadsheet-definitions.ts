import { guard, sql, type Row, type Stmt } from '../db'

const snapshot="json_object('key',f.key,'label',f.label,'kind',f.kind,'type',f.type,'entry',f.entry,'choices',f.choices,'version',f.version,'created_at',f.created_at)"
const definitions="SELECT j.key,j.value FROM cf_move_in_jobs job,json_each(job.report,'$.createdSpreadsheetFields') j WHERE job.id=?"

export function spreadsheetDefinitionWrites(fields:Row[],jobId:string):Stmt[] {
 if(!fields.length)return []
 const values=Object.fromEntries(fields.map(f=>[f.key,{key:f.key,label:f.label,kind:f.kind,type:f.type,entry:f.entry,choices:f.choices,version:1,created_at:f.created_at}]))
 return [sql("UPDATE cf_move_in_jobs SET report=json_set(report,'$.createdSpreadsheetFields',json_patch(COALESCE(json_extract(report,'$.createdSpreadsheetFields'),'{}'),json(?))) WHERE id=?",JSON.stringify(values),jobId)]
}

/** Only definitions this job created can be removed. A later edit or use
 * refuses the entire undo, keeping the field and all records together. */
export function spreadsheetDefinitionUndoGuards(jobId:string):Stmt[] {
 return [guard(`NOT EXISTS(SELECT 1 FROM (${definitions}) d LEFT JOIN cf_custom_fields f ON f.key=d.key WHERE f.key IS NULL OR ${snapshot}<>d.value)`,'MOVE_IN_USED','An import-created custom field changed. Nothing was undone.',jobId),
  guard(`NOT EXISTS(SELECT 1 FROM cf_custom_values v WHERE v.field_key IN(SELECT key FROM (${definitions})) AND NOT EXISTS(SELECT 1 FROM cf_move_in_records r WHERE r.job_id=? AND r.kind='customValue' AND r.native_id=v.record_id AND json_extract(r.snapshot,'$.field_key')=v.field_key))`,'MOVE_IN_USED','An import-created custom field is now used by another record. Nothing was undone.',jobId,jobId)]
}

export function spreadsheetDefinitionUndoWrites(jobId:string):Stmt[] {
 return [sql(`DELETE FROM cf_custom_fields WHERE key IN(SELECT key FROM (${definitions}))`,jobId)]
}

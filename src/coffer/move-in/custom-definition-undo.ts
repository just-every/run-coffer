import { guard, sha256, sql, type Context, type Row, type Stmt } from '../db'

const columns = ['key','label','kind','type','entry','choices','version','created_at'] as const
const ownedDefinitions = "SELECT native_id FROM cf_move_in_records WHERE job_id=? AND kind='customDefinition' AND owned=1"

/** Only definitions actually created by this job enter its undo custody. */
export async function createImportDefinitionWrites(c:Context, fields:Row[], source:string, jobId:string):Promise<Stmt[]> {
 if (!fields.length) return []
 const definitions = await Promise.all([...new Map(fields.map(f=>[f.key,f])).values()].map(async f=>{
  const row = {key:f.key,label:f.label,kind:f.kind,type:f.type,entry:f.entry,choices:Array.isArray(f.choices)?JSON.stringify(f.choices):f.choices,version:1,created_at:c.now}
  const snapshot = JSON.stringify(row)
  const [sourceKey,hash] = await Promise.all([sha256(row.key),sha256(snapshot)])
  return {...row,sourceKey,hash,snapshot}
 }))
 const payload = JSON.stringify(definitions)
 return [
  sql(`INSERT INTO cf_custom_fields(${columns.join(',')}) SELECT ${columns.map(k=>`json_extract(value,'$.${k}')`).join(',')} FROM json_each(?)`,payload),
  sql(`INSERT INTO cf_move_in_records(source,kind,source_key,native_id,content_hash,job_id,owned,donor_id,related_id,snapshot) SELECT ?,'customDefinition',json_extract(value,'$.sourceKey'),json_extract(value,'$.key'),json_extract(value,'$.hash'),?,1,NULL,NULL,json_extract(value,'$.snapshot') FROM json_each(?)`,source,jobId,payload),
 ]
}

// Saved wording keeps custom names live even before another document is prepared.
const wording:[string,string[]][]=[['cf_settings',['letter_subject','letter_template']],['cf_letter_templates',['subject','body']],['cf_letter_template_versions',['subject','body']],['cf_pledge_template',['subject','body']],['cf_pledge_template_versions',['subject','body']],['cf_appeal_messages',['subject','body']],['cf_welcome',['thank_subject','thank_body','impact_subject','impact_body','ask_subject','ask_body']],['cf_journey_step_publications',['subject','body']]]
function wordingGuards(jobId:string):Stmt[]{
 return wording.map(([table,fields])=>{
  let text=fields.map(f=>`COALESCE(w.${f},'')`).join('||char(10)||')
  for(const space of [9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279])text=`replace(${text},char(${space}),'')`
  return guard(`NOT EXISTS(SELECT 1 FROM ${table} w JOIN cf_move_in_records r ON r.job_id=? AND r.kind='customDefinition' AND r.owned=1 WHERE instr(${text},'{{custom.'||r.native_id||'}}')>0 OR instr(${text},'{{custom.'||r.native_id||'|')>0)`,'MOVE_IN_USED','Saved wording uses a custom definition created by this move-in. Nothing was undone.',jobId)
 })
}

export function customDefinitionUndoGuards(jobId:string):Stmt[] {
 const sameJobValue = `SELECT 1 FROM cf_move_in_records r WHERE r.job_id=? AND r.kind='customValue' AND r.owned=1 AND r.native_id=v.record_id AND json_extract(r.snapshot,'$.field_key')=v.field_key`
 return [
  guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records r LEFT JOIN cf_custom_fields f ON f.key=r.native_id WHERE r.job_id=? AND r.kind='customDefinition' AND r.owned=1 AND (r.snapshot IS NULL OR f.key IS NULL OR ${columns.map(k=>`f.${k} IS NOT json_extract(r.snapshot,'$.${k}')`).join(' OR ')}))`,'MOVE_IN_USED','A custom definition created by this move-in changed. Nothing was undone.',jobId),
  guard(`NOT EXISTS(SELECT 1 FROM cf_custom_values v WHERE v.field_key IN (${ownedDefinitions}) AND NOT EXISTS(${sameJobValue})) AND NOT EXISTS(SELECT 1 FROM cf_custom_value_history v WHERE v.field_key IN (${ownedDefinitions}) AND NOT EXISTS(${sameJobValue} AND v.version=json_extract(r.snapshot,'$.version')))`,'MOVE_IN_USED','Other records use a custom definition created by this move-in. Nothing was undone.',jobId,jobId,jobId,jobId),
  guard(`NOT EXISTS(SELECT 1 FROM cf_saved_lists l JOIN cf_move_in_records r ON r.native_id=json_extract(l.filters,'$.customKey') WHERE r.job_id=? AND r.kind='customDefinition' AND r.owned=1)
   AND NOT EXISTS(SELECT 1 FROM cf_saved_reports s,json_tree(s.definition) j JOIN cf_move_in_records r ON j.atom='custom.'||r.native_id WHERE r.job_id=? AND r.kind='customDefinition' AND r.owned=1 AND j.type='text' AND (j.path IN('$.columns','$.groupBy','$.totals') OR j.key='field' AND j.path LIKE '$.filters[%]'))`,'MOVE_IN_USED','A saved list or report uses a custom definition created by this move-in. Nothing was undone.',jobId,jobId),
  ...wordingGuards(jobId),
  guard(`NOT EXISTS(SELECT 1 FROM cf_event_questions WHERE field_key IN (${ownedDefinitions}))
   AND NOT EXISTS(SELECT 1 FROM cf_batch_entries b,json_each(b.custom_fields) j WHERE j.key IN (${ownedDefinitions}))`,'MOVE_IN_USED','An event question or batch entry uses a custom definition created by this move-in. Nothing was undone.',jobId,jobId),
 ]
}

/** Called after this job's exact custom values and their history are removed. */
export const customDefinitionUndoWrites = (jobId:string):Stmt[] => [sql(`DELETE FROM cf_custom_fields WHERE key IN (${ownedDefinitions})`,jobId)]

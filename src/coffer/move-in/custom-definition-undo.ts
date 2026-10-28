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

// Reusable wording includes inactive and historical versions: those retain the
// same published custom field names when selected or restored later.
const wording = `SELECT letter_subject||char(10)||letter_template AS text FROM cf_settings
 UNION ALL SELECT subject||char(10)||body FROM cf_letter_templates
 UNION ALL SELECT subject||char(10)||body FROM cf_letter_template_versions
 UNION ALL SELECT subject||char(10)||body FROM cf_pledge_template
 UNION ALL SELECT subject||char(10)||body FROM cf_pledge_template_versions
 UNION ALL SELECT subject||char(10)||body FROM cf_appeal_messages
 UNION ALL SELECT thank_subject||char(10)||thank_body||char(10)||impact_subject||char(10)||impact_body||char(10)||ask_subject||char(10)||ask_body FROM cf_welcome
 UNION ALL SELECT subject||char(10)||body FROM cf_journey_step_publications`
// The same whitespace accepted around a merge field by templateTokens.
const whitespace = 'char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)'
const templateReferences = `WITH RECURSIVE wording(text) AS (${wording}), tokens(rest,token) AS (
 SELECT text,NULL FROM wording
 UNION ALL SELECT substr(rest,instr(rest,'{{')+2),
  CASE WHEN instr(substr(rest,instr(rest,'{{')+2),'}}')>0 THEN substr(rest,instr(rest,'{{')+2,instr(substr(rest,instr(rest,'{{')+2),'}}')-1) END
 FROM tokens WHERE instr(rest,'{{')>0
), names(token) AS (SELECT ltrim(token,${whitespace}) FROM tokens WHERE token IS NOT NULL)
 SELECT 1 FROM names JOIN cf_move_in_records r ON r.job_id=? AND r.kind='customDefinition' AND r.owned=1
 WHERE CASE WHEN instr(token,'|')=0 THEN rtrim(token,${whitespace}) ELSE substr(token,1,instr(token,'|')-1) END='custom.'||r.native_id
 AND (instr(token,'|')=0 OR (length(substr(token,instr(token,'|')+1))>0
  AND instr(substr(token,instr(token,'|')+1),'{')=0 AND instr(substr(token,instr(token,'|')+1),'}')=0
  AND instr(substr(token,instr(token,'|')+1),'|')=0 AND instr(substr(token,instr(token,'|')+1),char(10))=0 AND instr(substr(token,instr(token,'|')+1),char(13))=0))`

export function customDefinitionUndoGuards(jobId:string):Stmt[] {
 const sameJobValue = `SELECT 1 FROM cf_move_in_records r WHERE r.job_id=? AND r.kind='customValue' AND r.owned=1 AND r.native_id=v.record_id AND json_extract(r.snapshot,'$.field_key')=v.field_key`
 return [
  guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records r LEFT JOIN cf_custom_fields f ON f.key=r.native_id WHERE r.job_id=? AND r.kind='customDefinition' AND r.owned=1 AND (r.snapshot IS NULL OR f.key IS NULL OR ${columns.map(k=>`f.${k} IS NOT json_extract(r.snapshot,'$.${k}')`).join(' OR ')}))`,'MOVE_IN_USED','A custom definition created by this move-in changed. Nothing was undone.',jobId),
  guard(`NOT EXISTS(SELECT 1 FROM cf_custom_values v WHERE v.field_key IN (${ownedDefinitions}) AND NOT EXISTS(${sameJobValue})) AND NOT EXISTS(SELECT 1 FROM cf_custom_value_history v WHERE v.field_key IN (${ownedDefinitions}) AND NOT EXISTS(${sameJobValue} AND v.version=json_extract(r.snapshot,'$.version')))`,'MOVE_IN_USED','Other records use a custom definition created by this move-in. Nothing was undone.',jobId,jobId,jobId,jobId),
  guard(`NOT EXISTS(SELECT 1 FROM cf_saved_lists l JOIN cf_move_in_records r ON r.native_id=json_extract(l.filters,'$.customKey') WHERE r.job_id=? AND r.kind='customDefinition' AND r.owned=1)
   AND NOT EXISTS(SELECT 1 FROM cf_saved_reports s,json_tree(s.definition) j JOIN cf_move_in_records r ON j.atom='custom.'||r.native_id WHERE r.job_id=? AND r.kind='customDefinition' AND r.owned=1 AND j.type='text' AND (j.path IN('$.columns','$.groupBy','$.totals') OR j.key='field' AND j.path LIKE '$.filters[%]'))`,'MOVE_IN_USED','A saved list or report uses a custom definition created by this move-in. Nothing was undone.',jobId,jobId),
  guard(`NOT EXISTS(${templateReferences})`,'MOVE_IN_USED','Saved wording uses a custom definition created by this move-in. Nothing was undone.',jobId),
  guard(`NOT EXISTS(SELECT 1 FROM cf_event_questions WHERE field_key IN (${ownedDefinitions}))
   AND NOT EXISTS(SELECT 1 FROM cf_batch_entries b,json_each(b.custom_fields) j WHERE j.key IN (${ownedDefinitions}))`,'MOVE_IN_USED','An event question or batch entry uses a custom definition created by this move-in. Nothing was undone.',jobId,jobId),
 ]
}

/** Called after this job's exact custom values and their history are removed. */
export const customDefinitionUndoWrites = (jobId:string):Stmt[] => [sql(`DELETE FROM cf_custom_fields WHERE key IN (${ownedDefinitions})`,jobId)]

import { all, guard, sha256, sql, type Context, type Row, type Stmt } from '../db'
import type { SourceDefinition } from './source-definitions'
import type { ReviewValue } from './custom-review-types'

export async function customTagWrites(c:Context,source:string,jobId:string,definition:SourceDefinition,value:ReviewValue,native:Row,staged:Set<string>):Promise<{writes:Stmt[];added:number}> {
 const decoded=JSON.parse(value.value!),tags:string[]=Array.isArray(decoded)?decoded:[decoded],writes:Stmt[]=[]
 let added=0
 for(const tag of tags){
  const sourceKey=await sha256(JSON.stringify([native.donor_id,tag]))
  if(staged.has(sourceKey))continue
  staged.add(sourceKey)
  const prior=await all(c,"SELECT 1 FROM cf_move_in_records WHERE source=? AND kind='customTag' AND source_key=?",source,sourceKey)
  if(prior.length)continue
  const existing=await all(c,'SELECT * FROM cf_donor_tags WHERE donor_id=? AND tag=?',native.donor_id,tag)
  if(existing.length)continue
  added++
  const definitionHeld=await all(c,'SELECT * FROM cf_tag_definitions WHERE name=?',tag)
  if(!definitionHeld.length){
   const definitionKey=await sha256(tag)
   writes.push(sql('INSERT OR IGNORE INTO cf_tag_definitions(name) VALUES(?)',tag),sql("INSERT OR IGNORE INTO cf_move_in_records(source,kind,source_key,native_id,content_hash,job_id,owned,snapshot) VALUES(?,'customTagDefinition',?,?,?,?,1,?)",source,definitionKey,tag,definitionKey,jobId,JSON.stringify({name:tag,category:null,version:1})))
  }
  writes.push(guard('NOT EXISTS(SELECT 1 FROM cf_donor_tags WHERE donor_id=? AND tag=?)','MOVE_IN_CHANGED','A target tag changed after review.',native.donor_id,tag),sql('INSERT INTO cf_donor_tags(donor_id,tag,created_at,created_by) VALUES(?,?,?,?)',native.donor_id,tag,c.now,c.actor.name),sql("INSERT INTO cf_move_in_records(source,kind,source_key,native_id,content_hash,job_id,owned,donor_id,snapshot) VALUES(?,'customTag',?,?,?,?,1,?,?)",source,sourceKey,native.donor_id,sourceKey,jobId,native.donor_id,JSON.stringify({tag,created_at:c.now,created_by:c.actor.name,field:definition.id})))
 }
 return {writes,added}
}
export function customTagUndoGuards(jobId:string):Stmt[]{return [
 guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records r LEFT JOIN cf_tag_definitions d ON d.name=r.native_id WHERE r.job_id=? AND r.kind='customTagDefinition' AND (d.name IS NULL OR d.version<>json_extract(r.snapshot,'$.version') OR d.category IS NOT json_extract(r.snapshot,'$.category'))) AND NOT EXISTS(SELECT 1 FROM cf_donor_tags t JOIN cf_move_in_records d ON d.native_id=t.tag AND d.kind='customTagDefinition' AND d.job_id=? WHERE NOT EXISTS(SELECT 1 FROM cf_move_in_records r WHERE r.job_id=? AND r.kind='customTag' AND r.donor_id=t.donor_id AND json_extract(r.snapshot,'$.tag')=t.tag)) AND NOT EXISTS(SELECT 1 FROM cf_donor_rule_tags t JOIN cf_move_in_records r ON r.native_id=t.tag WHERE r.job_id=? AND r.kind='customTagDefinition') AND NOT EXISTS(SELECT 1 FROM cf_saved_lists l JOIN cf_move_in_records r ON r.native_id=json_extract(l.filters,'$.tag') WHERE r.job_id=? AND r.kind='customTagDefinition')`,'MOVE_IN_USED','An imported tag definition changed or is in use. Nothing was undone.',jobId,jobId,jobId,jobId,jobId),guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records r LEFT JOIN cf_donor_tags t ON t.donor_id=r.donor_id AND t.tag=json_extract(r.snapshot,'$.tag') WHERE r.job_id=? AND r.kind='customTag' AND (t.donor_id IS NULL OR t.created_at<>json_extract(r.snapshot,'$.created_at') OR t.created_by<>json_extract(r.snapshot,'$.created_by')))`,'MOVE_IN_USED','An imported tag changed. Nothing was undone.',jobId)]}
export function customTagUndoWrites(jobId:string):Stmt[]{return [sql("DELETE FROM cf_donor_tags WHERE (donor_id,tag) IN(SELECT donor_id,json_extract(snapshot,'$.tag') FROM cf_move_in_records WHERE job_id=? AND kind='customTag')",jobId),sql("DELETE FROM cf_tag_definitions WHERE name IN(SELECT native_id FROM cf_move_in_records WHERE job_id=? AND kind='customTagDefinition')",jobId)]}

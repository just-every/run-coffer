import { all, guard, sha256, sql, type Context, type Row, type Stmt } from '../db'
import type { SourceDefinition } from './source-definitions'
import type { ReviewValue } from './custom-review-types'

export async function customTagWrites(c:Context,source:string,jobId:string,definition:SourceDefinition,value:ReviewValue,native:Row):Promise<Stmt[]> {
 const decoded=JSON.parse(value.value!),tags:string[]=Array.isArray(decoded)?decoded:[decoded],writes:Stmt[]=[]
 for(const tag of tags){
  const sourceKey=await sha256(JSON.stringify([native.donor_id,tag])),prior=await all(c,"SELECT 1 FROM cf_move_in_records WHERE source=? AND kind='customTag' AND source_key=?",source,sourceKey)
  if(prior.length)continue
  const existing=await all(c,'SELECT * FROM cf_donor_tags WHERE donor_id=? AND tag=?',native.donor_id,tag)
  if(existing.length)continue
  writes.push(guard('NOT EXISTS(SELECT 1 FROM cf_donor_tags WHERE donor_id=? AND tag=?)','MOVE_IN_CHANGED','A target tag changed after review.',native.donor_id,tag),sql('INSERT OR IGNORE INTO cf_tag_definitions(name) VALUES(?)',tag),sql('INSERT INTO cf_donor_tags(donor_id,tag,created_at,created_by) VALUES(?,?,?,?)',native.donor_id,tag,c.now,c.actor.name),sql("INSERT INTO cf_move_in_records(source,kind,source_key,native_id,content_hash,job_id,owned,donor_id,snapshot) VALUES(?,'customTag',?,?,?,?,1,?,?)",source,sourceKey,native.donor_id,sourceKey,jobId,native.donor_id,JSON.stringify({tag,created_at:c.now,created_by:c.actor.name,field:definition.id})))
 }
 return writes
}
export function customTagUndoGuards(jobId:string):Stmt[]{return [guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records r LEFT JOIN cf_donor_tags t ON t.donor_id=r.donor_id AND t.tag=json_extract(r.snapshot,'$.tag') WHERE r.job_id=? AND r.kind='customTag' AND (t.donor_id IS NULL OR t.created_at<>json_extract(r.snapshot,'$.created_at') OR t.created_by<>json_extract(r.snapshot,'$.created_by')))`,'MOVE_IN_USED','An imported tag changed. Nothing was undone.',jobId)]}
export function customTagUndoWrites(jobId:string):Stmt[]{return [sql("DELETE FROM cf_donor_tags WHERE (donor_id,tag) IN(SELECT donor_id,json_extract(snapshot,'$.tag') FROM cf_move_in_records WHERE job_id=? AND kind='customTag')",jobId)]}

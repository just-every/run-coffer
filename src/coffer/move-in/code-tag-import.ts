import { guard, sql, type Context, type Row, type Stmt } from '../db'
import { contentHash, sourceKey, type Plan } from './plan'
import type { ParsedImport } from './types'

export type TagEffect={key:string;hash:string;nativeId:string;owned:boolean;row:Row}
type Read=(c:Context,plan:Plan,query:string,params?:unknown[])=>Promise<Row[]>
const snapshot="json_object('donor_id',donor_id,'tag',tag,'created_at',created_at,'created_by',created_by)"

/** Tags keep their normal list semantics; import custody owns only newly added
 * donor assignments. Existing assignments and later staff changes stay intact. */
export async function planCodeTags(c:Context,parsed:ParsedImport,plan:Plan,existing:Map<string,Row>,read:Read) {
 if(!parsed.codeTags?.length)return
 const tags=await read(c,plan,`SELECT ${snapshot} AS snapshot FROM cf_donor_tags WHERE donor_id IN (SELECT value FROM json_each(?)) ORDER BY donor_id,tag`,[JSON.stringify([...plan.donorIds.values()])])
 for(const t of parsed.codeTags) {
  const donorId=plan.donorIds.get(t.donorExternalId),key=await sourceKey(t.externalId),prior=existing.get(`tag:${key}`)
  const held=tags.find(r=>r.donor_id===donorId&&r.tag===t.tag)
  const {location:_,...payload}=t,hash=await contentHash(payload)
  if(prior) {
   if(prior.content_hash!==hash||!held||JSON.stringify(held)!==prior.snapshot)plan.diagnostics.push({...t.location,severity:'error',code:'MOVE_IN_MAPPING',message:`Imported tag ${t.tag} changed after an earlier move-in. Review the current assignment before importing.`})
   continue
  }
  plan.tagEffects.push({key,hash,nativeId:JSON.stringify([donorId,t.tag]),owned:!held,row:held??{donor_id:donorId,tag:t.tag,created_at:c.now,created_by:c.actor.id}})
 }
}
export function importedTagWrites(plan:Plan,source:string,jobId:string):Stmt[] {
 return plan.tagEffects.flatMap(t=>[
  sql('INSERT OR IGNORE INTO cf_tag_definitions(name) VALUES(?)',t.row.tag),
  ...(t.owned?[sql('INSERT INTO cf_donor_tags(donor_id,tag,created_at,created_by) VALUES(?,?,?,?)',t.row.donor_id,t.row.tag,t.row.created_at,t.row.created_by)]:[]),
  sql("INSERT INTO cf_move_in_records(source,kind,source_key,native_id,content_hash,job_id,owned,donor_id,related_id,snapshot) VALUES(?,'tag',?,?,?,?,?,?,NULL,?)",source,t.key,t.nativeId,t.hash,jobId,t.owned?1:0,t.row.donor_id,JSON.stringify(t.row)),
 ])
}
export function tagUndoGuards(jobId:string):Stmt[] {
 return [guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records r LEFT JOIN cf_donor_tags t ON t.donor_id=r.donor_id AND t.tag=json_extract(r.snapshot,'$.tag') WHERE r.job_id=? AND r.kind='tag' AND (t.donor_id IS NULL OR json_object('donor_id',t.donor_id,'tag',t.tag,'created_at',t.created_at,'created_by',t.created_by)<>r.snapshot))`,'MOVE_IN_USED','Imported tags changed since the move-in. Nothing was undone.',jobId),
 guard(`NOT EXISTS(SELECT 1 FROM cf_donor_tags t WHERE t.donor_id IN(SELECT native_id FROM cf_move_in_records WHERE job_id=? AND kind='donor' AND owned=1) AND NOT EXISTS(SELECT 1 FROM cf_move_in_records r WHERE r.job_id=? AND r.kind='tag' AND r.owned=1 AND r.native_id=json_array(t.donor_id,t.tag)))`,'MOVE_IN_USED','Tags were added after this move-in. Nothing was undone.',jobId,jobId)]
}
export function tagUndoWrites(jobId:string):Stmt[] {
 return [sql("DELETE FROM cf_donor_tags WHERE json_array(donor_id,tag) IN(SELECT native_id FROM cf_move_in_records WHERE job_id=? AND kind='tag' AND owned=1)",jobId)]
}

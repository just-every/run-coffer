import type { Context, Row } from '../db'
import type { Located, ParsedImport } from './types'
import type { Plan } from './plan'
import { sha256 } from '../db'
import type { Kind } from './tables'

type Add=(kind:Kind,entity:Located&{externalId:string},row:Row,match?:string,donorId?:string|null,relatedId?:string|null)=>Promise<string>
type Read=(c:Context,plan:Plan,query:string,params?:unknown[])=>Promise<Row[]>
/** Existing definitions are reviewed by name; source data creates no definition. */
export async function planSourceTags(c:Context,parsed:ParsedImport,plan:Plan,existing:Map<string,Row>,add:Add,read:Read,preview=false){
 const rows=parsed.sourceTags??[]
 if(!rows.length)return
 const donors=[...new Set(rows.map(r=>plan.donorIds.get(r.donorExternalId)).filter(Boolean))]
 const definitions=await read(c,plan,"SELECT json_object('name',name,'category',category,'version',version) AS snapshot FROM cf_tag_definitions WHERE name IN(SELECT value FROM json_each(?)) ORDER BY name",[JSON.stringify([...new Set(rows.map(r=>r.tag))])])
 const held=await read(c,plan,"SELECT json_object('donor_id',donor_id,'tag',tag,'created_at',created_at,'created_by',created_by) AS snapshot FROM cf_donor_tags WHERE donor_id IN(SELECT value FROM json_each(?)) ORDER BY donor_id,tag",[JSON.stringify(donors)])
 for(const r of rows){
  const donorId=plan.donorIds.get(r.donorExternalId),prior=existing.get('tagAssignment:'+await sha256(r.externalId)),native=held.find(t=>t.donor_id===donorId&&t.tag===r.tag)
  const error=(message:string)=>plan.diagnostics.push({...r.location,severity:'error',code:'SOURCE_TAG',message})
  const definition=definitions.find(d=>d.name===r.tag)
  if(!definition){error(`Define the target tag “${r.tag}” in Settings before reviewing this mapping.`);continue}
  if(r.expectedTagVersion!==undefined&&r.expectedTagVersion!==definition.version){error(`Target tag “${r.tag}” changed after review. Undo any applied parts and preview the current definition again.`);continue}
  if(preview)r.expectedTagVersion=definition.version
  if(prior&&!native){error(`The native tag “${r.tag}” was removed. A source replay cannot restore that later native choice.`);continue}
  await add('tagAssignment',r,{donor_id:donorId,tag:r.tag,source:parsed.source,source_on:r.sourceOn||null,codes:JSON.stringify(r.codes),owns_assignment:native?0:1,native_changed:0,imported_at:c.now,imported_by:c.actor.name},undefined,donorId)
 }
}

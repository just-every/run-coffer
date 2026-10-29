import { all, fail, sha256, sql, type Row, type Stmt } from '../db'
import type { CustomReview } from './custom-review-types'

/** Keep each durable value below D1's row limit, without discarding review originals. */
export async function customReviewWrites(id:string,review:CustomReview):Promise<Stmt[]> {
 const serialized=JSON.stringify(review),parts:string[]=[]
 if(new TextEncoder().encode(serialized).byteLength>8*1024*1024)fail('CUSTOM_SOURCE_LIMIT','This custom review exceeds 8 MB. Split the source import before carrying custom data.',413)
 for(let start=0;start<serialized.length;){
  let end=Math.min(start+16000,serialized.length)
  const last=serialized.charCodeAt(end-1)
  if(end<serialized.length&&last>=0xd800&&last<=0xdbff)end--
  parts.push(serialized.slice(start,end));start=end
 }
 const marker={storage:'parts',version:review.version,parts:parts.length,digest:await sha256(serialized)}
 return [sql('DELETE FROM cf_move_in_custom_reviews WHERE job_id=?',id),
  ...parts.map((payload,position)=>sql('INSERT INTO cf_move_in_custom_reviews(job_id,position,payload) VALUES(?,?,?)',id,position,payload)),
  sql("UPDATE cf_move_in_jobs SET report=json_set(report,'$.customReview',json(?)) WHERE id=?",JSON.stringify(marker),id)]
}

/** Older inline reviews remain readable; a partial capture can never be applied. */
export async function storedCustomReview(c:{db:D1Database},id:string,value:any):Promise<CustomReview|undefined> {
 if(!value||value.storage!=='parts')return value
 const rows=await all(c,'SELECT position,payload FROM cf_move_in_custom_reviews WHERE job_id=? ORDER BY position',id)
 if(rows.length!==value.parts||rows.some((r,i)=>r.position!==i))fail('MOVE_IN_CHANGED','This custom review is incomplete. Nothing can be carried.',409)
 const serialized=rows.map(r=>r.payload).join('')
 if(await sha256(serialized)!==value.digest)fail('MOVE_IN_CHANGED','This custom review changed. Nothing can be carried.',409)
 return JSON.parse(serialized) as CustomReview
}

/** Bound serialized parameters too: originals and snapshots repeat long source values. */
export function customJsonBatches(rows:Row[]):string[] {
 const batches:string[]=[],encoder=new TextEncoder()
 let current:string[]=[],bytes=2
 for(const row of rows){
  const value=JSON.stringify(row),size=encoder.encode(value).byteLength
  if(size>1800000)fail('CUSTOM_SOURCE_LIMIT','One custom definition or value exceeds its durable row bound. Review a smaller source value before carrying it.',413)
  if(current.length&&bytes+size+1>500000){batches.push('['+current.join(',')+']');current=[];bytes=2}
  current.push(value);bytes+=size+1
 }
 if(current.length)batches.push('['+current.join(',')+']')
 return batches
}

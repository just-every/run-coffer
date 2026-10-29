import { enteredAddress } from '../addresses/entry'
import { commit, guard, one, sql, today, type Context, type Row, type Stmt } from '../db'
import { settings } from '../settings'
import type { Plan } from './plan'

const columns=['donor_id','version','fingerprint','status','reason','codes','checked_at','source','move_effective_month']
const checkSnapshot=(alias='n')=>`json_object(${columns.map(k=>`'${k}',${alias}.${k}`).join(',')})`
const sourceLabel=(jobId:string)=>'lgl source before verification '+jobId

/** The existing entry verifier owns normalization and refusals. Additional
 * addresses never overwrite verification of a different primary address. */
export async function lglAddresses(c:Context,plan:Plan,jobId:string):Promise<Stmt[]>{
 const writes:Stmt[]=[],day=today((await settings(c)).timezone,new Date(c.now))
 const contacts=plan.effects.filter(e=>e.kind==='contact'&&e.owned&&e.row.kind==='address')
 const donors=plan.effects.filter(e=>e.kind==='donor'&&e.owned&&e.row.address_line1)
 const tasks=[...contacts.map(e=>({point:e,donor:plan.effects.find(d=>d.kind==='donor'&&d.nativeId===e.donorId)?.row??plan.profileChanges.find(d=>d.after.id===e.donorId)?.after})),...donors.filter(d=>!contacts.some(p=>p.donorId===d.nativeId&&p.row.is_primary)).map(d=>({point:undefined,donor:d.row}))]
 if(!tasks.length)return writes
 await commit(c,[])
 for(const task of tasks){
  const point=task.point,base=task.donor
  if(!base)continue
  const a=point?JSON.parse(point.row.value):{line1:base.address_line1,line2:base.address_line2,city:base.city,region:base.region,postalCode:base.postal_code,country:base.country}
  const original:Row={...base,address_line1:a.line1,address_line2:a.line2||null,city:a.city,region:a.region,postal_code:a.postalCode,country:a.country}
  const primary=!point||point.row.is_primary===1,owned=donors.some(d=>d.nativeId===base.id)
  const prior=primary&&!owned?await one(c,`SELECT ${checkSnapshot()} AS snapshot FROM cf_address_checks n WHERE donor_id=?`,base.id):null
  if(primary&&!owned)plan.checks.push(prior?guard(`EXISTS(SELECT 1 FROM cf_address_checks n WHERE donor_id=? AND ${checkSnapshot()}=?)`,'MOVE_IN_CHANGED','Address verification changed during this import.',base.id,prior.snapshot):guard('NOT EXISTS(SELECT 1 FROM cf_address_checks WHERE donor_id=?)','MOVE_IN_CHANGED','Address verification changed during this import.',base.id))
  const checked=await enteredAddress(c,original),normalized=checked.donor
  writes.push(...checked.statements.filter(s=>primary||!s.sql.startsWith('INSERT INTO cf_address_checks')))
  if(!checked.statements.length)writes.push(guard('NOT EXISTS(SELECT 1 FROM cf_address_processing WHERE enabled=1)','ADDRESS_CONNECTION_CHANGED','Address processing changed; preview and apply again.'))
  else if(primary&&!owned)writes.push(sql(`UPDATE cf_move_in_jobs SET report=json_set(report,?,json_object('before',json(CASE WHEN json_type(report,?) IS NOT NULL THEN json_extract(report,?) ELSE ? END),'after',json((SELECT ${checkSnapshot()} FROM cf_address_checks n WHERE donor_id=?)))) WHERE id=?`,`$.addressCheckpoints.${base.id}`,`$.addressCheckpoints.${base.id}.before`,`$.addressCheckpoints.${base.id}.before`,prior?.snapshot??'null',base.id,jobId))
  const fields=['address_line1','address_line2','city','region','postal_code','country']
  if(fields.some(k=>(original[k]||'')!==(normalized[k]||'')))writes.push(sql('INSERT INTO cf_donor_address_history(donor_id,address_line1,address_line2,city,region,postal_code,country,until_on,source,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)',base.id,original.address_line1,original.address_line2,original.city,original.region,original.postal_code,original.country,day,sourceLabel(jobId),c.now))
  if(point)point.row.value=JSON.stringify({line1:normalized.address_line1,line2:normalized.address_line2||'',city:normalized.city,region:normalized.region,postalCode:normalized.postal_code,country:normalized.country})
  if(primary)for(const field of fields)base[field]=normalized[field]
 }
 return writes
}

export const lglAddressUndoFence=(jobId:string)=>guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_jobs j,json_each(j.report,'$.addressCheckpoints') p LEFT JOIN cf_address_checks n ON n.donor_id=p.key WHERE j.id=? AND (n.donor_id IS NULL OR ${checkSnapshot()}<>json_extract(p.value,'$.after')))`,'MOVE_IN_USED','An imported address was checked again. Nothing was undone.',jobId)

export function lglAddressUndoWrites(jobId:string):Stmt[]{
 const checkpoints=`SELECT p.key,p.value FROM cf_move_in_jobs j,json_each(j.report,'$.addressCheckpoints') p WHERE j.id=?`
 return [sql(`DELETE FROM cf_address_checks WHERE donor_id IN(SELECT key FROM (${checkpoints}))`,jobId),
  sql(`INSERT INTO cf_address_checks(${columns.join(',')}) SELECT ${columns.map(k=>`json_extract(value,'$.before.${k}')`).join(',')} FROM (${checkpoints}) WHERE json_type(value,'$.before')='object'`,jobId),
  sql('DELETE FROM cf_donor_address_history WHERE source IN(?,?)',sourceLabel(jobId),'lgl profile enrichment '+jobId)]
}

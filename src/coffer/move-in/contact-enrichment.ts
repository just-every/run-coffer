import { event, guard, sql, today, type Context, type Row, type Stmt } from '../db'
import { settings } from '../settings'
import { importedOverrides } from '../person-names'
import { snapshot, type Kind } from './tables'
import type { Located, ParsedImport } from './types'
import type { Plan } from './plan'

type Add=(kind:Kind,entity:Located&{externalId:string},row:Row,match?:string,donorId?:string|null,relatedId?:string|null)=>Promise<string>
type Read=(c:Context,plan:Plan,query:string,params?:unknown[])=>Promise<Row[]>
export type ProfileChange={before:Row;after:Row}
const fields=['prefix','first_name','middle_name','last_name','suffix','nickname','informal_salutation','formal_salutation','envelope_name','email','phone','address_line1','address_line2','city','region','postal_code','country']
const sameAddress=(a:string,b:string)=>{
 const left=JSON.parse(a),right=JSON.parse(b)
 return ['line1','line2','city','region','postalCode','country'].every(k=>(left[k]||'')===(right[k]||''))
}

/** Later source reports may fill omissions, never replace a current choice.
 * Existing points are linked without claiming ownership; only new points are
 * removed by this review's undo. All reads are repeated transaction guards. */
export async function planContactEnrichment(c:Context,parsed:ParsedImport,plan:Plan,existing:Map<string,Row>,add:Add,read:Read,sourceKey:(key:string)=>Promise<string>,nameDefaults:string){
 if(parsed.source!=='lgl')return
 const ids=[...plan.donorIds.values()].filter(id=>!plan.effects.some(e=>e.kind==='donor'&&e.owned&&e.nativeId===id))
 if(!ids.length)return
 const people=await read(c,plan,`SELECT ${snapshot('donor')} AS snapshot FROM cf_donors n WHERE id IN(SELECT value FROM json_each(?)) ORDER BY id`,[JSON.stringify(ids)])
 const held=await read(c,plan,`SELECT ${snapshot('contact')} AS snapshot FROM cf_contact_points n WHERE donor_id IN(SELECT value FROM json_each(?)) ORDER BY id`,[JSON.stringify(ids)])
 for(const d of parsed.donors){
  const donorId=plan.donorIds.get(d.externalId),before=people.find(p=>p.id===donorId)
  if(!before)continue
  const priorDonor=existing.get('donor:'+await sourceKey(d.externalId))
  const original=priorDonor?.snapshot?JSON.parse(priorDonor.snapshot):null
  const after={...before},points=held.filter(p=>p.donor_id===donorId)
  const error=(message:string)=>plan.diagnostics.push({...d.location,severity:'error',code:'CONTACT_NATIVE',message})
  for(const point of d.contacts??[]){
   const prior=existing.get('contact:'+await sourceKey(point.externalId))
   const row={donor_id:donorId,kind:point.kind,type:point.type,value:point.value,active:1,is_primary:point.primary?1:0,starts_on:point.startsOn,ends_on:point.endsOn,version:1,source:'lgl move-in',source_on:c.now.slice(0,10),updated_at:c.now}
   if(prior){
    const current=points.find(p=>p.id===prior.native_id&&p.active)
    if(!current||!prior.snapshot||JSON.stringify(current)!==prior.snapshot)error('A previously imported contact changed or was removed. This source report cannot replace the native choice or restore it.')
    await add('contact',{...point,location:d.location},row,undefined,donorId)
    continue
   }
   if(priorDonor&&priorDonor.native_id!==donorId){error('Review new contacts on the surviving donor after a merge; a source replay cannot enrich the old identity.');continue}
   const match=points.find(p=>p.kind===point.kind&&(point.kind==='address'?sameAddress(p.value,point.value):p.value===point.value))
   if(match){
    if(!match.active||match.type!==point.type||!!match.is_primary!==point.primary||match.starts_on!==point.startsOn||match.ends_on!==point.endsOn){error('An existing contact has a different type, primary choice or seasonal range. Review it in Coffer and export the intended current contact set.');continue}
    await add('contact',{...point,location:d.location},row,match.id,donorId)
    continue
   }
   if(point.primary&&points.some(p=>p.kind===point.kind&&p.active&&p.is_primary)){error('The source primary differs from the current primary. Review the choice in Coffer before importing; neither primary is replaced.');continue}
   if(point.type==='seasonal'&&points.some(p=>p.active&&p.type==='seasonal'&&Array.from({length:366},(_,i)=>new Date(Date.UTC(2000,0,1+i)).toISOString().slice(5,10)).some(day=>{
    const within=(from:string,to:string)=>from<=to?day>=from&&day<=to:day>=from||day<=to
    return within(point.startsOn!,point.endsOn!)&&within(p.starts_on,p.ends_on)
   }))){error('A new seasonal address overlaps a current seasonal address. Review the ranges before importing.');continue}
   if(point.primary){
    if(point.kind==='address'){
     if(before.address_line1){error('The current postal address has no matching source contact. Review it before importing.');continue}
     const a=JSON.parse(point.value);Object.assign(after,{address_line1:a.line1,address_line2:a.line2||null,city:a.city,region:a.region,postal_code:a.postalCode,country:a.country})
    }else{
     if(before[point.kind]){error('The current '+point.kind+' has no matching source contact. Review it before importing.');continue}
     after[point.kind]=point.value
    }
   }
   await add('contact',{...point,location:d.location},row,undefined,donorId)
  }
  // Name omissions from an earlier source report can be filled only while the
  // native identity and those fields still match the earlier custody snapshot.
  if(original&&original.id===donorId&&before.name===d.name&&original.version===before.version){
   const parts={prefix:d.prefix,first_name:d.firstName,middle_name:d.middleName,last_name:d.lastName,suffix:d.suffix,nickname:d.nickname}
   const names:Row={...parts,...importedOverrides({...before,...Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,before[k]||v])),name_defaults:nameDefaults},{informal:d.informalName,formal:d.formalName,envelope:d.envelopeName})}
   for(const [field,value] of Object.entries(names))if(value&&!before[field]&&!original[field])after[field]=value
  }
  if(fields.some(field=>after[field]!==before[field])||plan.effects.some(e=>e.kind==='contact'&&e.owned&&e.donorId===donorId)){after.version=before.version+1;plan.profileChanges.push({before,after})}
 }
}

/** Checkpoints live in the existing private, erasure-aware review journal. */
export async function importedProfileWrites(c:Context,changes:ProfileChange[],jobId:string):Promise<Stmt[]>{
 if(!changes.length)return []
 const day=today((await settings(c)).timezone,new Date(c.now))
 return changes.flatMap(({before,after})=>[
  sql(`UPDATE cf_move_in_jobs SET report=json_set(report,?,json_object('before',json(COALESCE(json_extract(report,?),?)),'after',json(?))) WHERE id=?`,`$.profileCheckpoints.${after.id}`,`$.profileCheckpoints.${after.id}.before`,JSON.stringify(before),JSON.stringify(after),jobId),
  guard(`EXISTS(SELECT 1 FROM cf_donors n WHERE id=? AND ${snapshot('donor')}=?)`,'MOVE_IN_CHANGED','This donor changed after contact review.',before.id,JSON.stringify(before)),
  sql('INSERT INTO cf_contact_edit VALUES(1)'),
  sql('INSERT OR REPLACE INTO cf_address_moves(donor_id,effective_on,source) VALUES(?,?,?)',after.id,day,'lgl profile enrichment '+jobId),
  sql(`UPDATE cf_donors SET version=?,${fields.map(f=>f+'=?').join(',')} WHERE id=?`,after.version,...fields.map(f=>after[f]),after.id),
  sql('DELETE FROM cf_address_moves WHERE donor_id=?',after.id),
  sql('DELETE FROM cf_donor_address_history WHERE donor_id=? AND source=? AND address_line1 IS NULL',after.id,'lgl profile enrichment '+jobId),
  sql('DELETE FROM cf_contact_edit'),
  // Advance only custody we actually held before this change. A staff edit
  // must continue to fence the earlier import after enrichment is undone.
  sql(`UPDATE cf_move_in_records SET snapshot=(SELECT ${snapshot('donor')} FROM cf_donors n WHERE n.id=cf_move_in_records.native_id) WHERE kind='donor' AND native_id=? AND snapshot=?`,after.id,JSON.stringify(before)),
  event(c,'move-in.profile-enrichment','donor',after.id,after.id,{jobId,fields:fields.filter(f=>before[f]!==after[f])}),
 ])
}

export const profileUndoFence=(jobId:string)=>guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_jobs j,json_each(j.report,'$.profileCheckpoints') p LEFT JOIN cf_donors n ON n.id=p.key WHERE j.id=? AND (n.id IS NULL OR ${snapshot('donor')}<>json_extract(p.value,'$.after')))`,'MOVE_IN_USED','An enriched donor changed after this review. Nothing was undone.',jobId)

export async function profileUndoWrites(c:Context,jobId:string):Promise<Stmt[]>{
 const day=today((await settings(c)).timezone,new Date(c.now))
 const affected=`SELECT key FROM cf_move_in_jobs j,json_each(j.report,'$.profileCheckpoints') WHERE j.id=?`
 return [
  sql('INSERT INTO cf_contact_edit VALUES(1)'),
  sql(`INSERT OR REPLACE INTO cf_address_moves(donor_id,effective_on,source) SELECT key,?,? FROM (${affected})`,day,'lgl profile enrichment '+jobId,jobId),
  sql(`UPDATE cf_donors SET version=version+1,${fields.map(f=>`${f}=json_extract((SELECT report FROM cf_move_in_jobs WHERE id=?),'$.profileCheckpoints.'||cf_donors.id||'.before.${f}')`).join(',')} WHERE id IN(${affected})`,...fields.map(()=>jobId),jobId),
  sql(`DELETE FROM cf_address_moves WHERE donor_id IN(${affected})`,jobId),
  sql('DELETE FROM cf_contact_edit'),
  sql(`UPDATE cf_move_in_records SET snapshot=(SELECT ${snapshot('donor')} FROM cf_donors n WHERE n.id=cf_move_in_records.native_id) WHERE kind='donor' AND native_id IN(${affected}) AND snapshot=json_extract((SELECT report FROM cf_move_in_jobs WHERE id=?),'$.profileCheckpoints.'||cf_move_in_records.native_id||'.after')`,jobId,jobId),
 ]
}

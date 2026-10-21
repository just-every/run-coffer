import { all, event, sql, today, type Context, type Row, type Stmt } from '../db'
import { settings } from '../settings'
import type { Effect, Plan } from './plan'
import { snapshot, type Kind } from './tables'
import type { Located, ParsedImport } from './types'

type Add=(kind:Kind,entity:Located&{externalId:string},row:Row,match?:string,donorId?:string|null,relatedId?:string|null)=>Promise<string>
type Read=(c:Context,plan:Plan,query:string,params?:unknown[])=>Promise<Row[]>
export async function planSolicitationImports(c:Context,parsed:ParsedImport,plan:Plan,existing:Map<string,Row>,add:Add,read:Read) {
 const restrictions=parsed.solicitations??[], withdrawals=parsed.channelWithdrawals??[]
 if(!restrictions.length&&!withdrawals.length)return
 const ids=[...new Set([...restrictions,...withdrawals].map(r=>plan.donorIds.get(r.donorExternalId)).filter(Boolean))]
 const [current,consents,sequence]=await Promise.all([
  read(c,plan,`SELECT ${snapshot('solicitation')} AS snapshot FROM cf_solicitation n WHERE donor_id IN (SELECT value FROM json_each(?)) ORDER BY donor_id`,[JSON.stringify(ids)]),
  read(c,plan,`SELECT ${snapshot('consent')} AS snapshot FROM cf_consents n WHERE donor_id IN (SELECT value FROM json_each(?)) ORDER BY id`,[JSON.stringify(ids)]),
  read(c,plan,"SELECT json_object('id',COALESCE(MAX(id),0)) AS snapshot FROM cf_consents"),
 ])
 const day=today((await settings(c)).timezone,new Date(c.now))
 const previous=(kind:string,nativeId:string|number)=>[...existing.values()].find(r=>r.kind===kind&&String(r.native_id)===String(nativeId))
 const conflict=(row:Located,message:string)=>plan.diagnostics.push({...row.location,severity:'error',code:'SOLICITATION_CHANGED',column:'Communication Restrictions / Solicit Codes',message})
 for(const r of restrictions) {
  const donorId=plan.donorIds.get(r.donorExternalId)??'', held=current.find(s=>s.donor_id===donorId), prior=previous('solicitation',donorId)
  if(held&&(!prior||JSON.stringify(held)!==prior.snapshot))conflict(r,`Constituent ${r.donorExternalId} has a staff-edited or separately recorded restriction. The import cannot replace it; resolve the source and current restriction explicitly.`)
  await add('solicitation',r,{donor_id:donorId,version:1,type:r.type,starts_on:r.sourceOn||day,ends_on:null,channels:JSON.stringify(r.channels),max_asks:r.maxAsks,source:'import',source_ref:`${parsed.source}:${r.donorExternalId}`,source_on:r.sourceOn||day,recorded_at:c.now,recorded_by_id:c.actor.id,recorded_by_name:c.actor.name},undefined,donorId)
 }
 let next=Number(sequence[0].id)
 for(const r of withdrawals) {
  const donorId=plan.donorIds.get(r.donorExternalId)??''
  const prior=[...existing.values()].find(m=>m.kind==='consent'&&m.snapshot&&JSON.parse(m.snapshot).donor_id===donorId&&JSON.parse(m.snapshot).channel===r.channel)
  const held=consents.filter(s=>s.donor_id===donorId&&s.channel===r.channel).at(-1)
  if(held&&(!prior||JSON.stringify(held)!==prior.snapshot))conflict(r,`Constituent ${r.donorExternalId} has a newer or separately recorded ${r.channel} preference. The import cannot overwrite it.`)
  await add('consent',r,{id:++next,donor_id:donorId,channel:r.channel,status:'withdrawn',method:`${parsed.source} export`,evidence:`Imported communication restriction: ${r.codes.join('; ')}`,captured_on:r.sourceOn||day,recorded_at:c.now,recorded_by:c.actor.name},undefined,donorId)
 }
}

export function solicitationImportHistory(c:Context,effects:Effect[],source:string,jobId:string):Stmt[] {
 return effects.filter(e=>e.owned&&(e.kind==='solicitation'||e.kind==='consent')).flatMap(e=>{
  const r=e.row
  const answer={type:r.type,startsOn:r.starts_on,endsOn:r.ends_on,channels:r.channels?JSON.parse(r.channels):[],maxAsks:r.max_asks,period:r.type==='limit'?'calendar-year':null,source:'import',sourceRef:r.source_ref,sourceOn:r.source_on,actorId:c.actor.id,actorName:c.actor.name,at:c.now}
  return [...(e.kind==='solicitation'?[sql('INSERT INTO cf_solicitation_history VALUES(?,?,?)',r.donor_id,r.version,JSON.stringify(answer))]:[]),event(c,e.kind==='solicitation'?'solicitation.import':'consent.import','donor',r.donor_id,r.donor_id,{jobId,source,version:r.version??null,channel:r.channel??null,sourceOn:r.source_on??r.captured_on,importedAt:c.now})]
 })
}

/** Count source-referenced identities once even when several channel flags are present. */
export async function restrictionReconciliation(c:Context,source:string,report:Row) {
 const expected=report.restrictionSource
 if(!expected)return []
 const mappings=await all(c,"SELECT source_key,native_id FROM cf_move_in_records WHERE source=? AND kind='donor'",source)
 const {sha256}=await import('../db')
 const resolved=new Map(await Promise.all((expected.donorIds as string[]).map(async key=>{const hash=await sha256(key);return [key,mappings.find(m=>m.source_key===hash)?.native_id] as const})))
 const ids=JSON.stringify([...new Set(resolved.values())].filter(Boolean))
 const [actual,withdrawn]=await Promise.all([
  all(c,"SELECT donor_id FROM cf_solicitation WHERE type<>'none' AND donor_id IN (SELECT value FROM json_each(?))",ids),
  all(c,"SELECT donor_id,channel FROM cf_consents n WHERE donor_id IN (SELECT value FROM json_each(?)) AND status='withdrawn' AND id=(SELECT MAX(id) FROM cf_consents WHERE donor_id=n.donor_id AND channel=n.channel)",ids),
 ])
 const restricted=new Set(actual.map(r=>r.donor_id)), channelKeys=new Set(withdrawn.map(r=>`${r.donor_id}:${r.channel}`)), anyWithdrawal=new Set(withdrawn.map(r=>r.donor_id))
 const count=(keys:string[],matches:(id:string)=>boolean)=>new Set(keys.map(key=>resolved.get(key)).filter((id):id is string=>!!id&&matches(id))).size
 const row=(key:string,count:number,actual:number)=>({scope:'restriction',key,sourceCount:count,cofferCount:actual,sourceCents:null,cofferCents:0,matches:count===actual})
 return [row('Restricted constituents',expected.donorIds.length,count(expected.donorIds,id=>restricted.has(id)||anyWithdrawal.has(id))),
  row('Solicitation restrictions',expected.solicitationIds.length,count(expected.solicitationIds,id=>restricted.has(id))),
  ...['email','mail','phone','sms'].map(channel=>{const sourceRows=expected.withdrawals.filter((r:Row)=>r.channel===channel);return row(`${channel} withdrawals`,sourceRows.length,count(sourceRows.map((r:Row)=>r.donorExternalId),id=>channelKeys.has(`${id}:${channel}`)))})]
}

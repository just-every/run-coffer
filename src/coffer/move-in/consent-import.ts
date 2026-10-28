import { guard, type Context, type Row } from '../db'
import { contentHash, sourceKey, type Plan } from './plan'
import { snapshot, type Kind } from './tables'
import type { Located, ParsedConsent, ParsedImport } from './types'

export const sourceNames={lgl:'Little Green Light',bloomerang:'Bloomerang','re-nxt':"Raiser's Edge NXT"}
type Add=(kind:Kind,entity:Located&{externalId:string},row:Row,match?:string,donorId?:string|null,relatedId?:string|null)=>Promise<string>
type Read=(c:Context,plan:Plan,query:string,params?:unknown[])=>Promise<Row[]>

/** A channel withdrawal wins over a source grant. One authoritative row per
 * donor and channel prevents insertion order from turning an opt-out into yes. */
export function importedConsents(parsed:ParsedImport):ParsedConsent[] {
 const rows=new Map((parsed.consents??[]).map(r=>[`${r.donorExternalId}:${r.channel}`,r]))
 for(const w of parsed.channelWithdrawals??[])rows.set(`${w.donorExternalId}:${w.channel}`,{...w,status:'withdrawn',evidence:`Communication restriction: ${w.codes.join('; ')}`})
 return [...rows.values()]
}

/** Reads share the import transaction's optimistic guards. A separately recorded
 * choice is never superseded, even when the source claims a later capture date. */
export async function planConsentImports(c:Context,parsed:ParsedImport,plan:Plan,existing:Map<string,Row>,add:Add,read:Read) {
 const rows=importedConsents(parsed)
 if(!rows.length)return
 const ids=[...new Set(rows.map(r=>plan.donorIds.get(r.donorExternalId)).filter(Boolean))]
 const [consents,sequence]=await Promise.all([
  read(c,plan,`SELECT ${snapshot('consent')} AS snapshot FROM cf_consents n WHERE donor_id IN (SELECT value FROM json_each(?)) ORDER BY id`,[JSON.stringify(ids)]),
  read(c,plan,"SELECT json_object('id',COALESCE(MAX(id),0)) AS snapshot FROM cf_consents"),
 ])
 let next=Number(sequence[0].id)
 for(const r of rows) {
  const donorId=plan.donorIds.get(r.donorExternalId)??''
  const entity=parsed.channelWithdrawals?.find(w=>w.externalId===r.externalId)??r
  const previous=existing.get(`consent:${await sourceKey(entity.externalId)}`)
  const {location:_,...payload}=entity
  // An unchanged source answer is already history. Reusing it never writes a
  // preference, including after a merge or a later native choice.
  if(previous?.snapshot&&previous.content_hash===await contentHash(payload)) {
   await add('consent',entity,{})
   continue
  }
  const latest=consents.filter(s=>s.donor_id===donorId&&s.channel===r.channel).at(-1)
  const prior=latest&&[...existing.values()].find(m=>m.kind==='consent'&&String(m.native_id)===String(latest.id))
  if(latest&&(!prior||JSON.stringify(latest)!==prior.snapshot))plan.diagnostics.push({...r.location,severity:'error',code:'CONSENT_CHANGED',column:r.channel+' consent',message:`Constituent ${r.donorExternalId} has a newer or separately recorded ${r.channel} preference. The import cannot overwrite it.`})
  await add('consent',entity,{id:++next,donor_id:donorId,channel:r.channel,status:r.status,method:`${sourceNames[parsed.source]} export`,evidence:`${r.evidence} · Source constituent: ${r.donorExternalId} · Source date: ${r.sourceOn||'unknown'} · Imported: ${c.now}`,captured_on:r.sourceOn,recorded_at:c.now,recorded_by:c.actor.name},undefined,donorId)
 }
}

/** Later choices and outbound snapshots keep the imported row as history,
 * including when the donor itself belonged to an earlier import. */
export function consentUndoFence(jobId:string) {
 return guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records r JOIN cf_consents k ON k.id=r.native_id
   WHERE r.job_id=? AND r.kind='consent' AND r.owned=1 AND (
    EXISTS(SELECT 1 FROM cf_consents n WHERE n.donor_id=k.donor_id AND n.channel=k.channel AND n.id>k.id AND n.id NOT IN(SELECT native_id FROM cf_move_in_records WHERE job_id=? AND kind='consent' AND owned=1))
    OR EXISTS(SELECT 1 FROM cf_appeal_recipients a WHERE a.consent_id=k.id)
    OR EXISTS(SELECT 1 FROM cf_preference_sync s WHERE s.consent_id=k.id)
    OR EXISTS(SELECT 1 FROM cf_recovery_steps s WHERE s.consent_id=k.id)
   ))`,'MOVE_IN_USED','A newer preference or prepared audience depends on this consent history. Nothing was undone.',jobId,jobId)
}

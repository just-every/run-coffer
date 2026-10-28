import { event, sha256, type Context, type Row } from '../db'
import type { Plan } from './plan'
import { normalizeLabel } from './source-columns'
import { snapshot, type Kind } from './tables'
import type { Located, ParsedImport } from './types'

type Add = (kind: Kind, entity: Located & {externalId:string}, row: Row, match?: string, donorId?: string | null, relatedId?: string | null) => Promise<string>
type Read = (c: Context, plan: Plan, query: string, params?: unknown[]) => Promise<Row[]>
const interactionKinds: Record<string,string> = {email:'email',phonecall:'call',inperson:'meeting'}
const sourceNames = {lgl:'Little Green Light',bloomerang:'Bloomerang','re-nxt':"Raiser's Edge NXT",spreadsheet:'Spreadsheet',givebutter:'Givebutter',zeffy:'Zeffy'}

/** Source IDs resolve only through importer custody. A soft credit's evidence
 * belongs to its credited constituent, independently of the hard-credit donor. */
export async function planAcknowledgmentImports(c: Context, parsed: ParsedImport, plan: Plan, existing: Map<string,Row>, add: Add, read: Read) {
 const entities = [...parsed.gifts.map(entity=>({kind:'acknowledgment' as const,entity})),...parsed.softCredits.map(entity=>({kind:'softCreditAcknowledgment' as const,entity}))].filter(e=>e.entity.acknowledgment)
 if (!entities.length) return
 const entries = await Promise.all(entities.map(async e=>{
  const key=await sha256(e.entity.externalId), reference=e.entity.acknowledgment!.interactionExternalId
  const nativeId=e.kind==='acknowledgment' ? plan.giftIds.get(e.entity.externalId) : plan.effects.find(p=>p.kind==='softCredit'&&p.sourceKey===key)?.nativeId ?? existing.get(`softCredit:${key}`)?.native_id
  return {...e,key,nativeId,referenceKey:reference ? await sha256(reference) : null}
 }))
 const linkedIds=[...new Set(entries.flatMap(e=>{
  const id=e.referenceKey && (plan.effects.find(p=>p.kind==='interaction'&&p.sourceKey===e.referenceKey)?.nativeId ?? existing.get(`interaction:${e.referenceKey}`)?.native_id)
  return id ? [id] : []
 }))]
 const [interactions,gifts,credits]=await Promise.all([
  read(c,plan,`SELECT ${snapshot('interaction')} AS snapshot FROM cf_interactions n WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`,[JSON.stringify(linkedIds)]),
  read(c,plan,`SELECT ${snapshot('acknowledgment')} AS snapshot FROM cf_gift_acknowledgments n WHERE gift_id IN (SELECT value FROM json_each(?)) ORDER BY gift_id`,[JSON.stringify(entries.filter(e=>e.kind==='acknowledgment').map(e=>e.nativeId))]),
  read(c,plan,`SELECT ${snapshot('softCreditAcknowledgment')} AS snapshot FROM cf_soft_credit_acknowledgments n WHERE soft_credit_id IN (SELECT value FROM json_each(?)) ORDER BY soft_credit_id`,[JSON.stringify(entries.filter(e=>e.kind==='softCreditAcknowledgment').map(e=>e.nativeId))]),
 ])
 for(const {kind,entity,key,nativeId,referenceKey} of entries) {
  const a=entity.acknowledgment!, donorId=plan.donorIds.get(entity.donorExternalId)!, soft=kind==='softCreditAcknowledgment', label=`${soft?'Soft credit':'Gift'} ${entity.externalId}`
  const error=(message:string)=>plan.diagnostics.push({...entity.location,severity:'error',code:'ACKNOWLEDGMENT_LINK',column:'Acknowledgment Interaction ID',message})
  const current=soft ? credits : gifts, primary=soft?'soft_credit_id':'gift_id'
  if(current.some(r=>r[primary]===nativeId)&&!existing.has(`${kind}:${key}`)) error(`${label} already has a separately recorded acknowledgment. The move-in cannot replace it; resolve the current record before importing source status.`)
  let interactionId:string|null=null
  if(referenceKey) {
   const effect=plan.effects.find(e=>e.kind==='interaction'&&e.sourceKey===referenceKey), prior=existing.get(`interaction:${referenceKey}`)
   const interaction=effect?.row ?? interactions.find(r=>r.id===prior?.native_id)
   if(!interaction || prior?.snapshot===null) error(`${label}: acknowledgment interaction ${a.interactionExternalId} is missing or erased. Include its source interaction row with its stable ID, or import that interaction first.`)
   else if(interaction.donor_id!==donorId || a.acknowledgedOn && interaction.occurred_on!==a.acknowledgedOn || a.method && interaction.kind!==interactionKinds[normalizeLabel(a.method)]) error(`${label}: acknowledgment interaction ${a.interactionExternalId} must belong to its ${soft?'credited constituent':'donor'} and match the source acknowledgment date and method when supplied. Correct the exported link or history.`)
   else interactionId=interaction.id
  }
  const row:Row={[primary]:nativeId,version:1,status:a.status,acknowledged_on:a.acknowledgedOn,method:a.method,interaction_id:interactionId,note_id:null,reason:a.reason,source_reference:a.sourceReference,source:sourceNames[parsed.source],updated_at:c.now,updated_by:c.actor.name}
  if(!soft)Object.assign(row,{batch_id:null,letter_id:null,communication_id:null,outcome_unknown:0,updated_by_id:c.actor.id,updated_by_role:c.actor.role,change_source:'automatic'})
  await add(kind,{externalId:entity.externalId,location:entity.location,...a},row,undefined,donorId)
 }
}

/** Native soft-credit setters own their existing manual audit. Reviewed imports
 * publish their separate changes without source reason or interaction text. */
export function importedAcknowledgmentEvents(c:Context,plan:Plan,source:string,jobId:string) {
 return plan.effects.filter(e=>e.kind==='softCreditAcknowledgment'&&e.owned).map(e=>event(c,'softCredit.acknowledgment.import','softCredit',e.nativeId,e.donorId,{jobId,source:'import',sourceCrm:source,oldStatus:'not acknowledged',status:e.row.status,acknowledgedOn:e.row.acknowledged_on,method:e.row.method,interactionId:e.row.interaction_id,noteId:e.row.note_id,version:e.row.version}))
}

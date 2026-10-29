import { emptyInventory, parsedInventory, previewInventory, nativeInventory, receiptOutcome } from './inventory-totals'
import { all, sha256, type Context, type Row } from '../db'
import { tributeKey } from '../tribute-groups'
import { accumulate, emptyTotals } from './source-totals'
import { outcomeScopes } from './types'
import type { OutcomeScope, OutcomeTotals, ParsedGift, ParsedImport, Total } from './types'

const statuses = ['acknowledged','not acknowledged','do not acknowledge']
export function emptyOutcomes(): OutcomeTotals {
 const out = Object.fromEntries(outcomeScopes.map(scope=>[scope,Object.create(null)])) as OutcomeTotals
 for(const scope of ['gift acknowledgment','soft-credit acknowledgment'] as const)for(const key of statuses)out[scope][key]={giftCount:0,amountCents:0}
 for(const key of ['all','none','provided','unknown'])out.goods[key]={giftCount:0,amountCents:0}
 out.tribute['']={giftCount:0,amountCents:0}
 return Object.assign(out,emptyInventory())
}
function add(out:OutcomeTotals,scope:OutcomeScope,key:string,cents:number) {
 const total:Total=out[scope][key]??={giftCount:0,amountCents:0};total.giftCount++;total.amountCents+=cents
}
function gift(out:OutcomeTotals,g:Pick<ParsedGift,'amountCents'|'goodsCents'|'tribute'> & {status:string;netCents?:number}) {
 add(out,'gift acknowledgment',g.status,g.amountCents)
 add(out,'goods','all',g.goodsCents??0)
 add(out,'goods',g.goodsCents===null?'unknown':g.goodsCents>0?'provided':'none',g.goodsCents??0)
 if(g.tribute) {
  const cents=g.netCents??g.amountCents
  add(out,'tribute','',cents);add(out,'tribute',tributeKey(g.tribute.kind,g.tribute.honoree),cents)
  if(g.tribute.sourceGroup)add(out,'tribute source group',g.tribute.sourceGroup,cents)
 }
}
export function parsedOutcomes(parsed:ParsedImport): OutcomeTotals {
 const out=emptyOutcomes()
 for(const g of parsed.gifts)gift(out,{...g,status:g.acknowledgment?.status??'not acknowledged'})
 for(const s of parsed.softCredits)add(out,'soft-credit acknowledgment',s.acknowledgment?.status??'not acknowledged',s.amountCents)
 return Object.assign(out,parsedInventory(parsed))
}
const nativeGift=(r:Row)=>({amountCents:r.amount_cents,goodsCents:r.goods==='unknown'?null:r.goods_cents,status:r.status??'not acknowledged',netCents:r.net_cents,tribute:r.tribute_kind?{kind:r.tribute_kind,honoree:r.honoree,sourceGroup:r.source_group}:undefined})
const giftColumns=`g.id,g.amount_cents,g.received_on,g.fund,g.goods,g.goods_cents,g.net_cents,a.status,a.method AS acknowledgment_method,t.kind AS tribute_kind,t.honoree,t.source_group`
const giftJoins=`LEFT JOIN cf_gift_acknowledgments a ON a.gift_id=g.id LEFT JOIN cf_gift_tributes t ON t.gift_id=g.id JOIN cf_donors d ON d.id=g.donor_id AND d.erased_at IS NULL`
/** Source membership is read in bounded chunks during preview and from the
 * durable journal after review, including identities owned by an earlier job. */
async function sourceRows(c:Context,source:string,kind:'gift'|'softCredit',keys:string[],jobId?:string):Promise<Row[]> {
 const rows:Row[]=[]
 const batches=jobId?[null]:Array.from({length:Math.ceil(keys.length/1000)},(_,i)=>keys.slice(i*1000,(i+1)*1000))
 for(const batch of batches) {
  const scope=jobId?"r.source_key IN(SELECT source_key FROM cf_move_in_outcome_refs WHERE job_id=? AND kind=?)":"r.source_key IN(SELECT value FROM json_each(?))"
  const params=jobId?[jobId,kind]:[JSON.stringify(batch)]
  const query=kind==='gift'?`SELECT r.source_key,${giftColumns} FROM cf_move_in_records r JOIN cf_gift_balances g ON g.id=r.native_id ${giftJoins}`:`SELECT r.source_key,s.amount_cents,a.status FROM cf_move_in_records r JOIN cf_soft_credits s ON s.id=r.native_id LEFT JOIN cf_soft_credit_acknowledgments a ON a.soft_credit_id=s.id JOIN cf_donors d ON d.id=s.donor_id AND d.erased_at IS NULL`
  rows.push(...await all(c,`${query} WHERE r.source=? AND r.kind=? AND ${scope}`,source,kind,...params))
 }
 return rows
}
export async function nativeOutcomeSnapshot(c:Context,source:string,giftKeys:string[],creditKeys:string[],jobId?:string) {
 const [heldGifts,heldCredits]=await Promise.all([sourceRows(c,source,'gift',giftKeys,jobId),sourceRows(c,source,'softCredit',creditKeys,jobId)])
 heldGifts.sort((a,b)=>a.source_key.localeCompare(b.source_key));heldCredits.sort((a,b)=>a.source_key.localeCompare(b.source_key))
 return {heldGifts,heldCredits,fingerprint:await sha256(JSON.stringify([heldGifts,heldCredits]))}
}
/** Existing imported identities use their current native facts; new rows use the reviewed plan. */
export async function previewOutcomes(c:Context,parsed:ParsedImport) {
 const giftKeys=await Promise.all(parsed.gifts.map(g=>sha256(g.externalId))),creditKeys=await Promise.all(parsed.softCredits.map(s=>sha256(s.externalId)))
 const {heldGifts,heldCredits,fingerprint}=await nativeOutcomeSnapshot(c,parsed.source,giftKeys,creditKeys)
 const inventory=await previewInventory(c,parsed,new Set(heldGifts.map(g=>g.source_key)))
 const gs=new Map(heldGifts.map(r=>[r.source_key,r])),ss=new Map(heldCredits.map(r=>[r.source_key,r])),totals=emptyOutcomes(),cash=emptyTotals()
 parsed.gifts.forEach((g,i)=>{
  const held=gs.get(giftKeys[i]);receiptOutcome(inventory.totals,held?(held.status??'not acknowledged'):(g.acknowledgment?.status??'not acknowledged'),held?held.acknowledgment_method:g.acknowledgment?.method??null,g.amountCents);gift(totals,held?nativeGift(held):{...g,status:g.acknowledgment?.status??'not acknowledged'})
  if(!held||held.net_cents>0)accumulate(cash,held?.net_cents??g.amountCents,held?.received_on??g.receivedOn,held?.fund??g.fund,g.donorExternalId)
 })
 parsed.softCredits.forEach((s,i)=>{const held=ss.get(creditKeys[i]);add(totals,'soft-credit acknowledgment',held?(held.status??'not acknowledged'):(s.acknowledgment?.status??'not acknowledged'),held?.amount_cents??s.amountCents)})
 return {totals:Object.assign(totals,inventory.totals),cash,creditKeys,giftKeys,fingerprint,inventory}
}
/** Rechecks read current native records, never the source controls' cached actual values. */
export async function nativeOutcomes(c:Context,job:Row) {
 const [gifts,soft]=await Promise.all([
  all(c,`SELECT ${giftColumns} FROM cf_move_in_job_gifts r JOIN cf_gift_balances g ON g.id=r.gift_id ${giftJoins} WHERE r.job_id=?`,job.id),
  sourceRows(c,job.source,'softCredit',[],job.id),
 ])
 const out=Object.assign(emptyOutcomes(),await nativeInventory(c,job))
 for(const r of gifts){gift(out,nativeGift(r));receiptOutcome(out,r.status??'not acknowledged',r.acknowledgment_method,r.amount_cents)}
 for(const s of soft)add(out,'soft-credit acknowledgment',s.status??'not acknowledged',s.amount_cents)
 return out
}

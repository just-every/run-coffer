import { type Context, type Row } from '../db'
import { contentHash, nativeId, sourceKey, type Plan } from './plan'
import type { ParsedImport } from './types'

export type AllocationChange = {replaced:Row[];origins:Row[]}
type Read = (query:string,params:unknown[])=>Promise<Row[]>

/** Explicit source links reserve their installment first. General payments fill
 * the rest. Only allocations owned by this source importer may be replaced. */
export async function planPledgeAllocations(c:Context,parsed:ParsedImport,plan:Plan,pledges:Map<string,string>,installments:Map<string,string>,read:Read) {
 const ids=[...new Set(parsed.gifts.map(g=>pledges.get(g.pledgeExternalId)).filter(Boolean))]
 if(!ids.length)return
 const schedule=await read(`SELECT json_object('id',id,'pledge_id',pledge_id,'position',position,'due_on',due_on,'amount_cents',amount_cents,'source_key',(SELECT source_key FROM cf_move_in_records r WHERE r.kind='installment' AND r.native_id=cf_pledge_balances.id AND r.source=?)) AS snapshot FROM cf_pledge_balances WHERE pledge_id IN(SELECT value FROM json_each(?)) ORDER BY due_on,position,id`,[parsed.source,JSON.stringify(ids)])
 for(const i of parsed.installments)if(!schedule.some(r=>r.id===installments.get(i.externalId)))schedule.push({id:installments.get(i.externalId),pledge_id:pledges.get(i.pledgeExternalId),position:parsed.installments.filter(x=>x.pledgeExternalId===i.pledgeExternalId).indexOf(i)+1,due_on:i.dueOn,amount_cents:i.amountCents})
 schedule.sort((a,b)=>a.due_on.localeCompare(b.due_on)||a.position-b.position||a.id.localeCompare(b.id))
 const active=await read(`SELECT json_object('id',a.id,'gift_id',a.gift_id,'installment_id',a.installment_id,'amount_cents',a.amount_cents,'source',COALESCE(s.source,r.source),'explicit_installment_id',s.explicit_installment_id,'source_file',COALESCE(s.source_file,'Earlier import'),'source_gift_id',s.source_gift_id) AS snapshot FROM cf_pledge_active_allocations a JOIN cf_pledge_installments i ON i.id=a.installment_id LEFT JOIN cf_move_in_allocation_sources s ON s.allocation_id=a.id LEFT JOIN cf_move_in_records r ON r.kind='allocation' AND r.native_id=a.id AND r.owned=1 WHERE i.pledge_id IN(SELECT value FROM json_each(?)) ORDER BY a.id`,[JSON.stringify(ids)])
 const payments=await read(`SELECT json_object('id',g.id,'pledge_id',g.pledge_id,'donor_id',g.donor_id,'amount_cents',b.net_cents,'received_on',g.received_on,'source_gift_id',s.source_gift_id,'source_file',COALESCE(s.source_file,'Earlier import'),'explicit_installment_id',s.explicit_installment_id) AS snapshot FROM cf_gifts g JOIN cf_gift_balances b ON b.id=g.id JOIN cf_move_in_records r ON r.kind='gift' AND r.native_id=g.id AND r.owned=1 AND r.source=? LEFT JOIN cf_move_in_allocation_sources s ON s.allocation_id=(SELECT a.id FROM cf_pledge_active_allocations a WHERE a.gift_id=g.id ORDER BY a.id LIMIT 1) WHERE g.pledge_id IN(SELECT value FROM json_each(?)) AND g.kind='gift' ORDER BY g.received_on,g.id`,[parsed.source,JSON.stringify(ids)])
 for(const g of parsed.gifts){
  const pledgeId=pledges.get(g.pledgeExternalId);if(!pledgeId)continue
  const explicitKey=g.installmentExternalId?await sourceKey(g.installmentExternalId):null
  const explicit=g.installmentExternalId?(installments.get(g.installmentExternalId)||schedule.find(i=>i.source_key===explicitKey)?.id):null
  if(g.installmentExternalId&&!schedule.some(i=>i.id===explicit&&i.pledge_id===pledgeId))plan.diagnostics.push({...g.location,severity:'error',code:'INSTALLMENT_LINK',message:'The payment installment must belong to its imported pledge. Review its Installment ID.'})
  let payment=payments.find(p=>p.id===plan.giftIds.get(g.externalId))
  if(!payment){payment={id:plan.giftIds.get(g.externalId),pledge_id:pledgeId,donor_id:plan.donorIds.get(g.donorExternalId),amount_cents:g.amountCents,received_on:g.receivedOn};payments.push(payment)}
  Object.assign(payment,{source_gift_id:g.externalId,source_file:g.location.file,explicit_installment_id:explicit,location:g.location})
 }
 const desired:Row[]=[],remaining=new Map(schedule.map(i=>[i.id,i.amount_cents]))
 const managed=new Set(payments.map(p=>p.id))
 for(const a of active)if(a.source!==parsed.source||!managed.has(a.gift_id))remaining.set(a.installment_id,Math.max(0,(remaining.get(a.installment_id)??0)-a.amount_cents))
 payments.sort((a,b)=>Number(!!b.explicit_installment_id)-Number(!!a.explicit_installment_id)||a.received_on.localeCompare(b.received_on)||a.id.localeCompare(b.id))
 for(const p of payments){
  let balance=Math.max(0,p.amount_cents-active.filter(a=>a.gift_id===p.id&&a.source!==parsed.source).reduce((n,a)=>n+a.amount_cents,0))
  for(const i of schedule.filter(i=>i.pledge_id===p.pledge_id&&(!p.explicit_installment_id||i.id===p.explicit_installment_id))){
   const cents=Math.min(balance,remaining.get(i.id)??0);if(!cents)continue
   desired.push({gift_id:p.id,installment_id:i.id,amount_cents:cents,payment:p});remaining.set(i.id,(remaining.get(i.id)??0)-cents);balance-=cents
  }
  if(p.explicit_installment_id&&balance>0)plan.diagnostics.push({...p.location,severity:'error',code:'INSTALLMENT_LINK',message:'Linked payments exceed the installment balance. Review the source payment links; no allocation was replaced.'})
 }
 const owned=active.filter(a=>a.source===parsed.source&&managed.has(a.gift_id))
 for(const a of owned)if(!desired.some(d=>d.gift_id===a.gift_id&&d.installment_id===a.installment_id&&d.amount_cents===a.amount_cents))plan.allocationChanges.replaced.push(a)
 const revision=await contentHash(active)
 for(const d of desired){
  if(owned.some(a=>a.gift_id===d.gift_id&&a.installment_id===d.installment_id&&a.amount_cents===d.amount_cents))continue
  const key=JSON.stringify([d.gift_id,d.installment_id,d.amount_cents,revision]),id=await nativeId(parsed.source,'allocation',key),p=d.payment
  const row={id,gift_id:d.gift_id,installment_id:d.installment_id,amount_cents:d.amount_cents,created_at:c.now,created_by:c.actor.name}
  plan.effects.push({kind:'allocation',sourceKey:await sourceKey(key),contentHash:await contentHash(row),nativeId:id,owned:true,row,donorId:p.donor_id,relatedId:null,location:p.location})
  plan.allocationChanges.origins.push({allocation_id:id,source_file:p.source_file,source_gift_id:p.source_gift_id??p.id,explicit_installment_id:p.explicit_installment_id??null})
 }
}

import { all, fail, guard, one, type Context } from '../db'
import { giftBatch } from '../gift-batches'
import { restrictionLabel } from '../restricted-funds'
import { csv, dollars, fundJournal } from './exports'
import { submitDeposit, type PaymentsEnv } from './pantry'

/** Original closed-batch gifts fund the deposit; later reversals stay separate. */
export async function batchDeposit(c: Context, batchId: string) {
 const batch=await giftBatch(c,batchId)
 const lines=await all(c,`SELECT g.id AS gift_id,g.version,COALESCE(a.id,g.id) AS id,d.name AS donor_name,
  COALESCE(a.fund,g.fund) AS fund,COALESCE(a.amount_cents,g.amount_cents) AS amount_cents,
  g.reference,COALESCE(f.restriction,'unrestricted') AS restriction,f.detail,f.release_on
  FROM cf_batch_entries e JOIN cf_gifts g ON g.id=e.gift_id JOIN cf_donors d ON d.id=g.donor_id
  LEFT JOIN cf_gift_allocations a ON a.gift_id=g.id
  LEFT JOIN cf_funds f ON f.name=COALESCE(a.fund,g.fund)
  WHERE e.batch_id=? ORDER BY g.id,a.position`,batchId)
 const byFund=new Map<string,any>()
 for(const line of lines){const split=byFund.get(line.fund)??{fund:line.fund,gross_cents:0,fee_cents:0,net_cents:0,restriction:line.restriction,detail:line.detail,release_on:line.release_on};split.gross_cents+=line.amount_cents;split.net_cents+=line.amount_cents;byFund.set(line.fund,split)}
 return {batch,lines,splits:[...byFund.values()].sort((a,b)=>a.fund.localeCompare(b.fund)),posting:await one(c,'SELECT * FROM cf_batch_postings WHERE batch_id=?',batchId),qboPosting:await one(c,"SELECT * FROM cf_qbo_postings WHERE kind='batch' AND source_id=?",batchId)}
}
export function batchEvidence(view: Awaited<ReturnType<typeof batchDeposit>>) {
 return csv([['Batch ID','Deposit date','Payment method','Gift ID','Check reference','Fund','Amount','Restriction'],
  ...view.lines.map(l=>[view.batch.id,view.batch.received_on,view.batch.method,l.gift_id,l.reference,l.fund,dollars(l.amount_cents),restrictionLabel(l)])],[6])
}
export async function postBatchToPantry(c:Context,env:PaymentsEnv,view:Awaited<ReturnType<typeof batchDeposit>>,documentId?:string){
 const {batch,lines,splits}=view
 return submitDeposit(c,env,{id:batch.id,kind:'batch',prepare:()=>{
 if(batch.status!=='closed'||!lines.length||lines.reduce((n,l)=>n+l.amount_cents,0)!==batch.expected_cents)fail('BATCH_NOT_READY','Close a balanced batch before submitting its deposit.',409)
 const journal=fundJournal({reference:`${batch.method==='check'?'Check':'Cash'} batch ${batch.id}`,date:batch.received_on,amountCents:batch.expected_cents,splits},env)
 return {csv:batchEvidence(view),journal,guards:[
  guard("EXISTS(SELECT 1 FROM cf_gift_batches WHERE id=? AND status='closed' AND version=? AND expected_cents=?)",'BATCH_CHANGED','The batch changed. Download fresh evidence before submitting.',batch.id,batch.version,batch.expected_cents),
  ...[...new Map(lines.map(l=>[l.gift_id,l])).values()].map(l=>guard('EXISTS(SELECT 1 FROM cf_gifts WHERE id=? AND version=?)','BATCH_CHANGED','A batch gift changed. Download fresh evidence before submitting.',l.gift_id,l.version))
 ]}
 }},documentId)
}

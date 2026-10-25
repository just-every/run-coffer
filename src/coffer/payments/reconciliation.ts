import { all, date, fail, integer, type Context, type Row } from '../db'
import { paymentFundLines } from '../gift-splits'

/** Inclusive recorded gift days and payout arrival days; pending is never cash. */
export async function reconciliation(c: Context, url: URL) {
 const from=date(url.searchParams.get('from'),'From'),to=date(url.searchParams.get('to'),'To')
 if(from>to)fail('INPUT','From must be on or before To.',400)
 const inside=(day:string)=>day>=from&&day<=to
 const ledger=await all(c,'SELECT * FROM cf_fund_ledger WHERE received_on>=? AND received_on<=?',from,to)
 const lines=await paymentFundLines(c,await all(c,`SELECT e.*,x.payout_id,p.arrival_on,p.status AS payout_status,o.state AS posting_state
  FROM cf_payment_entries e LEFT JOIN cf_payout_entries x ON x.entry_id=e.id LEFT JOIN cf_payouts p ON p.id=x.payout_id LEFT JOIN cf_payout_postings o ON o.payout_id=p.id
  WHERE (e.received_on>=? AND e.received_on<=?) OR (p.arrival_on>=? AND p.arrival_on<=?)`,from,to,from,to))
 const deposits=await all(c,`SELECT p.*,COALESCE((SELECT SUM(e.net_cents) FROM cf_payout_entries x JOIN cf_payment_entries e ON e.id=x.entry_id WHERE x.payout_id=p.id),0) AS matched_cents,o.state AS posting_state
  FROM cf_payouts p LEFT JOIN cf_payout_postings o ON o.payout_id=p.id WHERE p.arrival_on>=? AND p.arrival_on<=? AND p.status='paid'`,from,to)
 const batches=await all(c,"SELECT b.*,o.state AS posting_state FROM cf_gift_batches b LEFT JOIN cf_batch_postings o ON o.batch_id=b.id WHERE b.received_on>=? AND b.received_on<=? AND b.status='closed'",from,to)
 const pending=await all(c,"SELECT * FROM cf_pending_bank_payments WHERE received_on>=? AND received_on<=? AND status='processing' ORDER BY received_on,id",from,to)
 const funds=new Map<string,Row>(),differences:Row[]=[],pairs=new Map<string,Row>()
 const fund=(name:string)=>{let f=funds.get(name);if(!f){f={fund:name,ledger_cents:0n,processor_cents:0n,deposited_cents:0n,accounting_cents:0n,pending_ach_cents:0n};funds.set(name,f)}return f}
 const difference=(name:string,stage:string,sourceId:string,cents:number|bigint,explanation:string)=>{if(cents)differences.push({fund:name,stage,sourceId,amount_cents:integer(Number(cents),'Difference cents',-Number.MAX_SAFE_INTEGER),explanation})}
 const pair=(gift:string,name:string)=>{const key=JSON.stringify([gift,name]);let p=pairs.get(key);if(!p){p={gift,name,ledger:0n,processor:0n};pairs.set(key,p)}return p}
 for(const l of ledger){fund(l.fund).ledger_cents+=BigInt(l.amount_cents);pair(l.gift_id,l.fund).ledger+=BigInt(l.amount_cents)}
 for(const l of lines){
  const f=fund(l.fund),received=inside(l.received_on),deposited=l.payout_status==='paid'&&inside(l.arrival_on)
  if(received){f.processor_cents+=BigInt(l.amount_cents);pair(l.gift_id??l.id,l.fund).processor+=BigInt(l.amount_cents)}
  if(deposited){f.deposited_cents+=BigInt(l.net_cents);if(l.posting_state==='posted')f.accounting_cents+=BigInt(l.net_cents)}
  if(received&&deposited)difference(l.fund,'processor_to_deposit',l.id,l.fee_cents,'Actual processor fee')
  else if(received)difference(l.fund,'processor_to_deposit',l.id,l.amount_cents,l.kind==='refund'?'Refund after payout; not deposited in this period':'Processor money not deposited in this period')
  else if(deposited)difference(l.fund,'processor_to_deposit',l.id,-l.net_cents,'Earlier processor transaction deposited in this period')
  if(deposited&&l.posting_state!=='posted')difference(l.fund,'deposit_to_accounting',l.payout_id,l.net_cents,'Payout not posted to accounting')
 }
 for(const p of pairs.values())difference(p.name,'ledger_to_processor',p.gift,p.ledger-p.processor,p.processor===0n?'Offline gift or unposted batch; no processor receipt':p.ledger===0n?'Processor transaction without a ledger contribution in this period':'Ledger and processor timing or imported refund baseline; review source records')
 for(const b of batches){
  const parts=await all(c,`SELECT COALESCE(a.fund,g.fund) AS fund,SUM(COALESCE(a.amount_cents,g.amount_cents)) AS cents FROM cf_batch_entries e JOIN cf_gifts g ON g.id=e.gift_id LEFT JOIN cf_gift_allocations a ON a.gift_id=g.id WHERE e.batch_id=? GROUP BY COALESCE(a.fund,g.fund)`,b.id)
  for(const part of parts){const f=fund(part.fund);f.deposited_cents+=BigInt(part.cents);if(b.posting_state==='posted')f.accounting_cents+=BigInt(part.cents);difference(part.fund,'processor_to_deposit',b.id,-part.cents,'Closed offline batch bypasses the processor');if(b.posting_state!=='posted')difference(part.fund,'deposit_to_accounting',b.id,part.cents,'Unposted check or cash batch')}
 }
 for(const p of deposits){
  const residual=p.amount_cents-p.matched_cents
  if(residual){const f=fund('Unallocated payout difference');f.deposited_cents+=BigInt(residual);if(p.posting_state==='posted')f.accounting_cents+=BigInt(residual);difference(f.fund,'processor_to_deposit',p.id,-residual,'Payout membership difference; review required');if(p.posting_state!=='posted')difference(f.fund,'deposit_to_accounting',p.id,residual,'Unallocated payout not posted to accounting')}
 }
 for(const p of pending)fund(p.fund).pending_ach_cents+=BigInt(p.amount_cents)
 const rows=[...funds.values()].sort((a,b)=>a.fund.localeCompare(b.fund))
 for(const f of rows)for(const key of ['ledger_cents','processor_cents','deposited_cents','accounting_cents','pending_ach_cents'])f[key]=integer(Number(f[key]),'Reconciliation cents',-Number.MAX_SAFE_INTEGER)
 return {from,to,funds:rows,differences,pending,definitions:'Pending ACH is not received money. Accounting counts only confirmed posted journals. Closed offline batches are deposits; open draft batches are not ledger gifts. Differences are signed left-column minus right-column amounts.'}
}

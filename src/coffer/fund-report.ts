import { restrictionLabel } from './restricted-funds'
import { all, date, fail, id, integer, type Row } from './db'
import { dollars } from './payments/exports'

export function fundFilters(url: URL) {
 const from = url.searchParams.get('from') || null, through = url.searchParams.get('through') || null, donorId = url.searchParams.get('donorId') || null
 if (from) date(from, 'From')
 if (through) date(through, 'Through')
 if (donorId) id(donorId, 'Donor')
 if (from && through && from > through) fail('INPUT', 'From must be on or before Through.', 400)
 return {from,through,donorId}
}

export function fundRecordSelection(url: URL) {
 const filters=fundFilters(url), {from,through,donorId}=filters, fund=url.searchParams.get('fund') || null
 return {filters:{...filters,fund},query:`SELECT l.*,d.name AS donor_name,c.name AS campaign,f.restriction,f.detail,f.release_on FROM cf_fund_ledger l JOIN cf_donors d ON d.id=l.donor_id LEFT JOIN cf_campaigns c ON c.id=l.campaign_id
 LEFT JOIN cf_funds f ON f.name=l.fund
 WHERE (? IS NULL OR l.received_on>=?) AND (? IS NULL OR l.received_on<=?) AND (? IS NULL OR l.donor_id=?) AND (? IS NULL OR l.fund=?)`,
 params:[from,from,through,through,donorId,donorId,fund,fund]}
}

export async function fundEntries(c: {db:D1Database}, url: URL, page: number | null = 0) {
 const s=fundRecordSelection(url)
 return all(c,s.query+` ORDER BY l.received_on DESC,l.created_at DESC,l.id,l.position${page===null?'':' LIMIT 51 OFFSET ?'}`,...s.params,...(page===null?[]:[page*50]))
}

export async function fundReport(c: {db:D1Database},url:URL) {
 const page=integer(Number(url.searchParams.get('page')??0),'Page',0,100000)
 const records=await fundEntries(c,url,null),groups=new Map<string,{fund:string;cents:bigint;gifts:Set<string>}>()
 for(const r of records){
  const group=groups.get(r.fund)??{fund:r.fund,cents:0n,gifts:new Set<string>()}
  group.cents+=BigInt(r.amount_cents)
  if(r.kind==='gift'&&r.source!=='stripe-adjustment')group.gifts.add(r.gift_id)
  groups.set(r.fund,group)
 }
 const funds=[...groups.values()].sort((a,b)=>a.fund.localeCompare(b.fund)).map(g=>({fund:g.fund,amount_cents:integer(Number(g.cents),'Fund contribution cents',-Number.MAX_SAFE_INTEGER),gift_count:g.gifts.size}))
 return {funds,entries:records.slice(page*50,page*50+50),more:records.length>(page+1)*50,page}
}

const cell=(value:unknown,numeric=false)=>{
 let s=String(value??'');if(!numeric&&/^[\s]*[=+\-@]/.test(s))s="'"+s
 return `"${s.replace(/"/g,'""')}"`
}
export function fundLedgerCsv(entries:Row[]) {
 const rows:unknown[][]=[['Payment ID','Entry ID','Received on','Donor','Fund','Campaign','Method','Reference','Contribution USD','Restriction'],...entries.map(l=>[l.gift_id,l.id,l.received_on,l.donor_name,l.fund,l.campaign,l.method,l.reference,dollars(l.amount_cents),restrictionLabel(l)])]
 return rows.map((r,i)=>r.map((v,j)=>cell(v,i>0&&j===8)).join(',')).join('\r\n')+'\r\n'
}

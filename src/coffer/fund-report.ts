import { all, date, fail, id, integer, type Row } from './db'
import { fundTotals } from './gift-splits'
import { dollars } from './payments/exports'

export function fundFilters(url: URL) {
 const from = url.searchParams.get('from') || null, through = url.searchParams.get('through') || null, donorId = url.searchParams.get('donorId') || null
 if (from) date(from, 'From')
 if (through) date(through, 'Through')
 if (donorId) id(donorId, 'Donor')
 if (from && through && from > through) fail('INPUT', 'From must be on or before Through.', 400)
 return {from,through,donorId}
}

export async function fundEntries(c: {db:D1Database}, url: URL, page: number | null = 0) {
 const {from,through,donorId}=fundFilters(url), fund=url.searchParams.get('fund') || null
 return all(c, `SELECT l.*,d.name AS donor_name,c.name AS campaign FROM cf_fund_ledger l JOIN cf_donors d ON d.id=l.donor_id LEFT JOIN cf_campaigns c ON c.id=l.campaign_id
 WHERE (? IS NULL OR l.received_on>=?) AND (? IS NULL OR l.received_on<=?) AND (? IS NULL OR l.donor_id=?) AND (? IS NULL OR l.fund=?)
 ORDER BY l.received_on DESC,l.created_at DESC,l.id,l.position${page===null?'':' LIMIT 51 OFFSET ?'}`, from,from,through,through,donorId,donorId,fund,fund,...(page===null?[]:[page*50]))
}

export async function fundReport(c: {db:D1Database},url:URL) {
 const filters=fundFilters(url), page=integer(Number(url.searchParams.get('page')??0),'Page',0,100000)
 const [funds,entries]=await Promise.all([fundTotals(c,filters),fundEntries(c,url,page)])
 return {funds,entries:entries.slice(0,50),more:entries.length>50,page}
}

const cell=(value:unknown,numeric=false)=>{
 let s=String(value??'');if(!numeric&&/^[\s]*[=+\-@]/.test(s))s="'"+s
 return `"${s.replace(/"/g,'""')}"`
}
export function fundLedgerCsv(entries:Row[]) {
 const rows:unknown[][]=[['Payment ID','Entry ID','Received on','Donor','Fund','Campaign','Method','Reference','Contribution USD'],...entries.map(l=>[l.gift_id,l.id,l.received_on,l.donor_name,l.fund,l.campaign,l.method,l.reference,dollars(l.amount_cents)])]
 return rows.map((r,i)=>r.map((v,j)=>cell(v,i>0&&j===8)).join(',')).join('\r\n')+'\r\n'
}

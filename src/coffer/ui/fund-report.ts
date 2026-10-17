import { fundReport } from '../fund-report'
import type { Context } from '../db'
import { box, e, empty, field, money, when } from './common'

export async function fundReportPage(c:Context,url:URL) {
 const report=await fundReport(c,url), query=(patch:Record<string,string>)=>{const q=new URLSearchParams(url.searchParams);q.delete('page');for(const [k,v]of Object.entries(patch)){if(v)q.set(k,v);else q.delete(k)}return q.toString()}
 const filters=`<form method="get" action="/app/funds"><div class="fields">${field('From','from','date',url.searchParams.get('from'))}${field('Through','through','date',url.searchParams.get('through'))}</div><button>Filter gifts</button></form>`
 const totals=report.funds.length?`<ul class="list">${report.funds.map(f=>`<li><a href="/app/funds?${e(query({fund:f.fund}))}">${e(f.fund)} · ${money(f.amount_cents)}</a> · ${f.gift_count} ${f.gift_count === 1 ? 'payment' : 'payments'}</li>`).join('')}</ul>`:empty('No gifts in this period.')
 const rows=report.entries.map(l=>`<tr><td class="lead"><a href="/app/donors/${e(l.donor_id)}">${e(l.donor_name)}</a><br>${when(l.received_on)}</td><td data-label="Fund">${e(l.fund)}${l.campaign?` · ${e(l.campaign)}`:''}</td><td data-label="Contribution">${money(l.amount_cents)}</td><td data-label="Payment">${e(l.method)}${l.reference?` · ${e(l.reference)}`:''}<br><small>${e(l.gift_id)}</small></td></tr>`).join('')
 const table=rows?`<div class="scroll"><table class="stack"><thead><tr><th>Donor · date</th><th>Fund</th><th>Contribution</th><th>Payment</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty('No entries match this fund.')
 const paging=`<p class="paging">${report.page?`<a href="/app/funds?${e(query({page:String(report.page-1)}))}">Previous</a>`:''} ${report.more?`<a href="/app/funds?${e(query({page:String(report.page+1)}))}">Next</a>`:''}</p>`
 return `${box('Giving by fund',`${filters}<p>Payments split across funds or campaigns appear in each fund for that part only. Reversals subtract from the same parts. Receipts and donor giving count the payment once.</p>${totals}`)}${box(url.searchParams.get('fund')||'All fund entries',`<p><a href="/app/funds?${e(query({fund:''}))}">All funds</a> · <a href="/app/funds/ledger.csv?${e(query({}))}">Download accounting ledger (CSV)</a></p>${table}${paging}`)}`
}

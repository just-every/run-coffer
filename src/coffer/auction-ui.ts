import { all, type Context, type Row } from './db'
import { auctionState } from './auction'
import { box, e, empty, field, form, hidden, money, area } from './ui/common'

const labels:Record<string,string>={preview:'Preview only',held:'Waiting for a fair market value',gift:'Contribution payment',purchase:'Purchase · no contribution',open:'Unpaid balance',property:'Donated property',undone:'Undone'}
function rowSummary(row:Row){
 const value=row.fair_value_cents===null?'Value unknown':`Fair market value ${money(row.fair_value_cents)}`
 if(row.kind==='donated_item')return `${e(row.quantity)} items · donor-stated internal value ${money(row.stated_value_cents)} · goods answer ${e(row.property_goods)}`
 return `${money(row.amount_cents)} ${row.paid?'paid':'unpaid'} · ${value}${row.outcome==='gift'?` · ${money(row.deductibleCents)} deductible`:''}`
}
function matchForm(job:Row,row:Row){
 const candidates=[...new Map<string,Row>([...(row.candidates as Row[]),...(row.searchCandidates??[])].map((d:Row)=>[d.id,d])).values()],matched=row.decision==='match'?candidates.find(d=>d.id===row.donor_id):null
 // Each candidate has its own version in a visible, explicitly named form.
 return `<p>${row.decision==='unreviewed'?'Bidder match needs a person.':row.decision==='create'?'Reviewed: create a separate donor.':`Matched to ${e(matched?.name??'the selected donor')}.`}</p>`+
  (candidates.length?candidates.map(d=>form('auction.match',`<p>${e(d.name)}${d.email?' · '+e(d.email):''}</p>${field('Reason for this match','reason','text','','required maxlength="500"')}`,`Match ${row.bidder_name} to ${d.name}`,{jobId:job.id,rowId:row.id,version:row.version,decision:'match',donorId:d.id,donorVersion:d.version})).join(''):empty('No matching donor found.'))+
  form('auction.match',field('Reason for a separate donor','reason','text','','required maxlength="500"'),`Create donor for ${row.bidder_name}`,{jobId:job.id,rowId:row.id,version:row.version,decision:'create'})+
  `<form method="get" action="/app/events/${e(job.event_id)}/auctions">${hidden('jobId',job.id)}${hidden('matchRow',row.id)}${field('Find another donor for '+row.bidder_name,'q','search','','required minlength="2" maxlength="100"')}<button>Find matching donors</button></form>`
}
function resultRow(job:Row,row:Row){
 const common={jobId:job.id,rowId:row.id,version:row.version},review=(row.status==='held'||(row.status==='open'&&row.fair_value_cents===null))?form('auction.value',field('Reviewed fair market value (USD)','fairValue','text','','required inputmode="decimal"')+area('Value evidence','reason','','required maxlength="1000"'),'Record fair market value',common):''
 const settle=row.status==='open'?form('auction.settle',field('Payment received on','receivedOn','date',job.received_on,'required')+area('Payment evidence','reason','','required maxlength="1000"'),'Record balance paid',common):''
 return `<li><h3>Lot ${e(row.lot)} · ${e(row.item??'Erased item')}</h3><p>${e(row.bidder_name??'Erased donor')} · <strong>${job.state==='preview'?'Preview: ':''}${e(labels[row.outcome]??row.outcome)}</strong></p><p>${rowSummary(row)}</p>${row.gift_id?`<p><a href="/app/donors/${e(row.donor_id)}">Gift on bidder record</a> · <a href="/app/letters">Prepare receipt in Letters</a></p>`:''}${row.property_id?`<p><a href="/app/donors/${e(row.donor_id)}">Property register on donor record</a></p>`:''}${job.state==='preview'?matchForm(job,row):job.state==='applied'?review+settle:''}</li>`
}
export async function auctionPage(c:Context,eventId:string,jobId?:string,search:{q?:string;rowId?:string}={}){
 const state=await auctionState(c,eventId,jobId),{event,job,rows,summary}=state
 if(job?.state==='preview'&&search.q&&search.q.trim().length>=2&&search.q.length<=100){
  const row=rows.find(r=>r.id===search.rowId),query='%'+search.q.trim().replace(/[\\%_]/g,'\\$&')+'%'
  if(row)row.searchCandidates=await all(c,"SELECT id,version,name,email FROM cf_donors WHERE erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id) AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY lower(name),id LIMIT 20",query,query)
 }
 const upload=`<p>Import results from Qgiv, Givebutter, OneCause, GiveSmart, Handbid or a CSV with Lot, Item, Winning bidder, Winning bid, Fair market value and Paid status. Bidder email and Bidder ID help match people. Review up to 100 rows in one file.</p><p>Use Type “fund-a-need” for a plain gift or “donated item” with Quantity, Donor-stated value and Donor goods answer (none or unknown). The received date applies to payments and donated property in this file; use separate imports for different dates. Leave an unknown fair market value blank. No receipt is sent by importing.</p>`
 const inputFields=field('Auction platform','source','text','Auction CSV','required maxlength="80"')+field('Payment received on','receivedOn','date',event.starts_on,'required')
 const history=state.jobs.length?`<ul class="list">${state.jobs.map(j=>`<li><a href="/app/events/${e(eventId)}/auctions?jobId=${e(j.id)}">${e(j.source)} · ${e(j.state)}</a></li>`).join('')}</ul>`:empty('No auction results imported yet.')
 let review=''
 if(job){
  review=box('Auction review',`<p>${e(job.source)} · ${e(job.state)} · ${rows.length} results</p><p>Received on ${e(job.received_on)} · ${e(job.fund)}</p><p>${money(summary.paymentsCents)} paid · ${money(summary.purchaseRevenueCents)} purchase revenue · ${money(summary.deductibleCents)} deductible · ${money(summary.openBalanceCents)} open balances · ${summary.held} waiting for a value</p>${job.state==='preview'?`<p>${summary.unreviewed} bidder matches need review. Applying records paid contributions, purchases, holds, unpaid balances and donated property together.</p>${summary.unreviewed?'':form('auction.apply','','Apply reviewed auction results',{jobId:job.id,fingerprint:job.fingerprint})}`:''}${job.state==='applied'?form('auction.undo','','Undo this auction import',{jobId:job.id}):''}`)+box('Auction results',`<ul class="list">${rows.map(row=>resultRow(job,row)).join('')}</ul>`)
 }
 return `<p><a href="/app/events/${e(eventId)}">${e(event.name)}</a> · <a href="/app/events">Events</a></p>`+review+box('Import auction results',upload+`<form method="post" enctype="multipart/form-data" action="/app/events/${e(eventId)}/auctions/upload">${inputFields}${field('Auction results CSV file','file','file','','required accept=".csv,text/csv"')}<button>Preview uploaded CSV</button></form>`+`<details><summary>Paste CSV instead</summary>${form('auction.preview',inputFields+area('Auction results CSV','csv','','required rows="8"'),'Preview auction results',{eventId})}</details>`)+box('Import history',history)
}

export function auctionDonorPanel(rows:Row[]) {
 if(!rows.length)return ''
 return box('Auction activity',`<ul class="list">${rows.map(r=>`<li><strong>${e(r.status==='open'?'Unpaid balance':labels[r.status]??r.status)} · ${money(r.amount_cents)}</strong><p>${e(r.item??'Erased item')} · <a href="/app/events/${e(r.event_id)}/auctions?jobId=${e(r.job_id)}">${e(r.event_name)}</a></p></li>`).join('')}</ul>`)
}

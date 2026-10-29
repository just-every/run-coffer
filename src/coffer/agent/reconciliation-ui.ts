import type { Context, Row } from '../db'
import { e, hidden, moment, money } from '../ui/common'
import { settings } from '../settings'
import { reconciliationData } from './reconciliation'

function proposal(row:Row) {
 const p=row.proposed
 if(p.action!=='contribution') return `<p>${e(p.detail)}</p>`
 return `<p>${e(p.detail)}</p><ul>${p.changes.map((change:Row)=>`<li>${e(change.fund)}: ${change.cents>0?'+':''}${money(change.cents)}</li>`).join('')}</ul>`
}
export async function reconciliationPage(c:Context):Promise<string> {
 const [data,s]=await Promise.all([reconciliationData(c),settings(c)])
 const run=data.lastRun?JSON.parse(data.lastRun.summary):null, qbo=data.quickbooksRun?JSON.parse(data.quickbooksRun.summary):null
 return `<section><h2>Giving reconciliation</h2><p>Compare Stripe charges and payouts with Coffer contributions and exact Pantry submissions. The owner can separately compare QuickBooks deposits and adjustment journals without submitting accounting entries. Corrections append contribution entries; undo appends their opposites. Provider charges, fees, deposits and original gifts stay immutable.</p>
 <form method="post" action="/app/agent/reconcile/run"><button>Check giving now</button></form>
 ${data.lastRun?`<p>Last checked ${e(moment(data.lastRun.at,s.timezone))}: ${e(run.checkedCharges)} charges and ${e(run.checkedPayouts)} payouts.</p>${[...(run.unavailable??[]),...(run.errors??[])].map(message=>`<p class="notice">${e(message)}</p>`).join('')}`:'<p>Run a check to compare connected providers and cached payout evidence. No AI key is required.</p>'}
 ${c.actor.role==='owner'?`<section aria-label="QuickBooks comparison"><h3>QuickBooks comparison</h3><form method="post" action="/app/agent/reconcile/quickbooks/run"><button>Check QuickBooks now</button></form>
 ${qbo?`<p role="status">QuickBooks comparison ${qbo.complete?'complete':'incomplete'}: ${e(qbo.checkedSources)} sources and ${e(qbo.checkedDocuments)} documents checked ${e(moment(data.quickbooksRun!.at,s.timezone))}.</p>${qbo.errors.map((message:string)=>`<p class="notice">${e(message)}</p>`).join('')}`:'<p>Not checked. This owner action reads the connected company and preserves earlier exceptions when a read is incomplete.</p>'}</section>`:''}
 ${data.issues.length?data.issues.map(row=>`<article class="card"><h3>${e(row.summary)}</h3><p><strong>${e(row.state)}</strong> · ${e(row.source_id)}</p><p>${e(row.why)}</p>${proposal(row)}
 ${row.kind.startsWith('quickbooks_')?`${row.evidence.explanation?`<ul>${row.evidence.explanation.map((line:string)=>`<li>${e(line)}</li>`).join('')}</ul>`:''}<p><a href="${e(row.evidence.source.pageUrl)}">Open native source</a> · <a href="${e(row.evidence.source.reviewUrl)}">Review accounting request</a></p>`:''}
 <details><summary>Evidence and source IDs</summary><pre>${e(JSON.stringify(row.evidence,null,2))}</pre></details>
 ${row.state==='open'&&['contribution','missing_gift'].includes(row.proposed.action)?`<form method="post" action="/app/agent/reconcile/apply">${hidden('id',row.id)}<button>Apply correction</button></form>`:row.state==='applied'?`<form method="post" action="/app/agent/reconcile/undo">${hidden('id',row.id)}<button class="secondary">Undo correction</button></form>`:''}</article>`).join(''):'<p>No discrepancies are recorded.</p>'}</section>`
}

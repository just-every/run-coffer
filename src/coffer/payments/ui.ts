import { chip, e, guide, money, when } from '../ui/common'

// Adapted from the converted 12ui payout draft B. page() owns the shared shell.
// Served by the authenticated /api/coffer/payments/styles.css route.
export const payoutStyles = `
.payout-screen{padding-top:20px;min-width:0}
.payout-screen *{box-sizing:border-box}
.payout-screen .pay-overview{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:20px;align-items:start}
.payout-screen .pay-intro{max-width:660px;margin-bottom:22px;font-size:16px;line-height:1.6}
.payout-screen .pay-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:0}
.payout-screen .pay-metric{border:1px solid var(--cf-line);border-radius:8px;padding:16px;min-width:0}
.payout-screen .pay-metric dt{font-size:11px;letter-spacing:.07em;text-transform:uppercase;line-height:1.5;margin-bottom:12px}
.payout-screen .pay-metric dd{margin:0;font:600 28px/1.2 var(--rer-font-heading);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.payout-screen .pay-metric small{display:block;color:var(--rer-muted);font:12px/1.5 var(--rer-font-body);letter-spacing:0;margin-top:8px}
.payout-screen .pay-sync,.payout-screen .pay-panel{border:1px solid var(--cf-line);border-radius:8px;padding:20px}
.payout-screen .pay-sync{background:var(--rer-page)}
.payout-screen .pay-sync h2{font-size:18px;margin-bottom:6px}
.payout-screen .pay-sync p{font-size:13px;line-height:1.5;margin:0 0 16px}
.payout-screen .pay-sync label{font-size:13px}
.payout-screen .pay-sync button{border-radius:8px;min-height:44px}
.payout-screen .pay-section{margin-top:28px}
.payout-screen .pay-section h2{margin-bottom:10px}
.payout-screen .pay-table-frame{border:1px solid var(--cf-line);border-radius:8px;overflow:hidden}
.payout-screen table{font-size:14px}
.payout-screen th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;background:var(--rer-page)}
.payout-screen th,.payout-screen td{padding:12px 14px;overflow-wrap:anywhere}
.payout-screen tbody tr:last-child td{border-bottom:0}
.payout-screen .pay-number{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.payout-screen .pay-ref{display:block;font-size:12px;color:var(--rer-muted);margin-top:4px;overflow-wrap:anywhere}
.payout-screen .pay-help{font-size:13px;line-height:1.5;margin:10px 0 0}
.payout-screen .pay-panel p:last-child{margin-bottom:0}
.payout-screen .pay-panel h2{margin-bottom:8px}
.payout-screen .pay-failures{border-left:3px solid var(--cf-alarm)}
.payout-screen .pay-failures table{margin-top:14px}
.payout-screen .pay-back{display:inline-block;margin-bottom:16px;font-size:14px}
.payout-screen .pay-identity{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.payout-screen .pay-identity code{font-size:15px}
.payout-screen .pay-detail-grid{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:20px;align-items:start;margin-top:24px}
.payout-screen .pay-detail-grid .pay-section{margin-top:0}
.payout-screen .pay-accounting{display:grid;gap:16px}
.payout-screen .pay-accounting form{margin-top:16px}
.payout-screen .pay-receipt{grid-template-columns:1fr;gap:3px;margin-bottom:0;font-size:14px}
.payout-screen .pay-receipt dt{margin-top:8px;font-size:12px}
.payout-screen .pay-receipt dd{margin:0;overflow-wrap:anywhere}
.payout-screen .pay-downloads{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:10px;font-size:14px}
.payout-screen .pay-empty{padding:24px;margin:0}
.payout-screen .pay-match{margin:18px 0 0;padding:12px 16px;border-left:3px solid var(--cf-ok);background:var(--rer-page);font-size:14px}
.payout-screen .pay-match.attention{border-color:var(--cf-warn)}
@media(max-width:960px){.payout-screen .pay-overview,.payout-screen .pay-detail-grid{grid-template-columns:1fr}.payout-screen .pay-sync{max-width:none}.payout-screen .pay-sync form{grid-template-columns:minmax(0,1fr) auto;align-items:end}.payout-screen .pay-sync button{width:auto}.payout-screen .pay-detail-grid .pay-accounting{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:680px){.payout-screen .pay-metrics{grid-template-columns:1fr;gap:10px}.payout-screen .pay-metric{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:14px}.payout-screen .pay-metric dt{margin:0}.payout-screen .pay-metric dd{text-align:right;font-size:25px}.payout-screen .pay-metric small{font-size:11px;margin-top:4px}.payout-screen .pay-sync form,.payout-screen .pay-detail-grid .pay-accounting{grid-template-columns:1fr}.payout-screen .pay-sync button{width:100%}.payout-screen table.stack thead{display:none}.payout-screen table.stack tr{display:block;padding:16px;border-bottom:1px solid var(--cf-line)}.payout-screen table.stack tr:last-child{border:0}.payout-screen table.stack td{display:block;border:0;padding:3px 0;text-align:left;white-space:normal}.payout-screen table.stack td.lead{font-weight:600;margin-bottom:6px}.payout-screen table.stack td[data-label]::before{content:attr(data-label) ': ';color:var(--rer-muted);font-weight:400;font-size:12px}.payout-screen .pay-panel{padding:16px}.payout-screen .pay-failures table.stack tr{padding:12px 0}.payout-screen .pay-table-frame{overflow:visible}}
`

const styleLink = '<link rel="stylesheet" href="/api/coffer/payments/styles.css">'
const managedNotice = '<p>Stripe and Pantry are not available yet on RER Managed.</p>'
const payoutPath = (id: string) => `/app/payouts/${encodeURIComponent(id)}`
const label = (value: string) => value.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
const payoutStatus = (value: string) => chip(label(value), value === 'paid' ? 'ok' : ['failed', 'canceled'].includes(value) ? 'alarm' : 'info')
const posted = (posting: any) => Boolean(posting && (posting.state === 'posted' || (!posting.state && posting.external_id)))
const postingStatus = (posting: any) => posted(posting) ? chip('Posted', 'ok') : posting?.state === 'proposed' ? chip('Awaiting approval', 'info') : posting?.state === 'uncertain' ? chip('Check Pantry', 'warn') : posting?.state === 'sending' ? chip('Submitting', 'info') : ['rejected','stale'].includes(posting?.state) ? chip(label(posting.state), 'warn') : '<span class="muted">Not posted</span>'
const metric = (title: string, value: string | number, note: string) => `<div class="pay-metric"><dt>${e(title)}</dt><dd>${e(value)}<small>${e(note)}</small></dd></div>`
const totals = (rows: any[], key: string) => rows.reduce((sum, row) => sum + row[key], 0)

function syncPanel(available: boolean) {
 return `<section class="pay-sync" aria-labelledby="sync-title"><h2 id="sync-title">Sync from Stripe</h2>${available
  ? '<p>Import payout lines and match them to your recorded gifts.</p><form method="post" action="/app/payouts/sync"><label for="payout-id">Payout ID (optional)<input id="payout-id" name="payoutId" autocomplete="off" maxlength="200" aria-describedby="sync-help"></label><button>Sync from Stripe</button></form><p id="sync-help" class="pay-help">Leave blank to sync payouts.</p>'
  : '<p>Connect Stripe to sync payouts. <a href="/app/giving/setup">Connect Stripe</a> explains each step.</p>'}</section>`
}

export function payoutListPage(view: any): string {
 const rows = view.payouts.map((p: any) => `<tr><td class="lead"><a href="${e(payoutPath(p.id))}">${e(when(p.arrival_on) || 'Arrival not available')}</a></td><td data-label="Payout ID"><code>${e(p.id)}</code></td><td data-label="Stripe status">${payoutStatus(p.status)}</td><td class="pay-number" data-label="Payout amount">${money(p.amount_cents)}</td><td class="pay-number" data-label="Matched net">${money(p.matched_cents)}</td><td data-label="Accounting">${postingStatus(p.posting)}</td></tr>`).join('')
 const failureRows = view.failures.map((f: any) => `<tr><td class="lead">${e(when(f.created_at) || 'Date not available')}</td><td data-label="Payment"><code>${e(f.charge_id)}</code><span class="pay-ref">Event ${e(f.id)}</span></td><td data-label="Status">${chip(label(f.status), 'alarm')}</td></tr>`).join('')
 return `${styleLink}<div class="payout-screen"><div class="pay-overview"><div><p class="pay-intro">Reconcile Stripe payouts with your fund accounting. Review the gifts and fees behind each deposit, then track its accounting entry.</p><dl class="pay-metrics" aria-label="Imported payout totals">${metric('Payouts', view.payouts.length, 'imported into Coffer')}${metric('Payout amount', money(totals(view.payouts, 'amount_cents')), 'across imported payouts')}${metric('Posted', view.payouts.filter((p: any) => posted(p.posting)).length, `of ${view.payouts.length} payouts`)}</dl></div>${view.managed ? managedNotice : syncPanel(view.stripeAvailable)}</div><section class="pay-section" aria-labelledby="payout-list-title"><h2 id="payout-list-title">Imported payouts</h2><div class="pay-table-frame">${rows ? `<table class="stack"><caption class="sr">Imported Stripe payouts and their accounting status</caption><thead><tr><th scope="col">Arrival date</th><th scope="col">Payout ID</th><th scope="col">Stripe status</th><th scope="col" class="pay-number">Payout amount</th><th scope="col" class="pay-number">Matched net</th><th scope="col">Accounting</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="pay-empty muted">No payouts have been synced yet.</p>'}</div><p class="pay-help">All amounts are USD. Matched net is the gift amount after Stripe fees.</p></section><section class="pay-section pay-panel${failureRows ? ' pay-failures' : ''}" aria-labelledby="failure-title"><h2 id="failure-title">Payment failures</h2><p class="pay-help">Failed payment events received from Stripe.</p>${failureRows ? `<table class="stack"><caption class="sr">Failed payment events</caption><thead><tr><th scope="col">Received</th><th scope="col">Payment</th><th scope="col">Status</th></tr></thead><tbody>${failureRows}</tbody></table>` : '<p class="pay-help">No payment failures recorded.</p>'}</section>${!view.managed && !view.pantryAvailable ? `<p class="pay-help">To send payouts to Pantry or QuickBooks, follow the <a href="${guide('payments')}">payouts and accounting guide</a>.</p>` : ''}</div>`
}

function accountingPanel(view: any, path: string) {
 const posting = view.posting
 const receipt = posting ? `<dl class="pay-receipt"><dt>Status</dt><dd>${postingStatus(posting)}</dd>${posting.external_id ? `<dt>Accounting entry</dt><dd><code>${e(posting.external_id)}</code></dd>` : ''}${posting.destination ? `<dt>Destination</dt><dd>${e(posting.destination)}</dd>` : ''}${posting.posted_at ? `<dt>Posted on</dt><dd>${e(when(posting.posted_at))}</dd>` : ''}</dl>` : ''
 const refresh = posting && ['proposed', 'uncertain', 'sending'].includes(posting.state)
 const action = view.managed ? managedNotice : posted(posting) ? '<p class="pay-help">This payout has been posted in Pantry.</p>' : ['rejected','stale'].includes(posting?.state) ? '<p>Review this submission and reconcile its journal in Pantry.</p>' : !view.pantryAvailable ? `<p>Connect Pantry and map each fund to send this payout for approval. The <a href="${guide('payments')}">payouts and accounting guide</a> lists each setting.</p>` : `<p>${refresh ? 'Approve or review the proposal in Pantry, then refresh its status here.' : 'Download the evidence CSV below and upload it as a document in Pantry. Paste its document ID to send this payout for approval.'}</p><form method="post" action="${e(path)}/post">${refresh ? '' : '<label for="document-id">Pantry evidence document ID<input id="document-id" name="documentId" required maxlength="200" autocomplete="off"></label>'}<button>${refresh ? 'Refresh Pantry posting' : 'Send to Pantry for approval'}</button></form>`
 return `<aside class="pay-accounting"><section class="pay-panel" aria-labelledby="accounting-title"><h2 id="accounting-title">Pantry accounting</h2>${receipt}${action}</section><section class="pay-panel" aria-labelledby="exports-title"><h2 id="exports-title">Evidence &amp; exports</h2><p class="pay-help">Download this payout’s lines for your accounting records.</p><ul class="pay-downloads"><li><a href="${e(path)}/evidence.csv" download>Download evidence CSV</a></li><li><a href="${e(path)}/qbo.csv" download>Download QuickBooks CSV</a></li><li><a href="${e(path)}/journal.iif" download>Download QuickBooks Desktop IIF</a></li></ul></section></aside>`
}

export function payoutDetailPage(view: any): string {
 const p = view.payout, path = payoutPath(p.id), gap = p.amount_cents - p.matched_cents
 const lineRows = view.lines.map((line: any) => `<tr><td class="lead">${e(line.donor_name || 'Donor not linked')}<span class="pay-ref"><code>${e(line.source_id)}</code></span><span class="pay-ref">${line.gift_id ? `Gift <code>${e(line.gift_id)}</code>` : 'No matching gift'}</span></td><td data-label="Type">${e(label(line.kind))}</td><td data-label="Fund">${e(line.fund || 'Unassigned')}</td><td class="pay-number" data-label="Gross">${money(line.amount_cents)}</td><td class="pay-number" data-label="Fee">${money(line.fee_cents)}</td><td class="pay-number" data-label="Net">${money(line.net_cents)}</td></tr>`).join('')
 const splitRows = view.splits.map((split: any) => `<tr><td class="lead">${e(split.fund || 'Unassigned')}</td><td class="pay-number" data-label="Gross">${money(split.gross_cents)}</td><td class="pay-number" data-label="Fees">${money(split.fee_cents)}</td><td class="pay-number" data-label="Net">${money(split.net_cents)}</td></tr>`).join('')
 return `${styleLink}<div class="payout-screen"><a class="pay-back" href="/app/payouts">← All payouts</a><div class="pay-identity"><code>${e(p.id)}</code>${payoutStatus(p.status)}</div><p class="pay-intro">Arrival: ${e(when(p.arrival_on) || 'Not available')} · USD</p><dl class="pay-metrics" aria-label="Payout reconciliation">${metric('Payout amount', money(p.amount_cents), 'net deposit from Stripe')}${metric('Matched net', money(p.matched_cents), 'linked to recorded gifts')}${metric('Stripe fees', money(totals(view.lines, 'fee_cents')), 'across payout lines')}</dl><p class="pay-match${gap !== 0 || !view.lines.length ? ' attention' : ''}">${!view.lines.length ? 'No payout lines have been synced.' : gap === 0 && p.complete ? 'Matched gift amounts balance to this payout.' : `Difference to reconcile: ${money(gap)}. Review unmatched lines before sending to accounting.`}</p><div class="pay-detail-grid"><section class="pay-section" aria-labelledby="fund-splits-title"><h2 id="fund-splits-title">Fund splits</h2><div class="pay-table-frame">${splitRows ? `<table class="stack"><caption class="sr">Payout gross, fees and net by fund</caption><thead><tr><th scope="col">Fund</th><th scope="col" class="pay-number">Gross</th><th scope="col" class="pay-number">Fees</th><th scope="col" class="pay-number">Net</th></tr></thead><tbody>${splitRows}</tbody></table>` : '<p class="pay-empty muted">No fund splits available.</p>'}</div></section>${accountingPanel(view, path)}</div>${!view.managed && !p.automatic && !p.complete ? `<section class="pay-section pay-panel"><h2>Match a manual payout</h2><p>Stripe does not assign transactions to manual payouts. Select the available balance transactions you included; their net must equal the deposit.</p><form method="post" action="${e(path)}/match"><label>Stripe balance transaction IDs<textarea name="entryIds" required placeholder="txn_…" rows="3"></textarea></label><label><input type="checkbox" name="confirm" value="yes" required> I checked that these transactions belong to this payout.</label><button>Match selected transactions</button></form></section>` : ''}<section class="pay-section" aria-labelledby="payout-lines-title"><h2 id="payout-lines-title">Payout lines</h2><div class="pay-table-frame">${lineRows ? `<table class="stack"><caption class="sr">Gifts, refunds and fees included in this payout</caption><thead><tr><th scope="col">Donor · Stripe source · gift</th><th scope="col">Type</th><th scope="col">Fund</th><th scope="col" class="pay-number">Gross</th><th scope="col" class="pay-number">Fee</th><th scope="col" class="pay-number">Net</th></tr></thead><tbody>${lineRows}</tbody></table>` : '<p class="pay-empty muted">No payout lines available. Sync this payout from the payouts page.</p>'}</div></section></div>`
}

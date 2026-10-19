import type { Row } from '../db'
import { box, chip, details, e, empty, guide, longDay, money } from './common'

const JOB: Record<string, string> = { queued: 'Approved, not started', applying: 'Partly applied', completed: 'Applied', failed: 'Stopped', undoing: 'Partly undone', undone: 'Undone', rolling_back: 'Rolling back', rolled_back: 'Rolled back' }

const donationAnswer = `<label><input type="checkbox" name="noGoodsOrServices" value="yes"> These payments were donations: no goods or services were given in return</label><p class="muted">Leave it unticked for tickets, dinners or merchandise. Those gifts wait for a person to answer before a receipt states it.</p>`

export function moveInPage(jobs: Row[], today: string, connected = false) {
 const start = today.slice(0, 4) + '-01-01'
 return `<p>Bring donors, gifts and monthly plans from your Stripe account. Choose the gift dates; Coffer reads every page for you. Preview first, check the totals, then approve. Nothing is changed in Stripe.</p>
 <div class="grid"><div>${box('1. Read from Stripe', `<p>${connected ? 'Use the Stripe account already connected under Giving, or enter a restricted key below to read a different account.' : 'Connect Stripe under <a href="/app/giving/setup">Giving → Connect Stripe</a>, or use a restricted read key below.'}</p>
 <form method="post" action="/app/move-in/read-stripe"><div class="fields"><label>First gift date<input type="date" name="start" value="${start}" required></label><label>Last gift date<input type="date" name="end" value="${today}" required></label></div><p class="muted">Dates include the whole day in UTC. Monthly plans for those donors, and plans created in this period, are included.</p>
 <details${connected ? '' : ' open'}><summary>Use a restricted read key</summary><ol><li>Open Stripe’s <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">API keys</a> page. Select your organization and live mode, or your sandbox for a test move-in.</li><li>Under Restricted keys choose Create restricted key. Name it “Coffer move-in”.</li><li>Set Customers, Charges, Payment Intents, Subscriptions and Invoices to Read. Leave all other permissions at None. Create the key and copy it here.</li><li>After the move-in, expire this key in Stripe. It is used for this preview only and is never saved by Coffer.</li></ol><label>Restricted read key<input type="password" name="readKey" autocomplete="off" placeholder="rk_live_… or rk_test_…"></label></details>
 ${donationAnswer}<button>Read Stripe and preview</button><p class="muted">This can take a minute. Coffer follows the next pages automatically. For a large history, move one month or quarter at a time; earlier records are skipped.</p></form>`)}
 <details><summary>Advanced: upload saved Stripe JSON</summary><p>JSON files are copies of Stripe’s API responses. Use this only if someone has already saved those files for you. Most people should use Read from Stripe above. <a href="${guide('move-in')}">File format guide</a>.</p><form method="post" action="/app/move-in/preview" enctype="multipart/form-data">
  <label>Customer pages (.json)<input type="file" name="customersFiles" accept=".json,application/json" multiple></label>
  <label>Charge pages (.json)<input type="file" name="chargesFiles" accept=".json,application/json" multiple></label>
  <details><summary>Or paste JSON instead</summary><label>Customers JSON<textarea name="customers" placeholder='{"object":"list","data":[...]}'></textarea></label><label>Charges JSON<textarea name="charges" placeholder='{"object":"list","data":[...]}'></textarea></label></details>
  ${donationAnswer}<button>Preview saved files</button></form></details></div>
 <div>${box('Recent imports', jobs.length ? `<ul class="list">${jobs.map(j => `<li><a href="/app/move-in/journal?id=${e(j.id)}">${e(JOB[j.state] ?? j.state)}</a> · ${j.checkpoint} of ${j.total} records</li>`).join('')}</ul>` : empty('Nothing imported yet.'))}
 ${box('What moves', '<p>Customers with payments or plans become donors. Successful US-dollar charges become gifts, net of refunds. Payment Intents and invoices are read for context and never counted as extra gifts. Supported active monthly subscriptions stay on the same Stripe account and appear on the donor. Other plans are listed with the reason they cannot move.</p><p>Failed and non-USD charges are skipped. Live reads skip earlier imports and fully refunded charges. Saved uploads retain fully refunded charges at zero net and reject every repeated or already-imported ID; fix the named file rows before previewing again. Consent is never imported: record it in Coffer. Importing sends no receipts and never charges a donor.</p>')}</div></div>`
}

const giftTable = (gifts: Row[]) => `<div class="scroll"><table><thead><tr><th>Stripe charge</th><th>Received</th><th>Gross</th><th>Refunded</th><th>Net</th><th>Status</th><th>Fund</th></tr></thead><tbody>${gifts.map(g => `<tr><td><code>${e(g.reference)}</code></td><td>${longDay(g.receivedOn)}</td><td>${money(g.grossCents ?? g.amountCents)}</td><td>${money(g.refundedCents ?? 0)}</td><td>${money(g.netCents ?? g.amountCents)}</td><td>${e(g.status === 'refunded' ? 'Refunded' : g.status === 'partially_refunded' ? 'Partially refunded' : 'Paid')}</td><td>${e(g.fund)}</td></tr>`).join('')}</tbody></table></div>`

const reviewRecords = (count: number, label: string, content: string) => `<details${count <= 10 ? ' open' : ''}><summary>Review ${count} ${label}</summary>${content}</details>`

export function previewPage(input: Row, result: Row) {
 const total = result.gifts.reduce((n: number, g: Row) => n + (g.netCents ?? g.amountCents), 0)
 const contexts = (key: string) => (input[key] ?? []).flatMap((p: Row) => p.data ?? [])
 return `<p>${result.donors.length} new donors and ${result.gifts.length} gifts totalling ${money(total)}. ${result.subscriptions?.length ?? 0} monthly plans. ${result.skipped.length} Stripe objects are skipped. Nothing has changed yet.</p>
 ${box('Check the totals', `<p>Gifts to add: <strong>${result.gifts.length} · ${money(total)}</strong>, after refunds and the skips listed below. Compare this with your Stripe payments for these dates before approving. Only charges count as money received.</p><p>${contexts('paymentIntents').length} Payment Intents and ${contexts('invoices').length} invoices read for context. ${contexts('invoices').filter((i: Row) => i.paid_out_of_band).length} invoices were marked paid outside Stripe; these do not become gifts. After applying, Coffer checks the actual gift count and cents against this approved plan.</p>`)}
 <div class="grid wide"><div>${box('Gifts to add', reviewRecords(result.gifts.length, 'gifts', giftTable(result.gifts)))}
 ${box('Donors to add', result.donors.length ? reviewRecords(result.donors.length, 'donors', `<ul class="list">${result.donors.map((d: Row) => `<li><strong>${e(d.name)}</strong>${d.email ? ` · ${e(d.email)}` : ''}${d.city ? ` · ${e(d.city)}` : ''}</li>`).join('')}</ul>`) : empty('No new donors; gifts attach to donors already in Coffer.'))}</div>
 <div>${box('Approve this exact plan', `<form method="post" action="/app/move-in/apply">
  ${['customers','charges','subscriptions','paymentIntents','invoices'].map(key => `<input type="hidden" name="${key}" value="${e(JSON.stringify(input[key] ?? []))}">`).join('')}
  ${input.noGoodsOrServices ? '<input type="hidden" name="noGoodsOrServices" value="yes">' : ''}<input type="hidden" name="fingerprint" value="${e(result.fingerprint)}">
  <p>${input.noGoodsOrServices ? 'Gifts record that no goods or services were given.' : 'Gifts wait for a goods-or-services answer before their letters.'}</p>
  <label><input type="checkbox" name="confirm" value="yes" required> I approve adding exactly these donors, gifts and monthly plans.</label><button>Apply the move-in</button></form>`)}
 ${(result.subscriptions?.length ?? 0) ? box('Monthly plans to add', `<ul class="list">${result.subscriptions.map((s: Row) => `<li>${money(s.amountCents)} monthly · ${e(s.status)} <code>${e(s.id)}</code></li>`).join('')}</ul><p>Stripe keeps billing these plans. Coffer does not create a new subscription or transfer a card.</p>`) : ''}
 ${box('Skipped', result.skipped.length ? reviewRecords(result.skipped.length, 'skipped records and their reasons', `<ul class="list">${result.skipped.map((s: Row) => `<li>${chip(s.kind)} <code>${e(s.sourceId)}</code> ${e(s.reason)}</li>`).join('')}</ul>`) : empty('Nothing skipped.'))}
 ${result.diagnostics.length ? box('Warnings', `<ul class="list">${[...new Set(result.diagnostics.map((d: Row) => d.message))].map(message => `<li>${e(message)}</li>`).join('')}</ul>`) : ''}
 ${details({ 'Review fingerprint': result.fingerprint, Counts: result.counts })}</div></div>`
}

export function journalPage(result: Row) {
 const job = result.job, gifts = result.plan.entries.filter((x: Row) => !x.erased && x.effects[0]?.targetKind === 'gift').length
 const giftFacts = result.plan.entries.filter((x: Row) => !x.erased).flatMap((x: Row) => x.effects).filter((x: Row) => x.targetKind === 'gift' && x.value.kind === 'gift').map((x: Row) => x.value)
 const plans = result.plan.entries.filter((x: Row) => !x.erased).flatMap((x: Row) => x.effects).filter((x: Row) => x.targetKind === 'subscription').length
 const donors = result.plan.entries.filter((x: Row) => !x.erased && x.effects[0]?.targetKind === 'donor').length
 return `<p>${chip(JOB[job.state] ?? job.state, job.state === 'completed' ? 'ok' : job.state === 'undone' ? '' : 'warn')} ${job.checkpoint} of ${job.total} Stripe objects processed: ${donors} donors and ${gifts} gifts and ${plans} monthly plans in this plan.</p>
 ${job.state === 'completed' ? box('Totals check', `<p>${result.totals.matches ? chip('All totals match', 'ok') : chip('Totals differ — check before switching', 'warn')} Approved ${result.totals.expectedCount} gifts · ${money(result.totals.expectedCents)}. In Coffer: ${result.totals.actualCount} gifts · ${money(result.totals.actualCents)}.</p>`) : ''}
 ${box('Reviewed charges and refunds', giftTable(giftFacts))}
 <div class="grid"><div>${box('Next step', `${['queued', 'applying', 'failed'].includes(job.state) ? `<form method="post" action="/app/move-in/resume"><input type="hidden" name="id" value="${e(job.id)}"><p>Large imports apply in parts. Continue until every record is applied.</p><button>Continue the import</button></form>` : ''}
  ${['completed', 'undoing'].includes(job.state) ? `<form method="post" action="/app/move-in/undo"><input type="hidden" name="id" value="${e(job.id)}"><p>Undo removes exactly what this import added in Coffer. Stripe keeps billing its existing monthly plans. It stops at anything a person has since built on, such as a new gift, consent, letter or appeal for an imported donor.</p><button class="secondary">${job.state === 'undoing' ? 'Continue undo' : 'Undo this import'}</button></form>` : ''}
  <p><a href="/app/donors">Open donors</a> · <a href="/app/letters">Letters due</a></p>`)}
 ${box('Retained originals', `<p>The Stripe responses used in this review are kept with verified digests, so this import can be checked and undone. A page that mentions an erased donor is withdrawn.</p><ul class="list">${result.originals.map((o: Row) => o.original.status === 'retained' ? `<li>${e(o.name)} · ${Math.ceil(o.size / 1024)} KB ${chip('Kept', 'ok')}</li>` : `<li>A page holding an erased donor ${chip('Withdrawn')}</li>`).join('')}</ul>`)}</div>
 <div>${box('Progress', `<ul class="list">${result.batches.map((b: Row) => `<li>${e(b.action)} · records ${b.position}–${b.end_position}</li>`).join('') || '<li>No batches yet.</li>'}</ul>`)}
 ${details({ 'Job ID': job.id, Fingerprint: job.fingerprint, State: job.state, Erased: job.erasedRecords ?? 0 })}</div></div>`
}

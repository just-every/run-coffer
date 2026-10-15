import type { Row } from '../db'
import { box, chip, details, e, empty, money, when } from './common'

const JOB: Record<string, string> = { queued: 'Approved, not started', applying: 'Partly applied', completed: 'Applied', failed: 'Stopped', undoing: 'Partly undone', undone: 'Undone', rolling_back: 'Rolling back', rolled_back: 'Rolled back' }

export function moveInPage(jobs: Row[]) {
 return `<p>Bring donors and a year of gifts from Stripe. Save the JSON that Stripe’s API returns for <code>GET /v1/customers</code> and <code>GET /v1/charges</code> (100 per page), then add the pages here. Coffer never asks for your Stripe key and never contacts Stripe. <a href="https://github.com/just-every/run-coffer/blob/main/docs/MOVE-IN.md">How to save the pages</a>.</p>
 <div class="grid"><div>${box('1. Preview (changes nothing)', `<form method="post" action="/app/move-in/preview" enctype="multipart/form-data">
  <label>Customer pages (.json)<input type="file" name="customersFiles" accept=".json,application/json" multiple></label>
  <label>Charge pages (.json)<input type="file" name="chargesFiles" accept=".json,application/json" multiple></label>
  <details><summary>Or paste JSON instead</summary><label>Customers JSON<textarea name="customers" placeholder='{"object":"list","data":[...]}'></textarea></label><label>Charges JSON<textarea name="charges" placeholder='{"object":"list","data":[...]}'></textarea></label></details>
  <label><input type="checkbox" name="noGoodsOrServices" value="yes"> These charges were donations: no goods or services were given in return</label>
  <p class="muted">Leave it unticked if some charges paid for tickets, dinners or merchandise. Those gifts then wait for a person to answer before a letter states it.</p>
  <button>Preview the move-in</button></form>`)}</div>
 <div>${box('Recent imports', jobs.length ? `<ul class="list">${jobs.map(j => `<li><a href="/app/move-in/journal?id=${e(j.id)}">${e(JOB[j.state] ?? j.state)}</a> · ${j.checkpoint} of ${j.total} records</li>`).join('')}</ul>` : empty('Nothing imported yet.'))}
 ${box('What moves', '<p>Each Stripe customer becomes a donor; each successful US-dollar charge becomes a gift on its donor, net of refunds. Failed, refunded and non-USD charges are listed and skipped. Charges without a customer attach to the donor with the same email. Consent is never imported: record it in Coffer.</p>')}</div></div>`
}

export function previewPage(input: Row, result: Row) {
 const total = result.gifts.reduce((n: number, g: Row) => n + g.amountCents, 0)
 return `<p>${result.donors.length} new donors and ${result.gifts.length} gifts totalling ${money(total)}. ${result.skipped.length} Stripe objects are skipped. Nothing has changed yet.</p>
 <div class="grid wide"><div>${box('Gifts to add', `<div class="scroll"><table><thead><tr><th>Received</th><th>Amount</th><th>Fund</th></tr></thead><tbody>${result.gifts.slice(0, 200).map((g: Row) => `<tr><td>${when(g.receivedOn)}</td><td>${money(g.amountCents)}</td><td>${e(g.fund)}</td></tr>`).join('')}</tbody></table></div>${result.gifts.length > 200 ? `<p class="muted">And ${result.gifts.length - 200} more.</p>` : ''}`)}
 ${box('Donors to add', result.donors.length ? `<ul class="list">${result.donors.map((d: Row) => `<li><strong>${e(d.name)}</strong>${d.email ? ` · ${e(d.email)}` : ''}${d.city ? ` · ${e(d.city)}` : ''}</li>`).join('')}</ul>` : empty('No new donors; gifts attach to donors already in Coffer.'))}</div>
 <div>${box('Approve this exact plan', `<form method="post" action="/app/move-in/apply">
  <input type="hidden" name="customers" value="${e(JSON.stringify(input.customers))}"><input type="hidden" name="charges" value="${e(JSON.stringify(input.charges))}">
  ${input.noGoodsOrServices ? '<input type="hidden" name="noGoodsOrServices" value="yes">' : ''}<input type="hidden" name="fingerprint" value="${e(result.fingerprint)}">
  <p>${input.noGoodsOrServices ? 'Gifts record that no goods or services were given.' : 'Gifts wait for a goods-or-services answer before their letters.'}</p>
  <label><input type="checkbox" name="confirm" value="yes" required> I approve adding exactly these donors and gifts.</label><button>Apply the move-in</button></form>`)}
 ${box('Skipped', result.skipped.length ? `<ul class="list">${result.skipped.map((s: Row) => `<li>${chip(s.kind)} <code>${e(s.sourceId)}</code> ${e(s.reason)}</li>`).join('')}</ul>` : empty('Nothing skipped.'))}
 ${result.diagnostics.length ? box('Warnings', `<ul class="list">${result.diagnostics.map((d: Row) => `<li>${e(d.message)}</li>`).join('')}</ul>`) : ''}
 ${details({ 'Review fingerprint': result.fingerprint, Counts: result.counts })}</div></div>`
}

export function journalPage(result: Row) {
 const job = result.job, gifts = result.plan.entries.filter((x: Row) => !x.erased && x.effects[0]?.targetKind === 'gift').length
 const donors = result.plan.entries.filter((x: Row) => !x.erased && x.effects[0]?.targetKind === 'donor').length
 return `<p>${chip(JOB[job.state] ?? job.state, job.state === 'completed' ? 'ok' : job.state === 'undone' ? '' : 'warn')} ${job.checkpoint} of ${job.total} Stripe objects processed: ${donors} donors and ${gifts} gifts in this plan.</p>
 <div class="grid"><div>${box('Next step', `${['queued', 'applying', 'failed'].includes(job.state) ? `<form method="post" action="/app/move-in/resume"><input type="hidden" name="id" value="${e(job.id)}"><p>Large imports apply in parts. Continue until every record is applied.</p><button>Continue the import</button></form>` : ''}
  ${['completed', 'undoing'].includes(job.state) ? `<form method="post" action="/app/move-in/undo"><input type="hidden" name="id" value="${e(job.id)}"><p>Undo removes exactly what this import added. It stops at anything a person has since built on, such as a new gift, consent, letter or appeal for an imported donor.</p><button class="secondary">${job.state === 'undoing' ? 'Continue undo' : 'Undo this import'}</button></form>` : ''}
  <p><a href="/app/donors">Open donors</a> · <a href="/app/letters">Letters due</a></p>`)}
 ${box('Retained originals', `<p>Stripe pages are kept byte-for-byte with verified digests, so this import can be checked and undone. A page that mentions an erased donor is withdrawn.</p><ul class="list">${result.originals.map((o: Row) => o.original.status === 'retained' ? `<li>${e(o.name)} · ${Math.ceil(o.size / 1024)} KB ${chip('Kept', 'ok')}</li>` : `<li>A page holding an erased donor ${chip('Withdrawn')}</li>`).join('')}</ul>`)}</div>
 <div>${box('Progress', `<ul class="list">${result.batches.map((b: Row) => `<li>${e(b.action)} · records ${b.position}–${b.end_position}</li>`).join('') || '<li>No batches yet.</li>'}</ul>`)}
 ${details({ 'Job ID': job.id, Fingerprint: job.fingerprint, State: job.state, Erased: job.erasedRecords ?? 0 })}</div></div>`
}

import { manager } from '../auth'
import { today, type Context } from '../db'
import { batchDetail, batches, dueGifts } from '../acknowledgements'
import { settings } from '../settings'
import { box, chip, details, e, empty, field, form, money, select, status, when } from './common'

export async function lettersPage(c: Context) {
 const due = await dueGifts(c), s = due.settings, all = await batches(c), boss = manager(c.actor)
 const ready = due.gifts.filter(g => g.goods !== 'unknown')
 const prepare = !s.reviewed_at
  ? `<p class="notice">Before the first letters, a person reviews the organization name and letter wording in <a href="/app/settings">Letter settings</a>.</p>`
  : ready.length && boss ? form('ack.prepare', `<p>Prepare ${Math.min(ready.length, 500)} letters from your saved wording. Nothing goes out: an owner or admin approves the batch, exports it for your own mail, then records when it was sent.</p>`, `Prepare ${Math.min(ready.length, 500)} letters`) : ''
 const table = due.gifts.length ? `<div class="scroll"><table class="stack"><thead><tr><th>Donor</th><th>Gift</th><th>Due</th><th>Goods or services</th></tr></thead><tbody>${due.gifts.map(g => `<tr><td class="lead"><a href="/app/donors/${e(g.donor_id)}">${e(g.donor_name)}</a></td><td data-label="Gift">${money(g.amount_cents)} · ${when(g.received_on)}</td><td data-label="Due">${g.overdue ? chip(`Overdue (${when(g.due_on)})`, 'alarm') : chip(when(g.due_on))}</td><td data-label="Goods or services">${g.goods === 'unknown' ? `<a href="/app/donors/${e(g.donor_id)}">${chip('Answer on the donor page', 'warn')}</a>` : g.goods === 'provided' ? `${money(g.goods_cents)} provided` : 'None'}</td></tr>`).join('')}</tbody></table></div>`
  : empty('No gifts are waiting for a letter.')
 const list = all.length ? `<ul class="list">${all.map(b => `<li><a href="/app/letters/${e(b.id)}">${b.letters} letters · ${money(b.total_cents)}</a> ${status(b.status)}<br><span class="muted">Prepared ${when(b.prepared_at)} by ${e(b.prepared_by_name)}${b.prepared_by_role === 'agent' ? ' (agent)' : ''}${b.sent_on ? ` · sent ${when(b.sent_on)}` : ''}</span></li>`).join('')}</ul>` : empty('No letter batches yet.')
 return `<p>Every gift of ${money(s.threshold_cents)} or more gets a written acknowledgement within ${s.target_days} days. The wording is your organization’s own; Coffer fills in the amount, date and goods-or-services statement.</p>
 <div class="grid wide"><div>${box(`${due.gifts.length} gifts waiting`, prepare + table)}</div><div>${box('Batches', list)}</div></div>`
}

export async function batchPage(c: Context, batchId: string) {
 const { batch: b, letters, approval, events } = await batchDetail(c, batchId), boss = manager(c.actor), day = today((await settings(c)).timezone)
 const v = { batchId: b.id, version: b.version }
 const actions = !boss ? '<p class="muted">An owner or admin approves, exports and records these letters.</p>'
  : b.status === 'prepared' ? `<p>Read every letter below. Approving records you, the exact letters and who prepared them.</p><div class="actions">${form('ack.approve', '', 'Approve these letters', v)}${form('ack.discard', '', 'Discard batch', v, 'secondary')}</div>`
  : b.status === 'approved' ? `<p>Export the letters for your own mail merge or printing. Coffer does not send them.</p><div class="actions">${form('ack.export', '', 'Export letters', v)}${form('ack.discard', '', 'Discard batch', v, 'secondary')}</div>`
  : b.status === 'exported' ? `<p><a class="button" href="/app/letters/${e(b.id)}/letters.csv">Download letters (CSV)</a></p>${form('ack.markSent', `<div class="fields">${field('Sent on', 'sentOn', 'date', day, 'required')}${select('Sent by', 'method', ['mail', 'email', 'mail and email'])}</div>`, 'Record as sent', v)}`
  : b.status === 'sent' ? `<p>Sent by ${e(b.sent_method)} on ${when(b.sent_on)}, recorded by ${e(b.sent_recorded_by)}.</p><p><a href="/app/letters/${e(b.id)}/letters.csv">Download letters (CSV)</a></p>` : '<p>This batch was discarded; its gifts are waiting again.</p>'
 const approvalText = approval ? `<p>Prepared by ${e(approval.prepared_by_name)} (${e(approval.prepared_by_role)}) · approved by ${e(approval.approved_by_name)} (${e(approval.approved_by_role)}) on ${when(approval.approved_at)}.</p>` : `<p>Prepared by ${e(b.prepared_by_name)} (${e(b.prepared_by_role)}) on ${when(b.prepared_at)}. Not yet approved.</p>`
 return `<p>${b.letters} letters · ${money(b.total_cents)} ${status(b.status)}</p><div class="grid wide"><div>${letters.map(l => `<article class="letter"><h3>${e(l.recipient_name)} · ${money(l.amount_cents)} on ${when(l.received_on)}</h3><p class="muted">${e(l.subject)}</p><div class="body">${e(l.body)}</div></article>`).join('') || empty('No letters.')}</div>
 <div>${box('Decision', approvalText + actions)}${details({ 'Batch ID': b.id, 'Content hash': b.content_hash, 'Export hash': b.export_hash ?? '', 'Settings version': b.settings_version, Activity: events.map(x => `${x.action} by ${x.actor_name} at ${x.at}`) })}</div></div>`
}

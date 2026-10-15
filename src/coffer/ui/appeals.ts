import { manager } from '../auth'
import { today, type Context } from '../db'
import { appealDetail, appeals } from '../appeals'
import { settings } from '../settings'
import { box, chip, details, e, empty, field, form, select, status, when } from './common'

export async function appealsPage(c: Context) {
 const list = await appeals(c), boss = manager(c.actor)
 const prepare = boss ? box('Prepare an appeal', form('appeal.prepare', `${field('Appeal name', 'name', 'text', '', 'required placeholder="Spring 2026 appeal"')}<div class="fields">${select('Channel', 'channel', [['email', 'Email'], ['mail', 'Postal mail']])}${field('Gave since (optional)', 'givenSince', 'date')}${field('At least this much since then (USD, optional)', 'minTotal', 'text', '', 'inputmode="decimal"')}</div><p class="muted">Only donors whose latest answer for this channel is yes are included. Everyone else is counted and left out.</p>`, 'Prepare audience')) : ''
 return `<div class="grid wide"><div>${box('Appeals', list.length ? `<ul class="list">${list.map(a => `<li><a href="/app/appeals/${e(a.id)}">${e(a.name)}</a> · ${a.channel === 'email' ? 'email' : 'mail'} · ${a.recipients} recipients ${status(a.status)}<br><span class="muted">Prepared ${when(a.prepared_at)} by ${e(a.prepared_by_name)}${a.prepared_by_role === 'agent' ? ' (agent)' : ''}${a.sent_on ? ` · sent ${when(a.sent_on)}` : ''}</span></li>`).join('')}</ul>` : empty('No appeals yet. Record donor consent, then prepare an audience.'))}</div><div>${prepare}</div></div>`
}

export async function appealPage(c: Context, appealId: string) {
 const { appeal: a, recipients, approval, consentChanged } = await appealDetail(c, appealId), boss = manager(c.actor), day = today((await settings(c)).timezone)
 const v = { appealId: a.id, version: a.version }, excluded = Object.entries(JSON.parse(a.excluded) as Record<string, number>).filter(([, n]) => n > 0)
 const warning = consentChanged && ['prepared', 'approved'].includes(a.status) ? `<p class="alert" role="alert">${consentChanged} recipients’ consent changed since this audience was prepared. Discard it and prepare again.</p>` : ''
 const actions = !boss ? '<p class="muted">An owner or admin approves, exports and records appeals.</p>'
  : a.status === 'prepared' ? `<div class="actions">${form('appeal.approve', '', 'Approve this audience', v)}${form('appeal.discard', '', 'Discard', v, 'secondary')}</div>`
  : a.status === 'approved' ? `<p>Export the list for your own email or mailing tool. Coffer does not send appeals.</p><div class="actions">${form('appeal.export', '', 'Export audience', v)}${form('appeal.discard', '', 'Discard', v, 'secondary')}</div>`
  : a.status === 'exported' ? `<p><a class="button" href="/app/appeals/${e(a.id)}/recipients.csv">Download audience (CSV)</a></p>${form('appeal.markSent', field('Sent on', 'sentOn', 'date', day, 'required'), 'Record as sent', v)}`
  : a.status === 'sent' ? `<p>Sent on ${when(a.sent_on)}, recorded by ${e(a.sent_recorded_by)}. Each recipient’s history shows this appeal.</p><p><a href="/app/appeals/${e(a.id)}/recipients.csv">Download audience (CSV)</a></p>` : '<p>This appeal was discarded.</p>'
 const decided = approval ? `<p>Prepared by ${e(approval.prepared_by_name)} (${e(approval.prepared_by_role)}) · approved by ${e(approval.approved_by_name)} (${e(approval.approved_by_role)}) on ${when(approval.approved_at)}.</p>` : `<p>Prepared by ${e(a.prepared_by_name)} (${e(a.prepared_by_role)}) on ${when(a.prepared_at)}.</p>`
 return `<p><strong>${e(a.name)}</strong> · ${a.channel === 'email' ? 'Email' : 'Postal mail'} · ${a.recipients} recipients ${status(a.status)}</p>${warning}<div class="grid wide"><div>${box('Recipients', `<div class="scroll"><table><thead><tr><th>Donor</th><th>${a.channel === 'email' ? 'Email' : 'City'}</th></tr></thead><tbody>${recipients.map(r => `<tr><td><a href="/app/donors/${e(r.donor_id)}">${e(r.name)}</a></td><td>${e(a.channel === 'email' ? r.email : r.address ? JSON.parse(r.address).city : '')}</td></tr>`).join('')}</tbody></table></div>`)}</div>
 <div>${box('Decision', decided + actions)}${box('Left out', excluded.length ? `<ul class="list">${excluded.map(([reason, n]) => `<li>${chip(n)} ${e(reason)}</li>`).join('')}</ul>` : empty('Nobody in the segment was left out.'))}${details({ 'Appeal ID': a.id, Segment: JSON.parse(a.segment), 'Content hash': a.content_hash, 'Export hash': a.export_hash ?? '' })}</div></div>`
}

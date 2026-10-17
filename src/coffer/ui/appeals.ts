import { welcomePanel } from '../communications/welcome-ui'
import { repliesPanel } from '../communications/replies-ui'
import { preferenceState } from '../communications/preferences'
import { communicationsUnavailable, providerLabel } from '../communications/provider'
import { manager } from '../auth'
import { today, type Context } from '../db'
import { appealDetail, appeals } from '../appeals'
import { settings } from '../settings'
import { area, box, chip, details, e, empty, field, form, select, status, when } from './common'

export async function appealsPage(c: Context) {
 const list = await appeals(c), boss = manager(c.actor)
 const label=providerLabel(c.env),unavailable=communicationsUnavailable(c.env), prefs=await preferenceState(c)
 const connection=box(`${label} connection`, `<p>${e(unavailable??(label==='Mango'?'Connected through the configured Mango operator session. Renew it when it expires.':'Mailchimp is configured. Check sender and audience settings before sending.'))}</p>${boss?form('marketing.sync',`<p>Read ${e(label)} opt-outs and send Coffer email withdrawals to ${e(label)}. Receipt email stays available.</p>`,'Sync email preferences'):''}${prefs.length?`<ul class="list">${prefs.map(p=>`<li><a href="/app/donors/${e(p.donor_id)}">${e(p.name)}</a> ${chip(p.state)}<p>${e(p.note)}</p></li>`).join('')}</ul>`:''}`)
 const prepare = boss ? box('Prepare an appeal', form('appeal.prepare', `${field('Appeal name', 'name', 'text', '', 'required placeholder="Spring 2026 appeal"')}<div class="fields">${select('Channel', 'channel', [['email', 'Email'], ['mail', 'Postal mail']])}${field('Fund donors (optional)', 'fund', 'text', '', 'placeholder="Unrestricted"')}${field('Gave since (optional)', 'givenSince', 'date')}${field('At least this much since then (USD, optional)', 'minTotal', 'text', '', 'inputmode="decimal"')}</div><details class="edit"><summary>Email message</summary>${field('Email subject', 'subject', 'text', '', 'maxlength="250"')}${area('Email message', 'body', '', 'maxlength="12000" rows="6"')}<p class="muted">Merge fields: {{donor_name}}, {{total_given}}, {{last_gift}}, {{gift_count}}. The reviewed message and giving figures are frozen with the audience.</p></details><p class="muted">Only donors whose latest answer for this channel is yes are included. Everyone else is counted and left out.</p>`, 'Prepare audience')) : ''
 return `<div class="grid wide"><div>${box('Appeals', list.length ? `<ul class="list">${list.map(a => `<li><a href="/app/appeals/${e(a.id)}">${e(a.name)}</a> · ${a.channel === 'email' ? 'email' : 'mail'} · ${a.recipients} recipients ${a.status==='approved'?chip('Approved','info'):status(a.status)}<br><span class="muted">Prepared ${when(a.prepared_at)} by ${e(a.prepared_by_name)}${a.prepared_by_role === 'agent' ? ' (agent)' : ''}${a.sent_on ? ` · sent ${when(a.sent_on)}` : ''}</span></li>`).join('')}</ul>` : empty('No appeals yet. Record donor consent, then prepare an audience.'))}</div><div>${prepare}${connection}</div></div><div class="grid wide"><div>${await welcomePanel(c)}</div><div>${await repliesPanel(c)}</div></div>`
}

export async function appealPage(c: Context, appealId: string) {
 const label=providerLabel(c.env)
 const { appeal: a, recipients, approval, consentChanged, message, messages } = await appealDetail(c, appealId), boss = manager(c.actor), day = today((await settings(c)).timezone)
 const v = { appealId: a.id, version: a.version }, excluded = Object.entries(JSON.parse(a.excluded) as Record<string, number>).filter(([, n]) => n > 0)
 const complete=Boolean(message)&&recipients.every(r=>r.communication_id)
 const warning = complete && consentChanged ? '<p class="notice">Preferences changed after these submissions. Future appeals use the current answers.</p>' : consentChanged && ['prepared', 'approved'].includes(a.status) ? `<p class="alert" role="alert">${consentChanged} recipients’ consent changed since this audience was prepared. Discard it and prepare again.</p>` : ''
 const send = boss && a.channel==='email' && message && ['approved','exported','sent'].includes(a.status) && !consentChanged && recipients.some(r=>!r.communication_id) ? form('appeal.send', `<p>Submit up to eight remaining recipients to ${e(label)}. Subscriptions are checked before sending. Repeated clicks do not resend a saved submission.</p>`, `Send remaining through ${label}`,v) : ''
 const progress=messages.length?box('Email submissions',`<ul class="list">${messages.map(m=>`<li><a href="/app/donors/${e(m.donor_id)}">${e(m.name)}</a> ${chip(m.remote_status??m.status)}<p>${e(m.note)}</p></li>`).join('')}</ul>${boss?form('marketing.refresh','','Refresh email results'):''}`):''
 const preview=message?box('Approved message',`<h3>${e(message.subject)}</h3><p style="white-space:pre-wrap">${e(message.body)}</p>`):''
 const actions = !boss ? '<p class="muted">An owner or admin approves, exports and records appeals.</p>'
  : a.status === 'prepared' ? `<div class="actions">${form('appeal.approve', '', 'Approve this audience', v)}${form('appeal.discard', '', 'Discard', v, 'secondary')}</div>`
  : a.status === 'approved' && complete ? '<p>Every recipient has a saved submission. Refresh email results below to check the provider’s progress.</p>'
  : a.status === 'approved' ? `<p>Send the saved email through ${e(label)}, or export the audience for your mailing tool.</p><div class="actions">${consentChanged?'':form('appeal.export', '', 'Export audience', v)}${messages.length?'':form('appeal.discard', '', 'Discard', v, 'secondary')}</div>`
  : a.status === 'exported' ? `<p><a class="button" href="/app/appeals/${e(a.id)}/recipients.csv">Download audience (CSV)</a></p>${form('appeal.markSent', field('Sent on', 'sentOn', 'date', day, 'required'), 'Record as sent', v)}`
  : a.status === 'sent' ? `<p>Sent on ${when(a.sent_on)}, recorded by ${e(a.sent_recorded_by)}. Each recipient’s history shows this appeal.</p><p><a href="/app/appeals/${e(a.id)}/recipients.csv">Download audience (CSV)</a></p>` : '<p>This appeal was discarded.</p>'
 const decided = approval ? `<p>Prepared by ${e(approval.prepared_by_name)} (${e(approval.prepared_by_role)}) · approved by ${e(approval.approved_by_name)} (${e(approval.approved_by_role)}) on ${when(approval.approved_at)}.</p>` : `<p>Prepared by ${e(a.prepared_by_name)} (${e(a.prepared_by_role)}) on ${when(a.prepared_at)}.</p>`
 return `<p><strong>${e(a.name)}</strong> · ${a.channel === 'email' ? 'Email' : 'Postal mail'} · ${a.recipients} recipients ${a.status==='approved'?chip('Approved','info'):status(a.status)}</p>${warning}<div class="grid wide"><div>${box('Recipients', `<div class="scroll"><table><thead><tr><th>Donor</th><th>${a.channel === 'email' ? 'Email' : 'City'}</th></tr></thead><tbody>${recipients.map(r => `<tr><td><a href="/app/donors/${e(r.donor_id)}">${e(r.name)}</a></td><td>${e(a.channel === 'email' ? r.email : r.address ? JSON.parse(r.address).city : '')}</td></tr>`).join('')}</tbody></table></div>`)}</div>
 <div>${box('Decision', decided + send + actions)}${preview}${progress}${box('Left out', excluded.length ? `<ul class="list">${excluded.map(([reason, n]) => `<li>${chip(n)} ${e(reason)}</li>`).join('')}</ul>` : empty('Nobody in the segment was left out.'))}${details({ 'Appeal ID': a.id, Segment: JSON.parse(a.segment), 'Content hash': a.content_hash, 'Export hash': a.export_hash ?? '' })}</div></div>`
}

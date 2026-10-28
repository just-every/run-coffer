import { manager } from '../auth'
import type { Context } from '../db'
import { sendingDomain } from '../sending-domain'
import { box, e, field, form } from './common'

export async function sendingDomainPanel(c: Context) {
 if (!manager(c.actor)) return ''
 const state = await sendingDomain(c)
 const label = state.status === 'verified' ? 'Verified for automatic receipts' : state.status === 'configuration_changed' ? 'Mail settings changed: save and verify again' : state.status === 'pending' ? 'Waiting for SPF and DKIM verification' : 'Sending domain is not configured'
 const records = state.records.length ? `<h3>DNS records</h3><p>Add these records with your DNS host. The SPF record delegates the return path to SendGrid; both DKIM records delegate signing keys. Allow DNS changes to propagate, then check again.</p><ul class="list">${state.records.map(r => `<li><strong>${e(r.purpose)} · ${e(r.type)}</strong><p>Host: <code style="overflow-wrap:anywhere">${e(r.host)}</code><br>Value: <code style="overflow-wrap:anywhere">${e(r.value)}</code><br>${r.valid && state.status === 'verified' ? 'Confirmed' : 'Waiting for verification'}</p></li>`).join('')}</ul>` : ''
 const configure = state.canConfigure ? form('sendingDomain.save', `<p>In SendGrid, create a domain authentication for <strong>${e(state.currentMailFrom)}</strong> with automated security enabled. Enter its numeric authentication ID. Coffer loads the required records from the configured SendGrid account.</p>${field('SendGrid domain authentication ID', 'authenticationId', 'number', state.authenticationId ?? '', 'required min="1" step="1"')}`, 'Save sending domain', { version: state.version }) : `<p>${e(state.unavailable)}</p>`
 const verify = state.canConfigure && state.records.length && state.status !== 'configuration_changed' ? form('sendingDomain.verify', '<p>Check the current SendGrid authentication and public SPF and DKIM DNS records. Only a successful check enables automatic receipts.</p>', 'Check SPF and DKIM', { version: state.version }) : ''
 return box('Receipt sending domain', `<p role="status"><strong>${e(label)}</strong></p>${state.mailFrom ? `<p>Sender: <strong>${e(state.mailFrom)}</strong></p>` : ''}<p>Changing the sender or provider settings requires a new verification.</p>${state.checkedAt ? `<p>Last checked: ${e(state.checkedAt)}.</p>` : ''}${configure}${records}${verify}`, 'sending-domain')
}

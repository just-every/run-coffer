import { manager } from '../auth'
import type { Context } from '../db'
import { settings } from '../settings'
import { box, chip, e, field, form, guide, select, when } from '../ui/common'
import { emailConnection, savedConnection } from './connection'
import { mailchimpLists } from './mailchimp'

const mangoSteps = `<ol class="steps">
 <li><strong>Get Mango.</strong> Mango is a free, open-source email and text marketing app from the same family as Coffer. You run your own copy, like Coffer. If you already use Mango, skip to the next step. Otherwise open <a href="https://run-mango.com/run">run-mango.com/run</a> and follow it, or in a terminal run <code>curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-mango</code>. It prints Mango’s address, for example <code>http://127.0.0.1:8788</code>, and a sign-in link.</li>
 <li><strong>Make a credential for Coffer inside Mango.</strong> Sign in to Mango as its owner and open <strong>Settings</strong> (at the address Mango printed, then <code>/app/settings</code>). Scroll to <strong>Integration credentials</strong>. Under <strong>Credential name</strong> type <code>Coffer</code>, tick all four boxes (<strong>Read contacts</strong>, <strong>Write contacts</strong>, <strong>Read campaign events</strong> and <strong>Send to a segment</strong>) and press <strong>Create credential</strong>.</li>
 <li><strong>Copy it right away.</strong> Mango shows the credential once. Copy it, paste it below with Mango’s address, then press <strong>Connect Mango</strong>. Coffer checks it with Mango before saving.</li>
</ol>`

const mailchimpSteps = `<ol class="steps">
 <li>Sign in at <a href="https://mailchimp.com">mailchimp.com</a>. You need at least one audience (<strong>Audience → All contacts</strong>).</li>
 <li>Open your profile picture, then <strong>Profile → Extras → API keys</strong>, press <strong>Create A Key</strong>, name it <code>Coffer</code> and copy it. It ends with a dash and letters such as <code>-us21</code>.</li>
 <li>Paste it below and press <strong>Save Mailchimp key</strong>. Coffer lists your audiences so you can pick one.</li>
</ol>`

/** Connect Mango or Mailchimp from the page alone; the credential is saved in Coffer's database. */
export async function connectPage(c: Context, error = '') {
 const boss = manager(c.actor), conn = await savedConnection(c), state = await emailConnection(c), tz = (await settings(c)).timezone
 if (c.env?.RER_INSTALLATION_ID || c.env?.RER_MANAGEMENT_ORIGIN) return box('Not available yet on RER Managed', '<p>Email marketing is not available yet on RER Managed. Use <strong>Export audience</strong> on an approved appeal to send it from another tool.</p>')
 const alert = error ? `<p class="alert" role="alert">${e(error)}</p>` : ''
 const status = box('Connection', `${conn ? `<p>${chip(state.connection ? 'Connected' : 'Unfinished', state.connection ? 'ok' : 'warn')} ${conn.provider === 'mango' ? `Mango at <a href="${e(conn.origin)}">${e(conn.origin)}</a>` : `Mailchimp${conn.listName ? ` · audience “${e(conn.listName)}”` : ''}`}</p>${conn.checkNote ? `<p role="status">${e(conn.checkNote)}</p>` : ''}${conn.checkedAt ? `<p class="muted">Checked ${when(conn.checkedAt, tz)}. The credential is saved in Coffer’s database and never shown again.</p>` : ''}${boss ? `<div class="actions">${form('marketing.check', '', 'Check the connection again', {}, 'secondary')}${form('marketing.disconnect', '', 'Disconnect', {}, 'secondary')}</div>` : ''}` : `<p>${chip('Not connected', 'warn')} Appeals can still be exported as a list for any mailing tool.</p>`}<p><a href="/app/appeals">Back to Appeals</a></p>`)
 if (!boss) return alert + status + '<p>An owner or admin connects email marketing.</p>'
 const mango = box('Connect Mango', `<p>Coffer puts the donors of each approved email appeal on a list in Mango, with the consent each donor gave. You then approve the email in Mango, and Mango sends it and shows every send. Opt-outs flow both ways.</p>${mangoSteps}${form('marketing.connectMango', `${field('Mango’s address', 'origin', 'url', conn?.provider === 'mango' ? conn.origin : '', 'required placeholder="https://mango.example.org"')}${field('Coffer credential from Mango', 'credential', 'password', '', 'required autocomplete="off"')}`, 'Connect Mango')}`, 'mango')
 const lists = conn?.provider === 'mailchimp' ? await mailchimpLists(conn.credential).catch((err: Error) => { error ||= err.message; return [] }) : []
 const audience = conn?.provider === 'mailchimp' && lists.length ? form('marketing.chooseAudience', `${select('Audience', 'listId', lists.map(l => [l.id, `${l.name} (${l.members} contacts)`] as [string, string]), conn.listId ?? '')}${field('Sender name donors see', 'fromName', 'text', conn.fromName ?? '', 'required maxlength="100"')}${field('Reply-to email address', 'fromEmail', 'email', conn.fromEmail ?? '', 'required')}<p class="muted">Use an address on a domain you have verified in Mailchimp.</p>`, 'Use this audience') : ''
 const mailchimp = box('Or connect Mailchimp', `<p>Each approved appeal goes out as a Mailchimp campaign to a saved segment holding exactly its consenting donors. Mailchimp asks new contacts to confirm their subscription first.</p>${mailchimpSteps}${form('marketing.connectMailchimp', field('Mailchimp API key', 'apiKey', 'password', '', 'required autocomplete="off"'), 'Save Mailchimp key')}${audience}`, 'mailchimp')
 return `${alert || (error ? `<p class="alert" role="alert">${e(error)}</p>` : '')}<p>Send approved email appeals and welcome emails through your own email marketing tool. Receipts never depend on this: they go through Coffer’s own mail.</p><div class="grid wide"><div>${mango}${mailchimp}</div><div>${status}<p><a href="${guide('appeals')}">Email marketing guide</a></p></div></div>`
}

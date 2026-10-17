import { manager, type Actor } from '../auth'
import type { Context, Row } from '../db'
import { settings } from '../settings'
import { area, box, e, field, form, money } from './common'

export function morePage(actor: Actor) {
 const boss = manager(actor)
 return `<ul class="tiles">
  ${boss ? '<li><a href="/app/move-in/crm"><strong>Move in from a CRM</strong><span>Little Green Light, Bloomerang or Raiser’s Edge NXT exports, with totals checked before switching.</span></a></li>' : ''}
  ${boss ? '<li><a href="/app/move-in"><strong>Move in from Stripe</strong><span>Bring a year of customers and charges, review, apply or undo.</span></a></li>' : ''}
  <li><a href="/app/settings"><strong>Letter settings</strong><span>Organization name, EIN, threshold and your letter wording.</span></a></li>
  ${boss ? '<li><a href="/app/data"><strong>Data &amp; access</strong><span>Backup and restore, people and roles, agent keys, erasure.</span></a></li>' : ''}
  <li><a href="/auth/settings/identity"><strong>Sign-in settings</strong><span>Your account and how people sign in.</span></a></li>
 </ul>`
}

export async function settingsPage(c: Context, saved: boolean) {
 const s = await settings(c), boss = manager(c.actor)
 const help = `<p class="muted">Fields you can use: {{date}}, {{donor_name}}, {{amount}}, {{gift_date}}, {{fund}}, {{goods_statement}}, {{organization}}, {{ein}}, {{deductible_amount}}. The letter must include the donor’s name, amount, gift date, organization and goods-or-services statement. The wording below is a starting point, not tax advice: review it with your adviser.</p>`
 if (!boss) return box('Letter settings', `<p>${e(s.organisation || 'Organization name not set')} · letters for gifts of ${money(s.threshold_cents)} or more within ${s.target_days} days.</p><p class="muted">An owner or admin edits these settings.</p>`)
 return `${saved ? '<p class="notice" role="status">Settings saved.</p>' : ''}${s.reviewed_at ? '' : '<p class="notice">Coffer will not prepare letters until a person has reviewed and saved this page.</p>'}
 ${box('Your organization and letters', form('settings.update', `<div class="fields">${field('Organization name', 'organisation', 'text', s.organisation, 'required maxlength="200"')}${field('EIN', 'ein', 'text', s.ein, 'placeholder="12-3456789"')}${field('Time zone', 'timezone', 'text', s.timezone, 'required')}${field('Acknowledge gifts of at least (USD)', 'threshold', 'text', (s.threshold_cents / 100).toFixed(2), 'required inputmode="decimal"')}${field('Send within (days)', 'targetDays', 'number', s.target_days, 'required min="1" max="365"')}</div>
  ${field('Letter subject', 'letterSubject', 'text', s.letter_subject, 'required')}${area('Letter', 'letterTemplate', s.letter_template, 'required rows="14"')}${area('When no goods or services were provided', 'noneStatement', s.none_statement, 'required rows="2"')}${area('When goods or services were provided', 'goodsStatement', s.goods_statement, 'required rows="4"')}${help}`, 'Save settings', { version: s.version }))}
 ${s.reviewed_at ? `<p class="muted">Last reviewed by ${e(s.reviewed_by)} on ${e(s.reviewed_at.slice(0, 10))}.</p>` : ''}`
}

export function dataPage(actor: Actor, keys: Row[]) {
 const owner = actor.role === 'owner'
 return `<div class="grid"><div>
 ${box('Back up and restore', `<p>A backup holds donors, gifts, consent history, letters, appeals, approvals and the retained Stripe originals. Keep it private. Sign-in accounts, sessions, agent keys and mail settings are left out.</p>${owner ? '<form method="post" action="/app/backup"><button>Download backup</button></form>' : '<p class="muted">The owner downloads backups.</p>'}<p>To restore on a new computer: clone the repository, run <code>rer dev</code> once to set up a fresh owner, stop it, then:</p><pre>rer import --input exports/coffer.rer --yes\nrer dev</pre><p class="muted">Restore only goes into an empty installation. After erasing a donor, keep a fresh backup and pass it as <code>--journal</code> when restoring an older one.</p>`)}
 ${box('People and roles', `<p><strong>Owner</strong> and <strong>admin</strong> approve and export letters and appeals, reverse gifts, move records in and change settings. <strong>Members</strong> add donors, record gifts, pledges and consent. Only the owner backs up, restores and erases. <strong>Agent keys</strong> read records and prepare letter batches and appeal audiences for a person to approve.</p><p>Invite people with Base’s <code>/auth/invite</code> (see the README). Your operator ID is <code>${e(actor.id)}</code>.</p>`)}
 </div><div>
 ${box('Agent keys', `<p>Keys expire after 30 days and are shown once. An agent can prepare; it can never approve, export, record gifts or consent, move in, restore or erase.</p>${form('agent.create', field('What the agent is for', 'label', 'text', '', 'required maxlength="100" placeholder="Weekly letters assistant"'), 'Create key')}<ul class="list">${keys.map(k => `<li>${e(k.label)} · expires ${e(new Date(k.expires_at).toISOString().slice(0, 10))}${k.revoked_at ? ' · revoked' : form('agent.revoke', '', 'Revoke', { id: k.id }, 'secondary inline')}</li>`).join('')}</ul>`)}
 ${box('Erasing a donor', '<p>Open the donor and use <strong>Erase this donor</strong> (owner only). Their personal details, consent evidence, letter text and the Stripe originals that mention them are removed; gift amounts and dates stay as anonymous ledger lines.</p>')}
 </div></div>`
}

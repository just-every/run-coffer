import type { Context, Row } from '../db'
import { chip, e, hidden, money } from '../ui/common'
import { managed, type GivingEnv } from '../giving/stripe'
import { recoveryData } from './recovery'

const timestamp = (value: number | null) => value ? new Date(value * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'Stripe has not supplied a retry time'
const notice = (row: Row) => ({ pending: 'Not requested', sending: 'Delivery uncertain — review before contacting', sent: 'Card-update email accepted', failed: 'Email failed or delivery uncertain — review before contacting', skipped: 'No deliverable donor account' }[row.notice_state as string] ?? row.notice_state)

export async function recoveryPage(c: Context): Promise<string> {
 if (c.env && managed(c.env as GivingEnv)) return '<section><h2>Monthly gift recovery</h2><p>Stripe recovery is not available yet on RER Managed.</p></section>'
 const data = await recoveryData(c)
 const schedule = `<form method="post" action="/app/agent/recovery/action">${hidden('action', data.enabled ? 'pause' : 'resume')}<label>Reason<input name="why" required maxlength="1000" placeholder="Why change the reconciliation schedule?"></label><button class="secondary">${data.enabled ? 'Pause' : 'Resume'} reconciliation</button></form>`
 return `<section><h2>Monthly gift recovery</h2><p>Coffer reconciliation is <strong>${data.enabled ? 'running daily' : 'paused'}</strong>. Stripe owns payment retries. Pausing this schedule does not stop Stripe charges.</p>
 <p>A failed invoice requests one private card-update email. Coffer checks Stripe for recovery or lapse and records paid gifts once. Emails cannot be unsent and settled charges cannot be undone here.</p>
 ${data.lastRunAt ? `<p>Last reconciliation: ${e(data.lastRunAt)}</p>` : ''}
 <div class="actions">${data.enabled ? '<form method="post" action="/app/agent/recovery/run"><button class="secondary">Check Stripe now</button></form>' : ''}${schedule}</div>
 ${data.rows.length ? `<ul class="list">${data.rows.map(row => `<li><h3><a href="/app/donors/${e(row.donor_id)}">${e(row.donor_name)}</a> ${chip(row.state,row.state==='recovered'?'ok':row.state==='lapsed'?'alarm':'warn')}</h3><p><strong>${money(row.amount_cents)}</strong> monthly · ${e(row.attempt_count)} attempts at Stripe</p><p>${e(notice(row))}</p>${row.state==='waiting'?`<p><strong>Stripe next retry:</strong> ${e(timestamp(row.next_attempt_at))}</p>`:''}<p class="muted">Invoice <code>${e(row.invoice_id)}</code></p></li>`).join('')}</ul>` : '<p>No failed monthly gifts are being tracked.</p>'}</section>`
}

import type { Context, Row } from '../db'
import { chip, e, hidden, moment, money } from '../ui/common'
import { ledgerCard } from '../ui/ledger'
import { settings } from '../settings'
import { managed, type GivingEnv } from '../giving/stripe'
import { recoveryData } from './recovery'

const notice = (row: Row) => ({ pending: 'Not requested', sending: 'Delivery uncertain — review before contacting', sent: 'Card-update email accepted', failed: 'Email failed or delivery uncertain — review before contacting', skipped: 'No deliverable donor account' }[row.notice_state as string] ?? row.notice_state)

export async function recoveryPage(c: Context): Promise<string> {
 if (c.env && managed(c.env as GivingEnv)) return '<section><h2>Monthly gift recovery</h2><p>Stripe recovery is not available yet on RER Managed.</p></section>'
 const [data, s] = await Promise.all([recoveryData(c), settings(c)])
 const retry = (value: number | null) => value ? moment(new Date(value * 1000).toISOString(), s.timezone) : 'Stripe has not supplied a retry time'
 const schedule = `<form method="post" action="/app/agent/recovery/action">${hidden('action', data.enabled ? 'pause' : 'resume')}<label>Reason<input name="why" required maxlength="1000" placeholder="Why change the reconciliation schedule?"></label><button class="secondary">${data.enabled ? 'Pause' : 'Resume'} reconciliation</button></form>`
 const rows = data.rows.map(row => `<tr><td class="cf-date">${e(moment(row.created_at, s.timezone))}</td><td class="cf-who-cell"><a href="/app/donors/${e(row.donor_id)}"><strong>${e(row.donor_name)}</strong></a><small>Stripe invoice ${e(row.invoice_id)}</small></td><td class="cf-amount"><strong>${money(row.amount_cents)}</strong><small>Monthly</small></td><td class="cf-method" data-label="Attempts">${e(row.attempt_count)} at Stripe</td><td class="cf-fund" data-label="Email">${e(notice(row))}${row.state === 'waiting' ? `<small>Next retry ${e(retry(row.next_attempt_at))}</small>` : row.last_checked_at ? `<small>Checked ${e(moment(row.last_checked_at, s.timezone))}</small>` : ''}</td><td class="cf-status">${chip(row.state === 'recovered' ? 'Recovered' : row.state === 'lapsed' ? 'Lapsed' : 'Waiting on Stripe', row.state === 'recovered' ? 'ok' : row.state === 'lapsed' ? 'alarm' : 'warn')}</td></tr>`).join('')
 const table = data.rows.length ? `<table class="cf-ledger-table cf-wrap"><thead><tr><th>Declined</th><th>Donor</th><th>Amount</th><th>Attempts</th><th>Card-update email</th><th>State</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">No failed monthly gifts are being tracked.</p>'
 return `<section class="card"><h2>Monthly gift recovery</h2><p>Coffer reconciliation is <strong>${data.enabled ? 'running daily' : 'paused'}</strong>. Stripe owns payment retries. Pausing this schedule does not stop Stripe charges.</p>
 <p>A failed invoice requests one private card-update email. Coffer checks Stripe for recovery or lapse and records paid gifts once. Emails cannot be unsent and settled charges cannot be undone here.</p>
 ${data.lastRunAt ? `<p>Last reconciliation: ${e(moment(data.lastRunAt, s.timezone))}</p>` : ''}
 <div class="actions">${data.enabled ? '<form method="post" action="/app/agent/recovery/run"><button class="secondary">Check Stripe now</button></form>' : ''}${schedule}</div></section>${ledgerCard('Failed monthly gifts', table)}`
}

// The agent's activity, drawn as a dense ledger: when, what happened and why,
// who did it, the record it touched, and whether a person can still undo it.
import type { Context, Row } from '../db'
import { settings } from '../settings'
import { chip, e, empty, hidden, moment } from '../ui/common'
import { ledgerCard, pageParam, pager } from '../ui/ledger'
import { activity } from './activity'

const PAGE = 25
/** The record an action touched, by the family of its kind. */
function subject(a: Row) {
 const id = encodeURIComponent(a.subject_id)
 if (a.kind.startsWith('recovery.')) return a.subject_id === 'schedule' ? 'Recovery schedule' : `<a href="/app/agent/recovery">Monthly gift invoice</a>`
 if (a.kind.startsWith('stewardship.key')) return '<a href="/app/agent/setup">AI setup</a>'
 if (a.kind.startsWith('stewardship.')) return `<a href="/app/agent/stewardship#draft-${id}">Stewardship draft</a>`
 if (a.kind.startsWith('receipts.')) return `<a href="/app/letters/${id}">Letter batch</a>`
 if (a.kind.startsWith('reconciliation.')) return '<a href="/app/agent/reconcile">Reconciliation</a>'
 if (a.kind === 'agent.undo') return 'Earlier action'
 return e(a.kind)
}

export async function activityTable(c: Context, url: URL) {
 const [records, s] = await Promise.all([activity(c), settings(c)])
 const page = Math.min(pageParam(url), Math.max(0, Math.ceil(records.length / PAGE) - 1)), shown = records.slice(page * PAGE, page * PAGE + PAGE)
 const state = (a: Row) => a.undone_at ? `<span title="Undone ${e(moment(a.undone_at, s.timezone))}">${chip('Undone')}</span>` : a.undo_kind ? `<form method="post" action="/app/agent/activity/undo" class="cf-undo">${hidden('id', a.id)}<button class="secondary">Undo</button></form>` : chip('Done', 'ok')
 const rows = shown.map(a => `<tr><td class="cf-date">${e(moment(a.at, s.timezone))}</td><td class="cf-what"><strong>${e(a.summary)}</strong><small>${e(a.why)}</small></td><td class="cf-method" data-label="By">${e(a.actor_name)}</td><td class="cf-fund" data-label="Record">${subject(a)}</td><td class="cf-status">${state(a)}</td></tr>`).join('')
 const table = records.length ? `<table class="cf-ledger-table cf-stack"><thead><tr><th>When</th><th>What happened</th><th>By</th><th>Record</th><th><span class="sr">State</span></th></tr></thead><tbody>${rows}</tbody></table>` : empty('No agent actions yet. Start with one of the jobs above.')
 return ledgerCard('Agent activity', table, pager(records.length, page, PAGE, n => `/app/agent${n ? `?page=${n}` : ''}`))
}

// Missing receipts, drawn as the Gifts ledger draws gifts: one dense row per gift
// with its date, donor, fund, amount, method and why it has no receipt yet.
import type { Context, Row } from '../db'
import { chip, e, empty, money, paidBy, shortDate } from '../ui/common'
import { ledgerCard, pageParam, pager } from '../ui/ledger'
import { receiptPolicy } from './receipt-autonomy-policy'
import { receiptAutonomyState } from './receipt-autonomy'
import { missingReceipts } from './receipts'

const PAGE = 25
const reason = (g: Row) => g.hold_reasons?.length ? g.hold_reasons.map((r:string)=>chip('Held · '+r,'warn')).join(' ') : g.previous_status ? chip('Failed delivery · ready for review', 'alarm') : chip('Past target · no receipt')

export async function receiptAgentPage(c: Context, url: URL) {
 const selectedKey=(await receiptPolicy(c)).selected_key_id
 const gifts = await missingReceipts(c), page = Math.min(pageParam(url), Math.max(0, Math.ceil(gifts.length / PAGE) - 1)), shown = gifts.slice(page * PAGE, page * PAGE + PAGE)
 const held = gifts.filter(g => g.goods === 'unknown').length, failed = gifts.filter(g => g.goods !== 'unknown' && g.previous_status).length
 const intro = `<section class="card"><p>Finds not-acknowledged gifts past the target date, including small gifts and bounced receipts, from the installation acknowledgment cutoff onward. Standard receipts send only after an admin selects a standing-approved agent key. Unusual receipts wait for a person; uncertain email submissions stay held.</p>
 <p class="cf-figures"><span><b>${gifts.length}</b> without a receipt</span><span><b>${money(gifts.reduce((t, g) => t + g.amount_cents, 0))}</b> in all</span><span><b>${held}</b> held for a goods answer</span><span><b>${failed}</b> failed delivery</span></p>
 <form method="post" action="/app/agent/receipts/queue"><button>${selectedKey?'Run receipt agent under standing approval':'Queue missing receipts for approval'}</button></form></section>`
 const rows = shown.map(g => `<tr><td class="cf-date">${shortDate(g.received_on)}</td><td class="cf-who-cell"><a href="/app/donors/${e(g.donor_id)}"><strong>${e(g.donor_name)}</strong></a><small${g.city ? '' : ' class="cf-none"'}>${g.city ? e([g.city, g.region].filter(Boolean).join(', ')) : 'No address on file'}</small></td><td class="cf-fund" data-label="Fund">${e(g.fund)}</td><td class="cf-amount"><strong>${money(g.amount_cents)}</strong></td><td class="cf-method" data-label="Paid by">${e(paidBy(g))}</td><td class="cf-status">${reason(g)}</td></tr>`).join('')
 const table = gifts.length ? `<table class="cf-ledger-table"><thead><tr><th>Date</th><th>Donor</th><th>Fund</th><th>Amount</th><th>Paid by</th><th>Receipt</th></tr></thead><tbody>${rows}</tbody></table>` : empty('Every eligible gift has a receipt or is already in a batch.')
 return intro + ledgerCard('Gifts without a receipt', table, pager(gifts.length, page, PAGE, n => `/app/agent/receipts${n ? `?page=${n}` : ''}`))
}

/** The parent agent page appends this private administrative panel. */
export async function receiptAutonomyPanel(c:Context) {
 const s=await receiptAutonomyState(c)
 const reviews=s.reviews.map((r:Row)=>`<li><a href="/app/donors/${e(r.donor_id)}">${e(r.donor_name)}</a> · ${money(r.amount_cents)} — ${JSON.parse(r.reasons).map(e).join('; ')}${r.batch_id?` · <a href="/app/letters/${e(r.batch_id)}">Review frozen receipt</a>`:''}</li>`).join('')
 const statements=s.statements.map((r:Row)=>`<li><a href="/app/letters/${e(r.batch_id)}">${e(r.statement_year)} · ${e(r.recipient_name)}</a> — ${e(r.reason)}${r.recoverable?`<form method="post" action="/app/agent/receipts/statements/recover"><input type="hidden" name="batchId" value="${e(r.batch_id)}"><input type="hidden" name="version" value="${r.version}"><button>Send approved pending statements</button></form>`:''}</li>`).join('')
 return `<section class="card"><h2>Receipt standing approval</h2><p>The named grant controls records, daily limits and the exact approved template revision. The background grant and global stop switch also apply.</p>
 <form method="post" action="/app/agent/receipts/settings"><input type="hidden" name="version" value="${s.version}">
 <label>Acknowledge gifts received from<input type="date" name="acknowledgeFrom" value="${e(s.acknowledge_from??'')}"></label>
 <label>Largest standard gift ($)<input name="maxStandardAmount" inputmode="decimal" value="${(s.max_standard_cents/100).toFixed(2)}" required></label>
 <label>Standing-approved agent key<select name="keyId"><option value="">Prepare only for human approval</option>${s.keys.map((k:Row)=>`<option value="${e(k.id)}"${k.id===s.selected_key_id?' selected':''}>${e(k.label)} · ${e(k.grant_name)}</option>`).join('')}</select></label>
 <label><input type="checkbox" name="standingApproval" value="yes">I authorize standard receipt sending under this key’s current standing template approval</label><button>Save receipt policy</button></form>
 <form method="post" action="/app/agent/receipts/run"><button>Run receipt agent</button></form></section>
 <section class="card"><h2>Receipts waiting for a person</h2>${reviews?`<ul>${reviews}</ul>`:empty('No receipt review is waiting.')}</section>
 <section class="card"><h2>Year-end delivery recovery</h2><p>Only an explicitly approved, never-submitted statement can be sent here. Accepted, uncertain and failed deliveries need investigation or mailing.</p>${statements?`<ul>${statements}</ul>`:empty('No undelivered year-end statement is waiting.')}</section>`
}

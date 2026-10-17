// Missing receipts, drawn as the Gifts ledger draws gifts: one dense row per gift
// with its date, donor, fund, amount, method and why it has no receipt yet.
import type { Context, Row } from '../db'
import { chip, e, empty, money, paidBy, shortDate } from '../ui/common'
import { ledgerCard, pageParam, pager } from '../ui/ledger'
import { missingReceipts } from './receipts'

const PAGE = 25
const reason = (g: Row) => g.goods === 'unknown' ? chip('Held · goods not answered', 'warn') : g.previous_status ? chip('Delivery failed · print', 'alarm') : chip('No receipt yet')

export async function receiptAgentPage(c: Context, url: URL) {
 const gifts = await missingReceipts(c), page = Math.min(pageParam(url), Math.max(0, Math.ceil(gifts.length / PAGE) - 1)), shown = gifts.slice(page * PAGE, page * PAGE + PAGE)
 const held = gifts.filter(g => g.goods === 'unknown').length, failed = gifts.filter(g => g.goods !== 'unknown' && g.previous_status).length
 const intro = `<section class="card"><p>Finds every unreceipted gift, including gifts below the usual letter threshold, and bounced receipts. A person reviews and approves the frozen batch in Letters. Bounced addresses go to print; uncertain email submissions are held.</p>
 <p class="cf-figures"><span><b>${gifts.length}</b> without a receipt</span><span><b>${money(gifts.reduce((t, g) => t + g.amount_cents, 0))}</b> in all</span><span><b>${held}</b> held for a goods answer</span><span><b>${failed}</b> failed delivery</span></p>
 <form method="post" action="/app/agent/receipts/queue"><button>Queue missing receipts for approval</button></form></section>`
 const rows = shown.map(g => `<tr><td class="cf-date">${shortDate(g.received_on)}</td><td class="cf-who-cell"><a href="/app/donors/${e(g.donor_id)}"><strong>${e(g.donor_name)}</strong></a><small${g.city ? '' : ' class="cf-none"'}>${g.city ? e([g.city, g.region].filter(Boolean).join(', ')) : 'No address on file'}</small></td><td class="cf-fund" data-label="Fund">${e(g.fund)}</td><td class="cf-amount"><strong>${money(g.amount_cents)}</strong></td><td class="cf-method" data-label="Paid by">${e(paidBy(g))}</td><td class="cf-status">${reason(g)}</td></tr>`).join('')
 const table = gifts.length ? `<table class="cf-ledger-table"><thead><tr><th>Date</th><th>Donor</th><th>Fund</th><th>Amount</th><th>Paid by</th><th>Receipt</th></tr></thead><tbody>${rows}</tbody></table>` : empty('Every eligible gift has a receipt or is already in a batch.')
 return intro + ledgerCard('Gifts without a receipt', table, pager(gifts.length, page, PAGE, n => `/app/agent/receipts${n ? `?page=${n}` : ''}`))
}

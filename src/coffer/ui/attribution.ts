import type { Context, Row } from '../db'
import { manager } from '../auth'
import { appealCodes, attributionReport, CHANNEL_LABELS } from '../attribution'
import { box, e, empty, field, form, longDay, money } from './common'

const DIMENSIONS: [keyof Pick<Awaited<ReturnType<typeof attributionReport>>, 'fund' | 'campaign' | 'appeal' | 'channel'>, string][] = [['fund', 'Fund'], ['campaign', 'Campaign'], ['appeal', 'Appeal'], ['channel', 'Channel']]

/** GIFT-003: ledger totals by each attribution dimension, and the appeals gifts reference. */
export async function attributionPage(c: Context, url: URL) {
 const [r, appeals] = await Promise.all([attributionReport(c, url), appealCodes(c)])
 const tables = DIMENSIONS.map(([key, label]) => box(`By ${label.toLowerCase()}`, r[key].length ? `<div class="scroll"><table class="stack"><thead><tr><th>${label}</th><th>Gifts</th><th>Amount</th></tr></thead><tbody>${r[key].map((x: Row) => `<tr><td class="lead">${e(x.label)}</td><td data-label="Gifts">${x.gifts}</td><td data-label="Amount">${money(x.amountCents)}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total (ledger)</th><td></td><td data-label="Total">${money(r.ledgerCents)}</td></tr></tfoot></table></div>` : empty('No gifts in this period.'))).join('')
 const filters = `<form method="get" action="/app/gifts/attribution"><div class="fields">${field('From', 'from', 'date', r.from, 'required')}${field('To', 'to', 'date', r.to, 'required')}</div><button>Read totals</button></form>`
 const list = appeals.length ? `<ul class="list">${appeals.map(a => `<li><strong>${e(a.name)}</strong> · code ${e(a.code)} · ${a.gifts} gift${a.gifts === 1 ? '' : 's'}${a.origin === 'import' ? ' · from an import' : ''}<br><small>Tracked link: <code>/give/&lt;campaign&gt;?appeal=${e(encodeURIComponent(a.code))}</code></small></li>`).join('')}</ul>` : empty('No appeals defined yet.')
 const define = manager(c.actor) ? form('appealCode.define', `<div class="fields">${field('Appeal code', 'code', 'text', '', 'required maxlength="80" placeholder="SPRING-MAIL"')}${field('Appeal name', 'name', 'text', '', 'required maxlength="200" placeholder="Spring mail appeal"')}</div>`, 'Define appeal') : ''
 return `${box('Gift attribution', `<p>${longDay(r.from)} to ${longDay(r.to)}, inclusive. Every ledger entry in these days (gifts, refunds and reversals) counts once in each table, under its gift’s fund, campaign, appeal and channel, so each table sums to the fund ledger. Channels: ${Object.values(CHANNEL_LABELS).map(e).join(', ')}.</p>${filters}`)}${tables}${box('Appeals', `<p>Gifts reference a defined appeal by its code: chosen when recording a gift, carried by a giving page link ending <code>?appeal=CODE</code>, or mapped from an import’s appeal column (an imported appeal not yet defined is defined from that import).</p>${list}${define}`)}`
}

import type { pledgeInvoice } from '../pledge-invoices'
import { e, longDay, money } from './common'

const styles = `
*{box-sizing:border-box}html{font-family:Arial,Helvetica,sans-serif;color:#182128;background:#f3f4f3;line-height:1.5}body{margin:0}
.print-help,main{max-width:8.5in;margin:24px auto;padding:28px 36px;background:white;border:1px solid #c7ccca;border-radius:12px;overflow-wrap:anywhere}
h1{font-size:26px;line-height:1.2;margin:0 0 16px}h2{font-size:18px;margin:24px 0 8px}p{margin:8px 0}address{font-style:normal;white-space:pre-line;margin:24px 0}
a{color:#174f78;text-underline-offset:3px}a:focus-visible{outline:3px solid #174f78;outline-offset:3px}dl{display:grid;grid-template-columns:1fr auto;gap:8px 20px}dt,dd{margin:0}dd{text-align:right}.total{font-weight:bold}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px 6px;border-bottom:1px solid #c7ccca;text-align:right}th:first-child,td:first-child{text-align:left}tr{break-inside:avoid}thead{display:table-header-group}
@media screen and (max-width:600px){.print-help,main{margin:16px;padding:20px}table{font-size:13px}th,td{padding:9px 3px}}
@page{size:letter;margin:.65in}@media print{html{color:black;background:white;font-size:11pt}.print-help{display:none}main{max-width:none;margin:0;padding:0;border:0;border-radius:0}a{color:black}h2{break-after:avoid}}
`

export function printPledgeInvoice(invoice: Awaited<ReturnType<typeof pledgeInvoice>>): Response {
 const { organization, day, recipient, pledge: p } = invoice
 const address = JSON.parse(recipient.letter_address)
 const postal = [recipient.letter_name, address.line1, address.line2, [address.city, address.region, address.postalCode].filter(Boolean).join(' '), address.country].filter(Boolean).join('\n')
 const unpaid = p.installments.filter((i: any) => i.remaining_cents > 0)
 const title = p.remaining_cents > 0 ? 'Pledge invoice' : 'Pledge balance'
 const rows = unpaid.map((i: any) => `<tr><td><time datetime="${e(i.due_on)}">${e(longDay(i.due_on))}</time></td><td>${money(i.amount_cents)}</td><td>${money(i.paid_cents)}</td><td>${money(i.remaining_cents)}</td></tr>`).join('')
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${e(organization)}</title><style>${styles}</style></head><body>
 <header class="print-help"><p>Use your browser’s Print menu to print or save as PDF. Choose US Letter paper and turn off browser headers and footers.</p><p>This page shows the current balance when opened. Reopen it after recording a payment or adjustment. Opening or printing it does not send a message.</p><a href="/app/donors/${e(p.donor_id)}#pledges">Back to donor’s pledges</a></header>
 <main><h1>${title}</h1><p><strong>${e(organization)}</strong></p><p>As of ${e(longDay(day))}</p><address>${e(postal)}</address>
 <p>Dear ${e(recipient.letter_salutation)},</p><p>${p.remaining_cents > 0 ? 'Thank you for your pledge. The unpaid balance and installment schedule are below.' : 'Your pledge has no unpaid balance. No payment is requested.'}</p>
 <p>Fund: ${e(p.fund)}<br>Pledged on ${e(longDay(p.pledged_on))}<br>Reference: ${e(p.id)}</p>
 <dl><dt>Original commitment</dt><dd>${money(p.amount_cents)}</dd><dt>Payments received</dt><dd>${money(p.paid_cents)}</dd><dt>Reductions / write-offs</dt><dd>${money(p.reduced_cents)}</dd><dt class="total">Remaining pledge balance</dt><dd class="total">${money(p.remaining_cents)}</dd></dl>
 ${rows ? `<h2>Unpaid installments</h2><table><thead><tr><th scope="col">Due date</th><th scope="col">After reductions</th><th scope="col">Paid</th><th scope="col">Remaining</th></tr></thead><tbody>${rows}</tbody></table>` : p.remaining_cents > 0 ? '<p>This pledge has no dated installment schedule. Please contact the organization to arrange payment.</p>' : ''}
 <p>This is a request for an existing pledge balance, not a tax receipt or a record of a new gift. If you have already sent payment, please contact us so we can match it to your pledge.</p></main></body></html>`, { headers: {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'strict-origin', 'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
 } })
}

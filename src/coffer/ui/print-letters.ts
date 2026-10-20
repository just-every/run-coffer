import { receiptText } from '../receipt-format'
import type { Row } from '../db'
import { e } from './common'

function postalAddress(letter: Row): string {
 const address: Row = letter.address ? JSON.parse(letter.address) : {}
 const locality = [address.city, address.region, address.postalCode].filter(Boolean).join(' ')
 return [letter.recipient_name, address.line1, address.line2, locality, address.country]
  .filter(Boolean).map(e).join('<br>')
}

// A separate document keeps application navigation and theme rules out of the mail.
const styles = `
*{box-sizing:border-box}
html{color:#182128;background:#f3f4f3;font-family:Arial,Helvetica,sans-serif;line-height:1.55}
body{margin:0}
.print-help{max-width:8.5in;margin:24px auto;padding:20px 24px;background:#fff;border:1px solid #c7ccca;border-radius:12px}
.print-help h1{font-size:24px;line-height:1.25;margin:0 0 12px}
.print-help p{margin:8px 0}
.print-help a{color:#174f78;display:inline-block;padding:8px 0;text-underline-offset:3px}
.print-help a:focus-visible{outline:3px solid #174f78;outline-offset:4px}
main{max-width:8.5in;margin:auto}
.letter{background:#fff;margin:24px 0;padding:.75in .8in;box-shadow:0 1px 6px #0002;overflow-wrap:anywhere}
.letterhead{min-height:1.25in;font-weight:600;white-space:pre-wrap}
.recipient{font-style:normal;line-height:1.35;min-height:1in;max-width:4in;break-inside:avoid;page-break-inside:avoid}
.subject{font-size:1em;line-height:1.4;margin:.3in 0 .2in;white-space:pre-wrap;break-after:avoid;page-break-after:avoid}
.letter-body{white-space:pre-wrap;orphans:3;widows:3}
@media screen and (max-width:600px){
 .print-help{margin:16px;padding:16px}
 .letter{margin:16px;padding:24px;box-shadow:none;border:1px solid #c7ccca;border-radius:12px}
 .letterhead{min-height:0;margin-bottom:32px}
 .recipient{min-height:0}
 .subject{margin:24px 0 16px}
}
@page{size:letter;margin:.75in .8in}
@media print{
 html{background:#fff;color:#000;font-size:11pt}
 .print-help{display:none}
 main{max-width:none;margin:0}
 .letter{margin:0;padding:0;border:0;border-radius:0;box-shadow:none}
 .letter+.letter{break-before:page;page-break-before:always}
}
`

/** Printable snapshots, whether a single receipt or an entire batch. */
export function printLetters(letters: Row[], organisation: string): Response {
 const title = letters.length === 1 ? 'Print letter' : 'Print letters'
 const content = letters.map((letter, index) => `<article class="letter" aria-labelledby="subject-${index}">
 <div class="letterhead">${e(organisation)}</div>
 <address class="recipient">${postalAddress(letter)}</address>
 <h2 class="subject" id="subject-${index}">${e(letter.subject)}</h2>
 <div class="letter-body">${e(receiptText(letter))}</div>
 </article>`).join('')
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${e(organisation)}</title><style>${styles}</style></head><body>
 <header class="print-help"><h1>${title}</h1><p>${letters.length} ${letters.length === 1 ? 'letter' : 'letters'} · ${e(organisation)}</p><p>Use your browser’s Print menu to print or save as PDF. Choose US Letter paper, 100% scale, and turn off browser headers and footers. Check the print preview and a test sheet against your window envelope before mailing.</p><a href="/app/letters">Back to letters</a></header>
 <main aria-label="Letters">${content || '<p>No letters to print.</p>'}</main></body></html>`, {
  headers: {
   'content-type': 'text/html; charset=utf-8',
   'cache-control': 'no-store',
   'referrer-policy': 'strict-origin',
   'x-content-type-options': 'nosniff',
   'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  },
 })
}

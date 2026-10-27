import { receiptText } from '../receipt-format'
import type { Row } from '../db'
import { postalLines } from '../print-address'
import { e } from './common'

const postalAddress = (letter: Row) => postalLines(letter).map(e).join('<br>')

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
.label-sheet{display:grid;grid-template-columns:repeat(3,2.625in);grid-template-rows:repeat(10,1in);column-gap:.125in;width:8.125in;height:10in;background:white;margin:24px auto}
.label{width:2.625in;height:1in;padding:.1in;font-size:10pt;line-height:11pt;font-style:normal;overflow-wrap:anywhere;margin:0;break-inside:avoid;page-break-inside:avoid}
.postal{display:block}
.envelope{position:relative;width:9.5in;height:4.125in;background:white;margin:24px auto;font-size:12pt;line-height:15pt;overflow-wrap:anywhere}
.return-name{position:absolute;left:.5in;top:.35in;width:3.5in;white-space:pre-wrap;font-size:10pt;line-height:13pt}
.envelope .recipient{position:absolute;left:3.75in;top:1.58in;width:4in;margin:0;min-height:0;line-height:15pt}
.envelopes{max-width:9.5in}
.address-overflow{outline:2px solid #a32323;background:#fff1ed}
.print-warning{color:#a32323;font-weight:bold}
[hidden]{display:none!important}
@media screen and (max-width:950px){.envelope{width:100%;max-width:9.5in}.envelope .recipient{left:40%;width:55%}.return-name{max-width:45%}}
@media screen and (max-width:800px){.label-sheet{width:100%;height:auto;grid-template-columns:repeat(auto-fit,2.625in);grid-template-rows:none;grid-auto-rows:1in;justify-content:center;column-gap:.125in}}
@media screen and (max-width:600px){
 .print-help{margin:16px;padding:16px}
 .letter{margin:16px;padding:24px;box-shadow:none;border:1px solid #c7ccca;border-radius:12px}
 .letterhead{min-height:0;margin-bottom:32px}
 .recipient{min-height:0}
 .subject{margin:24px 0 16px}
 .envelope{height:3in}.return-name{left:16px;top:16px}.envelope .recipient{left:28%;top:1.2in;width:67%}
}
@page{size:letter;margin:.75in .8in}
@page labels{size:letter;margin:.5in .1875in}
@page envelopes{size:9.5in 4.125in;margin:0}
@media print{
 html{background:#fff;color:#000;font-size:11pt}
 .print-help{display:none}
 main{max-width:none;margin:0}
 .letter{margin:0;padding:0;border:0;border-radius:0;box-shadow:none}
 .letter+.letter{break-before:page;page-break-before:always}
 .label-sheet{page:labels;margin:0}
 .label-sheet+.label-sheet{break-before:page;page-break-before:always}
 .envelope{page:envelopes;margin:0}
 .envelope+.envelope{break-before:page;page-break-before:always}
 body.has-overflow main{display:none}
 body.has-overflow .print-help{display:block;border:0;margin:0;padding:0}
 body.has-overflow .print-help a{display:none}
}
`

const overflowCheck = `const inspect=()=>{let count=0;document.querySelectorAll('.label,.envelope').forEach(box=>{const text=box.querySelector('.postal');if(!text)return;const bounds=text.getBoundingClientRect(),outer=box.getBoundingClientRect();const bad=box.classList.contains('label')?bounds.height>outer.height-parseFloat(getComputedStyle(box).paddingTop)-parseFloat(getComputedStyle(box).paddingBottom)+1:bounds.bottom>outer.bottom-12||bounds.right>outer.right-12;box.classList.toggle('address-overflow',bad);if(bad)count++});const warning=document.getElementById('address-warning');warning.hidden=!count;document.body.classList.toggle('has-overflow',!!count)};document.fonts.ready.then(inspect);addEventListener('beforeprint',inspect);addEventListener('resize',inspect);`

/** Printable frozen snapshots, whether a single receipt or a grouped batch. */
export function printLetters(letters: Row[], organisation: string, labels = false, envelopes = false): Response {
 const pieces = letters.some(letter => letter.mail_piece)
 const title = labels ? 'Print address labels' : envelopes ? 'Print #10 envelopes' : pieces ? 'Print mailing pieces' : letters.length === 1 ? 'Print letter' : 'Print letters'
 let content: string
 if (labels) {
  const sheets: string[] = []
  for (let offset = 0; offset < letters.length; offset += 30) sheets.push(`<section class="label-sheet" aria-label="Label sheet ${sheets.length + 1}">${letters.slice(offset, offset + 30).map(letter => `<address class="label"><span class="postal">${postalAddress(letter)}</span></address>`).join('')}</section>`)
  content = sheets.join('')
 } else if (envelopes) content = letters.map(letter => `<article class="envelope" aria-label="Envelope for ${e(String(letter.recipient_name))}"><div class="return-name">${e(organisation)}</div><address class="recipient"><span class="postal">${postalAddress(letter)}</span></address></article>`).join('')
 else content = letters.map((letter, index) => `<article class="letter" aria-labelledby="subject-${index}">
 <div class="letterhead">${e(organisation)}</div>
 <address class="recipient">${postalAddress(letter)}</address>
 <h2 class="subject" id="subject-${index}">${e(String(letter.subject ?? ''))}</h2>
 <div class="letter-body">${e(receiptText(letter))}</div>
 </article>`).join('')
 const nonce = crypto.randomUUID().replace(/-/g, '')
 const instructions = labels ? 'Choose Avery 5160 stock: 30 labels per US Letter sheet, three columns of 2⅝ × 1 inch, with ⅛ inch column gaps. Use 100% scale and turn off browser headers and footers.'
  : envelopes ? 'Choose #10 envelope paper (9½ × 4⅛ inches), landscape, 100% scale, no margins, and turn off browser headers and footers. Feed envelopes as your printer directs.'
  : 'Choose US Letter paper, 100% scale, and turn off browser headers and footers. Check a test sheet against your window envelope before mailing. Long letters continue on additional pages.'
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${e(organisation)}</title><style>${styles}</style></head><body>
 <header class="print-help"><h1>${title}</h1><p>${letters.length} ${pieces ? 'mailing pieces' : letters.length === 1 ? 'letter' : 'letters'} · ${e(organisation)}</p><p>Use your browser’s Print menu. ${instructions}</p><p class="print-warning" id="address-warning" role="alert" hidden>An address exceeds this format’s printable area. Printing is paused to avoid losing address lines. Choose a larger envelope or review the postal address before printing.</p><a href="/app/letters">Back to letters</a></header>
 <main class="${envelopes ? 'envelopes' : labels ? 'labels' : 'letters'}" aria-label="${envelopes ? 'Envelopes' : labels ? 'Address labels' : 'Letters'}">${content || '<p>No letters to print.</p>'}</main>${labels || envelopes ? `<script nonce="${nonce}">${overflowCheck}</script>` : ''}</body></html>`, {
  headers: {
   'content-type': 'text/html; charset=utf-8',
   'cache-control': 'no-store',
   'referrer-policy': 'no-referrer',
   'x-content-type-options': 'nosniff',
   'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  },
 })
}

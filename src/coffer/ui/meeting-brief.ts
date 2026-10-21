import type { Row } from '../db'
import { usd } from '../money'
import { e } from './common'

const date = (value: unknown) => String(value ?? '').slice(0, 10)
const excerpt = (value: unknown) => {
 const text = String(value ?? '').replace(/\s+/g, ' ').trim()
 return text.length > 140 ? text.slice(0, 140) + '… (continued in source)' : text
}
const present = (values: unknown[]) => values.filter(v => v !== undefined && v !== null && v !== '').join(' · ')

/** A factual reading aid; full underlying records remain available at each source. */
function description(kind: string, f: Row): string {
 switch (kind) {
  case 'giving_summary': return present([
   `${usd(f.lifetimeCents)} lifetime net giving`, `${f.giftCount} gifts`,
   f.fiscalYear && `${usd(f.fiscalYear.currentCents)} this fiscal year (${f.fiscalYear.start}–${f.fiscalYear.end}, as of ${f.fiscalYear.asOf})`,
   f.lastGift && `Last gift ${usd(f.lastGift.amountCents)} on ${f.lastGift.receivedOn}`,
   `${usd(f.openPledgeCents)} open pledges`,
  ])
  case 'interaction': return present([date(f.occurred_on), f.kind, f.who, excerpt(f.notes), f.next_step && `Next: ${excerpt(f.next_step)}`])
  case 'relationship': return present([f.label, f.other_name])
  case 'pledge': return present([f.fund, `${usd(f.remaining_cents)} remaining`, f.due_by && `Due ${f.due_by}`])
  case 'opportunity': return present([f.label, f.stage_label ?? f.stage, `${usd(f.ask_amount_cents)} ask`, f.expected_close_on && `Expected ${f.expected_close_on}`, f.next_step && `Next: ${excerpt(f.next_step)}`])
  case 'open_question': return present([`From meeting ${date(f.occurred_on)}`, f.open_question])
  case 'stored_research': return present([
   'WealthEngine stored provider estimate', date(f.researched_at),
   f.status === 'no_match' ? 'No matching profile' : null,
   f.capacity_range && `Five-year giving capacity: ${f.capacity_range}`,
   f.wealth_rating && `Wealth rating: ${f.wealth_rating}`,
   f.propensity && `Giving propensity: ${f.propensity}`,
  ])
  default: throw new Error('Unsupported meeting brief line: ' + kind)
 }
}

const sections = [
 ['giving_summary', 'Giving summary'], ['open_question', 'Questions left open'],
 ['interaction', 'Recent interactions'], ['relationship', 'Relationships'],
 ['pledge', 'Open pledges'], ['opportunity', 'Open opportunities'],
 ['stored_research', 'Stored prospect research'],
]

const styles = `
*{box-sizing:border-box}html{font-family:Arial,Helvetica,sans-serif;color:#182128;background:#f3f4f3;line-height:1.45}body{margin:0}
.print-help,main{max-width:8.5in;margin:24px auto;padding:24px 36px;background:white;border:1px solid #c7ccca;border-radius:12px}
h1{font-size:24px;line-height:1.2;margin:0 0 12px}h2{font-size:16px;margin:18px 0 6px}p{margin:6px 0}ul{margin:0;padding-left:19px}
li{margin:4px 0;overflow-wrap:anywhere}a{color:#174f78;text-underline-offset:3px}a:focus-visible{outline:3px solid #174f78;outline-offset:3px}
.print-sections{display:none}.meta{color:#4b565d;font-size:13px}.source{white-space:nowrap;font-size:.9em}header{border-bottom:1px solid #c7ccca;padding-bottom:12px}.question{white-space:pre-wrap}
@media screen and (max-width:600px){.print-help,main{margin:16px;padding:20px}h1{font-size:22px}}
@page{size:letter;margin:.5in}
@media print{html{background:white;color:black;font-size:10pt;line-height:1.2}.print-help{display:none}main{max-width:none;margin:0;padding:0;border:0;border-radius:0}.screen-sections{display:none}.print-sections{display:block;columns:2;column-gap:24px}h1{font-size:17pt;margin-bottom:5px}h2{font-size:11pt;margin:10px 0 3px;break-after:avoid}header{padding-bottom:7px}.meta{font-size:9pt;color:black}li{margin:3px 0}a{color:black}.source{font-size:9pt}p{margin:4px 0}}
`

/** The print brief summarizes sections; linked records retain the complete detail. */
export function printMeetingBrief(brief: Row): Response {
 const content = sections.map(([kind, title]) => {
  const lines: Row[] = brief.lines.filter((line: Row) => line.kind === kind)
  if (!lines.length && kind === 'stored_research') return ''
  return `<section><h2>${title}</h2>${lines.length ? `<ul>${lines.map(line => {
   const source = line.source, fragment = source.pointer + (source.id ? '/id=' + source.id : '')
   return `<li data-brief-kind="${e(kind)}"><span${kind === 'open_question' ? ' class="question"' : ''}>${e(description(kind, line.facts))}</span> <a class="source" href="${e(source.href)}" data-source-pointer="${e(source.pointer)}"${source.id ? ` data-source-id="${e(source.id)}"` : ''} aria-label="${e(title + ' source ' + fragment)}">Source</a></li>`
  }).join('')}</ul>` : '<p class="meta">None recorded.</p>'}</section>`
 }).join('')
 const printContent=sections.map(([kind,title])=>{
  const lines:Row[]=brief.lines.filter((line:Row)=>line.kind===kind)
  if(!lines.length&&kind==='stored_research')return ''
  const limit=kind==='interaction'?10:kind==='open_question'||kind==='giving_summary'?1:2
  const selected=lines.slice(0,limit)
  const summary=selected.map(line=>{
   const facts=line.facts
   const words=kind==='interaction'?present([date(facts.occurred_on),facts.kind,excerpt(String(facts.notes).slice(0,70))]):description(kind,facts)
   return `<li>${e(words)} <a href="${e(line.source.href)}">Source</a></li>`
  }).join('')
  const more=lines.length>limit?`<p>${lines.length-limit} further ${e(title.toLowerCase())}; <a href="${e(selected[0].source.href)}">all source records</a>.</p>`:''
  return `<section><h2>${title}</h2>${selected.length?`<ul>${summary}</ul>${more}`:'<p>None recorded.</p>'}</section>`
 }).join('')
 const starts = String(brief.meeting.starts_at).replace('T', ' ').replace('.000Z', ' UTC')
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meeting brief · ${e(brief.donor.name)}</title><style>${styles}</style></head><body>
 <div class="print-help"><p>Use your browser’s Print menu to print or save as PDF. Choose US Letter, 100% scale, and turn off browser headers and footers. These concise summaries link to the full records.</p><p><a href="/app/donors/${e(brief.donor.id)}#meetings">Back to donor meetings</a></p></div>
 <main aria-label="Meeting brief"><header><h1>Meeting brief · ${e(brief.donor.name)}</h1><p>Meeting: ${e(starts)}</p><p class="meta">Current records as of ${e(brief.generatedAt)}. ${e(brief.delivery)}</p></header><div class="screen-sections">${content}</div><div class="print-sections">${printContent}</div></main></body></html>`, { headers: {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'strict-origin',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
 } })
}

import type { Context, Row } from '../db'
import { today } from '../db'
import { settings } from '../settings'
import { area, box, chip, e, empty, field, hidden, money, moment, select } from '../ui/common'
import { developmentMonth, developmentReportFacts } from './development-report-sources'
import { developmentReports } from './development-report'
import { developmentReportDocument } from './development-report-document'

const action=(command:string,content:string,label:string,values:Row={})=>`<form method="post" action="/app/agent/reports/${command}">${Object.entries(values).map(([key,value])=>hidden(key,value)).join('')}${content}<button>${e(label)}</button></form>`
const states:Record<string,string>={draft:'Draft for director review',approved:'Approved for named recipients',sending:'Submission in progress',submitted:'Email submitted',uncertain:'Delivery unconfirmed',rejected:'Email rejected',held:'Held',partial:'Mixed recipient outcomes'}

function editor(r:Row) {
 const notes=JSON.parse(r.notes),sources=JSON.parse(r.sources)
 return `<details><summary>Edit report and recipients</summary>${action('save',field('Report subject','subject','text',r.subject,'required maxlength="200"')+
  area('Director introduction','introduction',r.introduction,'aria-label="Director introduction" maxlength="2000"')+
  sources.sections.map((section:Row)=>area(section.title+' commentary',section.key+'Note',notes[section.key]??'',`aria-label="${e(section.title+' commentary')}" maxlength="2000"`)).join('')+
  area('Approved recipient email addresses','recipients',JSON.parse(r.recipients).join('\n'),'aria-label="Approved recipient email addresses" required rows="3"')+
  '<p class="muted">Director commentary accepts prose. All numerical claims stay in the linked source figures. Changing a figure requires preparing a fresh draft from its source report. Saving any edit removes approval.</p>',
  'Save director edits',{id:r.id,version:r.version})}</details>`
}
function approval(r:Row) {
 if(r.status==='draft')return `<details><summary>Review exact report disclosure</summary>${action('approve',
  '<p>Review the report above and its saved recipient addresses before approving.</p>'+area('Director approval authority','authorityNote','','aria-label="Director approval authority" required maxlength="1000"')+
  '<label><input type="checkbox" name="reviewed" value="yes" required> I am the director or explicitly authorized by the director, and approve this exact report for these named recipients.</label>',
  'Approve exact report',{id:r.id,version:r.version,contentHash:r.content_hash})}</details>`
 if(r.status==='approved')return action('send','<label><input type="checkbox" name="confirm" value="SEND" required> Send this exact approved report to its named recipients. Email cannot be recalled.</label>','Send approved report',{id:r.id,version:r.version,contentHash:r.content_hash})
 return '<p>This report has a durable submission claim. Check its recorded recipient outcomes; it cannot be submitted again.</p>'
}
function reportCard(r:Row,deliveries:Row[],timezone:string) {
 const recipients=JSON.parse(r.recipients)
 return box(r.subject,`<p>${chip(states[r.status]??r.status)} · Prepared ${e(moment(r.prepared_at,timezone))}</p>
 ${r.custody_hold?`<p role="alert">${e(r.custody_hold)}</p>`:''}<p>Named recipients: ${recipients.length?recipients.map(e).join(', '):'Save recipients before approval.'}</p>
 ${developmentReportDocument(r)}${!r.custody_hold&&['draft','approved'].includes(r.status)?editor(r):''}${!r.custody_hold?approval(r):''}
 ${deliveries.length?`<h3>Recipient outcomes</h3><ul>${deliveries.map(d=>`<li>${e(d.recipient)}: ${e(states[d.status]??d.status)}${d.detail?` — ${e(d.detail)}`:''}</li>`).join('')}</ul>`:''}`,'development-report-'+r.id)
}
export async function developmentReportPage(c:Context,url:URL) {
 const s=await settings(c),month=url.searchParams.get('month')??today(s.timezone,new Date(c.now)).slice(0,7)
 if(url.searchParams.get('sources')==='1')return developmentReportSourcesPage(c,month)
 const state=await developmentReports(c,month),selected=url.searchParams.get('id'),reports=selected?state.reports.filter(r=>r.id===selected):state.reports
 const enabled=state.grant?.enabled&&state.grant?.donor_ids===null
 const draft=action('draft',field('Reporting month','month','month',month,'required'),'Prepare monthly draft')
 const current=reports[0],earlier=reports.slice(1),render=(r:Row)=>reportCard(r,state.deliveries.filter(d=>d.report_id===r.id),s.timezone)
 return box('Prepare a monthly report',`${enabled?draft:'<p class="notice">Enable the complete-ledger report drafting grant in report settings.</p>'}
 <p><a href="/app/agent/reports?month=${e(month)}&sources=1">Review source facts</a> · <a href="/app/settings/development-reports?month=${e(month)}">Report settings</a></p>
 <details><summary>Sources and director approval</summary><p>${e(state.policy)}</p><p>Annual retention and current pipeline figures keep their actual periods. Preparing a draft never sends email.</p></details>`)+
 (current?render(current):empty('No monthly development report prepared for this month.'))+
 (earlier.length?`<details><summary>Earlier reports (${earlier.length})</summary>${earlier.map(render).join('')}</details>`:'')
}
export async function developmentReportSettingsPage(c:Context,url:URL) {
 const s=await settings(c),month=(await developmentMonth(c,url.searchParams.get('month')??today(s.timezone,new Date(c.now)).slice(0,7))).month
 const state=await developmentReports(c),schedule=state.schedule!
 const scheduleForm=action('schedule',select('Monthly preparation schedule','enabled',[['no','Stopped'],['yes','Enabled']],schedule.enabled?'yes':'no','aria-label="Monthly preparation schedule"')+
  field('Preparation day of month','dayOfMonth','number',schedule.day_of_month,'required min="1" max="28"')+
  '<label><input type="checkbox" name="reviewed" value="yes"> I authorize preparing the previous completed month on this organization-calendar day. Every report still needs director review and explicit send approval.</label>',
  'Save monthly preparation',{version:schedule.version,month})
 return `<p><a href="/app/settings">Settings</a> · <a href="/app/agent/reports?month=${e(month)}">Development reports</a></p>`+
 box('Monthly preparation',`<p>Prepare the previous completed calendar month on the selected organization-calendar day. This schedule never approves or sends a report.</p>
 <p><a href="/app/agent/grants">Manage the report drafting grant</a></p>${schedule.hold_reason?`<p role="alert">${e(schedule.hold_reason)}</p>`:''}${scheduleForm}`)
}

export async function developmentReportSourcesPage(c:Context,month:string) {
 const facts=await developmentReportFacts(c,month)
 return box('Notable received gifts',`<p>Positive signed contributions for ${e(facts.from)} through ${e(facts.through)}, grouped by gift identity. Source links remain subject to ordinary record access.</p>${facts.notable.length?`<ul>${facts.notable.map(g=>`<li>${g.donorId?`<a href="/app/donors/${e(g.donorId)}">${e(g.donorName)}</a>`:e(g.donorName)}: ${e(money(g.amountCents))}</li>`).join('')}</ul>`:empty('No positive received contributions.')}`,'notable')+
 box('Current overdue follow-up',`<p>Current outstanding active sources due by the report period end and overdue as of ${e(facts.asOf)}. Current balances do not reconstruct a historical month end.</p><p>${facts.overdue.count} overdue items; ${e(money(facts.overdue.remainingCents))} remaining pledge and match amounts.</p>
 ${facts.overdue.rows.length?`<ul>${facts.overdue.rows.map(r=>`<li><a href="/app/donors/${e(r.donor_id)}">${e(r.donor_name)}</a> — ${e(r.title)}, due ${e(r.due_on)}: ${e(money(r.amount_cents))}${r.hold?` · ${e(r.hold)}`:''}</li>`).join('')}</ul>`:empty('No current overdue sources in this selection.')}`,'overdue')
}

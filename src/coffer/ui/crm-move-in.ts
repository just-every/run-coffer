import type { Row } from '../db'
import { area, box, chip, e, empty, hidden, money, select, when } from './common'

export const sources: [string,string][]=[['lgl','Little Green Light'],['bloomerang','Bloomerang'],['re-nxt',"Raiser's Edge NXT"]]
const name=(source:string)=>sources.find(([key])=>key===source)?.[1]||source
const guide='https://github.com/just-every/run-coffer/blob/main/docs/MOVE-IN-SOURCES.md'

export function crmMoveInPage(jobs:Row[]) {
 return `<p>Bring your donor records and gift history into Coffer. Preview every file and compare totals before you switch.</p><div class="grid"><div>
 ${box('1. Choose your exports',`<form method="post" action="/app/move-in/crm/preview" enctype="multipart/form-data">${select('Moving from','source',sources)}
 <label>Export files (CSV or XLSX)<input type="file" name="exports" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple required></label>
 <p class="muted">Include the constituent and gift exports, plus households, relationships, pledges, soft credits and notes. Workbooks can contain several sheets. Each review holds up to 1,000 rows and 4 MB of files.</p>
 <label><input type="checkbox" name="noGoodsOrServices" value="yes"> All gifts without a recorded goods value were donations with no goods or services in return.</label>
 <p class="muted">Leave this unticked if you are unsure. Those gifts wait for a goods answer before a receipt.</p><button>Preview exports</button></form>`)}
 </div><div>${box('Prepare the switch',`<ol class="steps"><li><a href="${guide}">Follow your source’s export guide</a> and include stable record IDs.</li><li>Review counts, gifts by year, fund and donor, and any source report totals.</li><li>Resolve named rows or explicitly accept differences.</li><li>Apply the whole review, then inspect donor histories. Undo is one step while records remain unused.</li></ol><p>Exports move history. They do not move stored cards or start or stop recurring charges. Keep the old system until your cutover is complete.</p><p><a href="/app/move-in">Import Stripe JSON pages</a></p>`)}
 ${box('Recent CRM imports',jobs.length?`<ul class="list">${jobs.map(j=>`<li><a href="/app/move-in/crm/journal?id=${e(j.id)}">${e(name(j.source))} · ${j.state==='completed'?'Applied':'Undone'}</a> · ${when(j.created_at)}</li>`).join('')}</ul>`:empty('No CRM exports imported yet.'))}</div></div>`
}

function totals(rows:Row[]) {
 return `<div class="scroll"><table class="stack crm-totals"><thead><tr><th>Group</th><th>Source count</th><th>Coffer count</th><th>Source gifts</th><th>Coffer gifts</th><th>Check</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="lead">${e(r.scope)} · ${e(r.key||'All gifts')}</td><td data-label="Source count">${r.sourceCount??'Not supplied'}</td><td data-label="Coffer count">${r.cofferCount}</td><td data-label="Source gifts">${r.sourceCents===null?'Not supplied':money(r.sourceCents)}</td><td data-label="Coffer gifts">${money(r.cofferCents)}</td><td>${chip(r.matches?'Match':'Difference',r.matches?'ok':'warn')}</td></tr>`).join('')}</tbody></table></div>`
}
const counts=(values:Row)=>`<ul class="list">${Object.entries(values).map(([k,v])=>`<li><strong>${v}</strong> ${e(k==='softCredits'?'soft credits':k)}</li>`).join('')}</ul>`
const location=(v:Row)=>`${e(v.file||'')}${v.sheet?` / ${e(v.sheet)}`:''}${v.row?` · row ${v.row}`:''}${v.column?` · ${e(v.column)}`:''}`
const records=(title:string,values:Row[],render:(v:Row)=>string)=>`<details class="card"><summary>${e(title)} · ${values.length}</summary>${values.length?`<ul class="list">${values.map(v=>`<li>${render(v)}<br><span class="muted">${location(v.location||v)}</span></li>`).join('')}</ul>`:empty('None in these exports.')}</details>`

export function crmPreviewPage(input:Row,p:Row) {
 const blocked=!p.canApply, differences=p.reconciliation.filter((r:Row)=>!r.matches).length
 return `<p>${e(name(p.source))} · ${p.files.length} files. Nothing has changed.</p>
 ${p.prior?.state==='completed'?`<p class="notice">This exact file set was already applied. Applying again changes nothing. <a href="/app/move-in/crm/journal?id=${e(p.prior.id)}">Open its journal</a>.</p>`:''}
 <p class="${blocked||differences?'alert':'notice'}" role="status">${blocked?'Resolve the named errors before applying.':differences?`${differences} totals differences need resolution or acceptance.`:'Gift counts and totals match.'} ${p.unmapped.length?`${p.unmapped.length} unmapped values need review.`:''}</p>
 <div class="grid wide"><div>${box('2. Check totals before switching',`<p>Source numbers are read from the gift rows before mapping. Coffer numbers show the mapped history after apply, including gifts already imported. Supplied source report controls are checked separately. Pledges and soft credits never inflate received gifts.</p>${totals(p.reconciliation)}`)}
 ${records('Donors',p.donors,d=>`<strong>${e(d.name)}</strong> · ${e(d.externalId)}${d.householdName?` · ${e(d.householdName)}`:''}`)}
 ${records('Households',p.households,h=>`${e(h.name)} · ${e(h.externalId)}`)}
 ${records('Gifts',p.gifts,g=>`${e(g.externalId)} · donor ${e(g.donorExternalId)} · ${when(g.receivedOn)} · ${money(g.amountCents)} · ${e(g.fund)}${g.campaign?` · ${e(g.campaign)}`:''}`)}
 ${records('Relationships',p.relationships,r=>`${e(r.donorExternalId)} → ${e(r.relatedDonorExternalId)} · ${e(r.type)}`)}
 ${records('Soft credits',p.softCredits,s=>`${money(s.amountCents)} · donor ${e(s.donorExternalId)} · original gift ${e(s.giftExternalId)}`)}
 ${records('Pledges',p.pledges,v=>`${e(v.externalId)} · donor ${e(v.donorExternalId)} · ${money(v.amountCents)} · ${e(v.fund)}${v.note?`<p>${e(v.note)}</p>`:''}`)}
 ${records('Installments',p.installments,i=>`${e(i.pledgeExternalId)} · ${when(i.dueOn)} · ${money(i.amountCents)}`)}
 ${records('Notes and conversations',p.notes,n=>`Donor ${e(n.donorExternalId)} · ${e(n.type)} · ${e(n.text)}`)}
 </div><div>${box('Mapped records',`${counts(p.counts)}<p>${p.newRecords} new records · ${p.matchedRecords} existing matches · ${p.alreadyImported} previously imported records.</p>`)}
 ${box('3. Apply this exact review',blocked?'<p>Fix the errors in the source exports and preview again.</p>':`<form method="post" action="/app/move-in/crm/apply">${hidden('payload',JSON.stringify(input))}${hidden('fingerprint',p.fingerprint)}
 ${area('Reason for accepting differences or unmapped values','acceptedReason','',p.needsAcceptance?'required maxlength="2000"':'maxlength="2000"')}
 <label><input type="checkbox" name="confirm" value="yes" required> I reviewed the totals and mappings and approve this move-in.</label><p>The complete review applies in one transaction. The same files can be applied again without duplicates.</p><button>Apply reviewed import</button></form>`)}
 ${box('Named rows and columns',p.diagnostics.length||p.unmapped.length?`<ul class="list">${p.diagnostics.map((d:Row)=>`<li>${chip(d.severity,d.severity==='error'?'warn':'')} ${e(d.message)}<br>${location(d)}</li>`).join('')}${p.unmapped.map((u:Row)=>`<li>${location(u)}<p>${e(u.reason)}</p><code>${e(u.value)}</code></li>`).join('')}</ul>`:empty('Every supplied value mapped.'))}
 <p><a href="/app/move-in/crm">Choose corrected files</a> · <a href="${guide}">Export guide</a></p></div></div>`
}

export function crmJournalPage(result:Row) {
 const j=result.job,r=j.report
 return `<p>${chip(j.state==='completed'?'Applied':'Undone',j.state==='completed'?'ok':'')} ${e(name(j.source))} · ${when(j.created_at)} · ${e(j.created_by)}</p>
 <p>${j.state==='completed'?'The whole review was applied together. Re-importing the same files changes nothing.':'All records added by this import were removed together. Existing matched records were kept.'}</p>
 <div class="grid wide"><div>${r.reconciliation?box('Checked totals',totals(r.reconciliation)):''}${r.counts?box('Imported history',counts(r.counts)):''}
 ${r.files?box('Source files',`<ul class="list">${r.files.map((f:Row)=>`<li>${e(f.name)} · ${f.rows} rows</li>`).join('')}</ul><p class="muted">Original upload bytes are not retained. Keep your source exports securely.</p>`):''}</div><div>
 ${j.accepted_reason?box('Accepted differences',`<p>${e(j.accepted_reason)}</p>`):''}
 ${j.state==='completed'?box('Undo as one step',j.redacted?'<p>A donor was erased. This import can no longer be undone.</p>':`<form method="post" action="/app/move-in/crm/undo">${hidden('id',j.id)}<p>Undo removes the records added here. Any edits or subsequent use block the whole undo, so work done since the move-in stays safe.</p><button class="secondary">Undo this import</button></form>`):''}
 <p><a href="/app/donors">Inspect donor histories</a> · <a href="/app/move-in/crm">Move in more exports</a></p></div></div>`
}

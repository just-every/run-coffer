import type { Row } from '../db'
import { area, box, chip, e, empty, field, guide, hidden, money, select, when } from './common'
import { exportSteps } from './crm-export-steps'

export const sources: [string,string][]=[['lgl','Little Green Light'],['bloomerang','Bloomerang'],['re-nxt',"Raiser's Edge NXT"]]
const name=(source:string)=>sources.find(([key])=>key===source)?.[1]||source
const sourceGuide=guide('move-in-crm')

export function crmMoveInPage(jobs:Row[]) {
 return `<p>Bring your donor records and gift history into Coffer. Preview every file and compare totals before you switch.</p><div class="grid"><div>
 ${box('1. Choose your exports',`<form method="post" action="/app/move-in/crm/preview" enctype="multipart/form-data">${select('Moving from','source',sources)}
 <label>Export files (CSV or XLSX)<input type="file" name="exports" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple required></label>
 <p class="muted">Include the constituent and gift exports, plus relationships, pledges, soft credits and notes if you have them. Workbooks can contain several sheets. One move-in takes up to 16 MB of files and 100,000 rows, about 10,000 donors with 80,000 gifts. Larger? Split the gift export by year and upload constituents.csv again with each year’s file; donors already moved in are matched, not copied.</p>
 <label><input type="checkbox" name="noGoodsOrServices" value="yes"> All gifts without a recorded goods value were donations with no goods or services in return.</label>
 <p class="muted">Leave this unticked if you are unsure. Those gifts wait for a goods answer before a receipt.</p><button>Preview exports</button></form>`)}
 </div><div>${box('Export from your CRM',`<p>Open your CRM’s steps below. Each export needs the record IDs, so gifts find their donors.</p>${exportSteps()}<p><a href="${sourceGuide}">CRM move-in guide</a> covers pledges, soft credits, households and total checks in more detail.</p>`)}
 ${box('Prepare the switch',`<ol class="steps"><li>Export the files above, keeping the record ID columns.</li><li>Check the counts and the gift totals by year, fund and donor against your CRM.</li><li>Fix any row the review names, or say why a difference is fine.</li><li>Move it in. Large exports go in parts of about 800 records; Coffer checks the totals again at the end. Undo removes everything this move-in added while nobody has used it yet.</li></ol><p>Exports move history. They do not move stored cards or start or stop recurring charges. Keep the old system until your cutover is complete.</p><p><a href="/app/move-in">Import Stripe JSON pages</a></p>`)}
 ${box('Recent CRM imports',jobs.length?`<ul class="list">${jobs.map(j=>`<li><a href="/app/move-in/crm/journal?id=${e(j.id)}">${e(name(j.source))} · ${j.state==='completed'?'Moved in':j.state==='applying'?`Part ${j.applied_parts} of ${j.parts}`:j.state==='reviewed'?'Reviewed':'Undone'}</a> · ${when(j.created_at)}</li>`).join('')}</ul>`:empty('No CRM exports imported yet.'))}</div></div>`
}

function totals(rows:Row[]) {
 return `<div class="scroll"><table class="stack crm-totals"><thead><tr><th>Group</th><th>Gifts in your files</th><th>Gifts in Coffer</th><th>Amount in your files</th><th>Amount in Coffer</th><th>Check</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="lead">${e(r.scope)} · ${e(r.key||'All gifts')}</td><td data-label="Gifts in your files">${r.sourceCount??'Not supplied'}</td><td data-label="Gifts in Coffer">${r.cofferCount}</td><td data-label="Amount in your files">${r.sourceCents===null?'Not supplied':money(r.sourceCents)}</td><td data-label="Amount in Coffer">${money(r.cofferCents)}</td><td>${chip(r.matches?'Match':'Difference',r.matches?'ok':'warn')}</td></tr>`).join('')}</tbody></table></div>`
}
const counts=(values:Row)=>`<ul class="list">${Object.entries(values).map(([k,v])=>`<li><strong>${v}</strong> ${e(k==='softCredits'?'soft credits':k)}</li>`).join('')}</ul>`
const location=(v:Row)=>`${e(v.file||'')}${v.sheet?` / ${e(v.sheet)}`:''}${v.row?` · row ${v.row}`:''}${v.column?` · ${e(v.column)}`:''}`
const SHOWN=50
const records=(title:string,values:Row[],render:(v:Row)=>string)=>`<details class="card"><summary>${e(title)} · ${values.length}</summary>${values.length?`<ul class="list">${values.slice(0,SHOWN).map(v=>`<li>${render(v)}<br><span class="muted">${location(v.location||v)}</span></li>`).join('')}</ul>${values.length>SHOWN?`<p class="muted">The first ${SHOWN} of ${values.length} are shown. The totals check covers all of them.</p>`:''}`:empty('None in these exports.')}</details>`
const issues=(p:Row)=>{
 const named=[...p.diagnostics.filter((d:Row)=>d.code!=='UNMAPPED'),...p.unmapped]
 return named.length?`<ul class="list">${named.slice(0,100).map((d:Row)=>`<li>${d.severity?chip(d.severity==='error'?'Must fix':'Check','warn')+' ':''}${location(d)}<p>${e(d.message??d.reason)}</p>${d.value?`<code>${e(d.value)}</code>`:''}</li>`).join('')}</ul>${named.length>100?`<p class="muted">${named.length-100} more like these are not shown.</p>`:''}`:empty('Every value in the files has a place in Coffer.')
}

export function crmPreviewPage(p:Row,today:string) {
 const blocked=!p.canApply, differences=p.reconciliation.filter((r:Row)=>!r.matches).length
 return `<p>${e(name(p.source))} · ${p.files.length} files. Your donor records have not changed yet.</p>
 ${p.prior?`<p class="notice">This exact file set was already ${p.prior.state==='completed'?'moved in':'started'}. <a href="/app/move-in/crm/journal?id=${e(p.prior.id)}">Open its journal</a>.</p>`:''}
 <p class="${blocked||differences?'alert':'notice'}" role="status">${blocked?'Fix the rows marked “Must fix” in your files, then upload them again.':differences?`${differences} totals differ between your files and what Coffer would hold.`:'Gift counts and totals match.'} ${p.unmapped.length?`${p.unmapped.length} values have no place in Coffer and would be left out.`:''}</p>
 <div class="grid wide"><div>${box('2. Check totals before switching',`<p>“Your files” counts every gift row exactly as exported. “Coffer” counts the gifts Coffer will hold after the move-in. Pledges and soft credits are promises and recognition, so they are not counted as money received. If you exported a totals report, its numbers are checked too.</p>${totals(p.reconciliation)}`)}
 ${records('Donors',p.donors,d=>`<strong>${e(d.name)}</strong> · ${e(d.externalId)}${d.householdName?` · ${e(d.householdName)}`:''}`)}
 ${records('Households',p.households,h=>`${e(h.name)} · ${e(h.externalId)}`)}
 ${records('Gifts',p.gifts,g=>`${e(g.externalId)} · donor ${e(g.donorExternalId)} · ${when(g.receivedOn)} · ${money(g.amountCents)} · ${e(g.fund)}${g.campaign?` · ${e(g.campaign)}`:''}`)}
 ${records('Relationships',p.relationships,r=>`${e(r.donorExternalId)} → ${e(r.relatedDonorExternalId)} · ${e(r.type)}`)}
 ${records('Soft credits',p.softCredits,s=>`${money(s.amountCents)} · donor ${e(s.donorExternalId)} · original gift ${e(s.giftExternalId)}`)}
 ${records('Pledges',p.pledges,v=>`${e(v.externalId)} · donor ${e(v.donorExternalId)} · ${money(v.amountCents)} · ${e(v.fund)}${v.note?`<p>${e(v.note)}</p>`:''}`)}
 ${records('Installments',p.installments,i=>`${e(i.pledgeExternalId)} · ${when(i.dueOn)} · ${money(i.amountCents)}`)}
 ${records('Notes and conversations',p.notes,n=>`Donor ${e(n.donorExternalId)} · ${e(n.type)} · ${e(n.text)}`)}
 </div><div>${box('What moves in',`${counts(p.counts)}${p.parts>1?`<p>This goes in ${p.parts} parts of about 800 records. You can leave and come back between parts.</p>`:''}`)}
 ${box('3. Move it in',blocked||p.prior?'<p>Fix the files and upload them again.</p>':`<form method="post" action="/app/move-in/crm/apply">${hidden('id',p.id)}${hidden('fingerprint',p.fingerprint)}
 <fieldset><legend>Were these gifts already thanked in ${e(name(p.source))}?</legend><label><input type="radio" name="acknowledged" value="yes" checked> Yes, gifts before this date were already thanked. Coffer will not list them as letters due.</label>${field('Thanked before','acknowledgedBefore','date',today,'required')}<label><input type="radio" name="acknowledged" value="no"> No, list every imported gift as waiting for a letter.</label></fieldset>
 ${area('Why the differences or left-out values are fine','acceptedReason','',p.needsAcceptance?'required maxlength="2000"':'maxlength="2000"')}
 <label><input type="checkbox" name="confirm" value="yes" required> I checked the totals and want to move these records in.</label><p>Moving the same files in again never makes copies.</p><button>Move these records in</button></form>`)}
 ${box('Rows to look at',issues(p))}
 <p><a href="/app/move-in/crm">Choose corrected files</a> · <a href="${sourceGuide}">CRM move-in guide</a></p></div></div>`
}

export function crmJournalPage(result:Row) {
 const j=result.job,r=j.report,check=j.check_report
 const state=j.state==='completed'?chip('Moved in','ok'):j.state==='applying'?chip(`Part ${j.applied_parts} of ${j.parts}`,'info'):j.state==='reviewed'?chip('Reviewed, not moved in','warn'):chip('Undone','')
 const progress=j.state==='applying'?box('Moving in',`<p><progress max="${j.parts}" value="${j.applied_parts}">${j.applied_parts} of ${j.parts}</progress></p><p>${j.applied_parts} of ${j.parts} parts are in Coffer. Each press of Continue moves in as many parts as fit in about 20 seconds. It is safe to leave and come back: nothing is applied twice.</p><form method="post" action="/app/move-in/crm/continue">${hidden('id',j.id)}<button>Continue</button></form>`):''
 const checked=check?box('Totals check',`<p>${check.matches?chip('All totals match','ok'):chip('Totals differ','warn')} Checked ${when(j.checked_at)}: the gifts now in Coffer from this move-in, against your files.</p>${totals(check.rows)}<form method="post" action="/app/move-in/crm/check">${hidden('id',j.id)}<button class="secondary">Check totals again</button></form>`):''
 return `<p>${state} ${e(name(j.source))} · ${when(j.created_at)} · ${e(j.created_by)}</p>
 <p>${j.state==='completed'?'Everything in this move-in is in Coffer. Moving the same files in again changes nothing.':j.state==='applying'?'This move-in is under way.':j.state==='undone'?'Everything this move-in added was removed. Records that already existed were kept.':'Nothing from this review has been moved in yet.'}${j.acknowledged_before?` Gifts before ${when(j.acknowledged_before)} count as already thanked.`:''}</p>
 <div class="grid wide"><div>${progress}${checked}${!check&&r.reconciliation?box('Totals in your files',totals(r.reconciliation)):''}${r.counts?box('Imported history',counts(r.counts)):''}
 ${r.files?box('Source files',`<ul class="list">${r.files.map((f:Row)=>`<li>${e(f.name)} · ${f.rows} rows</li>`).join('')}</ul><p class="muted">Coffer does not keep the uploaded files. Keep your exports somewhere safe.</p>`):''}</div><div>
 ${j.accepted_reason?box('Accepted differences',`<p>${e(j.accepted_reason)}</p>`):''}
 ${['completed','applying'].includes(j.state)?box('Undo as one step',j.redacted?'<p>A donor was erased. This import can no longer be undone.</p>':`<form method="post" action="/app/move-in/crm/undo">${hidden('id',j.id)}<p>Undo removes every record this move-in added. If anyone has edited or used one since (a gift, a letter, a call), nothing is undone, so work done since stays safe.</p><button class="secondary">Undo this move-in</button></form>`):''}
 <p><a href="/app/donors">Look at donor histories</a> · <a href="/app/move-in/crm">Move in more exports</a></p></div></div>`
}

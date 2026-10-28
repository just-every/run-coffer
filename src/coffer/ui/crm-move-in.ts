import type { ParsedContact } from '../move-in/types'
import type { Row } from '../db'
import { area, box, chip, e, empty, field, guide, hidden, longDay, money, select, when } from './common'
import { exportSteps } from './crm-export-steps'

export const sources: [string,string][]=[['lgl','Little Green Light'],['bloomerang','Bloomerang'],['re-nxt',"Raiser's Edge NXT"]]
const name=(source:string)=>sources.find(([key])=>key===source)?.[1]||source
const sourceGuide=guide('move-in-crm')
const codeMeaning=(rule:any)=>rule.type==='stop'?'Do not solicit':rule.type==='ignore'?'Skip':rule.type==='withdraw'?'Withdraw '+rule.channels.join(', ')+' consent':rule.type==='tag'?'Tag: '+rule.tag:rule.type==='channels'?'No '+rule.channels.join(', ')+' appeals':`At most ${rule.maxAsks} asks per rolling 12 months`
const mappingLines=(mapping:Row={})=>Object.entries(mapping).map(([code,r])=>`${code} = ${r.type==='stop'?'stop':r.type==='ignore'?'skip':r.type==='withdraw'?'withdraw '+r.channels.join(', '):r.type==='tag'?'tag '+r.tag:r.type==='channels'?'no '+r.channels.join(', '):'limit '+r.maxAsks}`).join('\n')
const restrictionMapping=(mapping:Row={})=>`<details><summary>Map organization-specific communication codes</summary><p>Write one code per line: <strong>code = stop</strong> (do not solicit), <strong>code = withdraw email</strong> (channel consent), <strong>code = no mail</strong> (appeals restriction), <strong>code = limit 1</strong> (asks per rolling 12 months), <strong>code = tag Board</strong>, or <strong>code = skip</strong>. Channels can be email, mail, phone or sms. NXT codes always need review. Known LGL and Bloomerang Do Not Contact flags retain their channel consent meaning. The last completed mapping is reused for the same CRM.</p>${area('Code meanings','solicitCodes',mappingLines(mapping),'rows="6"')}</details>`
const preferenceReview=(report:Row)=>report.sample?.consents?.length?box('Channel preferences',`<p>${e(name(report.source))} source answers append to the consent history when this import is saved. A newer native choice is never replaced. Withdrawals override conflicting source grants.</p><ul class="list">${report.sample.consents.map((c:Row)=>`<li><strong>${e(c.donorExternalId)}</strong> · ${e(c.channel)} · ${e(c.status)} · ${e(name(report.source))}<br>${c.sourceOn?'Source date: '+longDay(c.sourceOn):'Source date unknown'} · Import date recorded on save<br>${e(c.evidence)}<br>${location(c.location)}</li>`).join('')}</ul>`):''



const customChoices=(m:Row)=> (m.choices??[]).map((v:string)=>{
 if(m.type!=='currency')return v
 const n=BigInt(v),negative=n<0n,raw=String(negative?-n:n).padStart(3,'0')
 return (negative?'-':'')+raw.slice(0,-2)+'.'+raw.slice(-2)
}).join('\n')
function customMapping(source:string,report:Row={}) {
 const columns=report.sourceColumns??[{column:'',sheet:'',kind:'constituent'}], mappings=report.customFields??[], definitions=report.customDefinitions??[]
 return `<details><summary>Map custom report columns</summary><p>Choose the exact exported column and its record kind, then select an existing field or define a new one. Leave the field key empty to leave a column out. USD amounts need at most two decimal places; pick-many cells use a list such as ["Board", "Volunteer"]. Blank cells leave values unset. Preview again to review every mapping before moving in.</p>${columns.map((column:Row)=>{
  const m=mappings.find((v:Row)=>v.column===column.column&&(!v.sheet||v.sheet===column.sheet)&&v.kind===column.kind)??{}, existing=m.version?m.key:''
  const eligible=definitions.filter((f:Row)=>f.kind===column.kind)
  return `<fieldset><legend>${e(column.column||'Source custom column')}${column.sheet?` · ${e(column.sheet)}`:''}</legend>${hidden('customSource',source)}${column.column?hidden('customColumn',column.column):field('Exported column','customColumn','text')}${hidden('customSheet',m.column?m.sheet??'':column.sheet)}
  ${select('Existing field','customExisting',[['','Define a new field or leave out'],...eligible.map((f:Row)=>[JSON.stringify({...f,choices:JSON.parse(f.choices)}),f.label+' · '+f.key] as [string,string])],existing?JSON.stringify({...definitions.find((f:Row)=>f.key===existing),choices:m.choices}):'')}
  ${field('New field key','customKey','text',existing?'':m.key??'','pattern="[a-z][a-z0-9_]*" maxlength="80"')}${field('New field label','customLabel','text',existing?'':m.label??'','maxlength="100"')}
  ${select('Record kind','customKind',[['constituent','Constituent'],['gift','Gift'],['pledge','Pledge'],['interaction','Interaction'],['note','Note']],m.kind??column.kind)}
  ${select('Value type','customType',[['text','Text'],['number','Number'],['currency','USD currency'],['date','Date'],['year','Year'],['checkbox','Checkbox']],m.type??'text')}
  ${select('Entry method','customEntry',[['free-form','Free-form'],['pick-one','Pick one'],['pick-many','Pick many']],m.entry??'free-form')}
  ${area('New field choices (one per line)','customChoices',customChoices(m),'rows="3"')}</fieldset>`
 }).join('')}</details>`
}
const reviewedCustom=(report:Row)=>report.customFields?.length?box('Reviewed custom fields',`<ul class="list">${report.customFields.map((m:Row)=>`<li><strong>${e(m.label)}</strong> · ${e(m.key)} · ${e(m.kind)} · ${e(m.type)} · ${e(m.entry)}<br>${e(m.source)} / ${e(m.sheet||'Every worksheet')} / ${e(m.column)}${m.choices.length?`<br>Choices: ${e(customChoices(m).replace(/\n/g,', '))}`:''}</li>`).join('')}</ul><p>Only these reviewed columns and definitions move in. The source values retain their original record IDs, donor IDs and column provenance. No provider receives these values.</p>`):''


export function crmMoveInPage(jobs:Row[],tz:string,definitions:Row[]=[]) {
 return `<p>Bring your donor records and gift history into Coffer. Preview every file and compare totals before you switch.</p><div class="grid"><div>
 ${box('1. Choose your exports',`<form method="post" action="/app/move-in/crm/preview" enctype="multipart/form-data">${select('Moving from','source',sources)}
 <label>Export files (CSV or XLSX)<input type="file" name="exports" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple required></label>
 <p class="muted">Include the constituent and gift exports, plus relationships, pledges, soft credits and notes if you have them. Workbooks can contain several sheets. One move-in takes up to 16 MB of files and 100,000 rows, about 10,000 donors with 80,000 gifts. Larger? Split the gift export by year and move the years in oldest first, uploading constituents.csv again with each year’s file; donors and pledges already moved in are matched by their CRM ID, not copied.</p>
 ${restrictionMapping()}${customMapping('',{customDefinitions:definitions})}<label><input type="checkbox" name="noGoodsOrServices" value="yes"> All gifts without a recorded goods value were donations with no goods or services in return.</label>
 <p class="muted">Leave this unticked if you are unsure. Those gifts wait for a goods answer before a receipt.</p><button>Preview exports</button></form>`)}
 </div><div>${box('Export from your CRM',`<p>Open your CRM’s steps below. Each export needs the record IDs, so gifts find their donors.</p>${exportSteps()}<p><a href="${sourceGuide}">CRM move-in guide</a> covers pledges, soft credits, households and total checks in more detail.</p>`)}
 ${box('Prepare the switch',`<ol class="steps"><li>Export the files above, keeping the record ID columns.</li><li>Check the counts and the gift totals by year, fund and donor against your CRM.</li><li>Fix every row the review marks “Must fix” (it lists them all and downloads them as a spreadsheet), or say why a difference is fine.</li><li>Move it in. Large exports go in parts of about 800 records; Coffer checks the totals again at the end. Undo removes everything this move-in added while nobody has used it yet.</li></ol><p>Exports move history. They do not move stored cards or start or stop recurring charges. Keep the old system until your cutover is complete.</p><p><a href="/app/move-in">Move in from Stripe</a></p>`)}
 ${box('Recent CRM imports',jobs.length?`<ul class="list">${jobs.map(j=>`<li><a href="/app/move-in/crm/${j.state==='reviewed'?'review':'journal'}?id=${e(j.id)}">${e(name(j.source))} · ${j.state==='completed'?'Moved in':j.state==='applying'?`Part ${j.applied_parts} of ${j.parts}`:j.state==='reviewed'?(j.can_apply===0?'Rows to fix':'Reviewed'):'Undone'}</a> · ${when(j.created_at,tz)}</li>`).join('')}</ul>`:empty('No CRM exports imported yet.'))}</div></div>`
}

/** Every difference is listed; matching per-donor rows are stored as a count so large move-ins stay readable. */
function totals(report:Row) {
 const {rows,donors}=report as {rows:Row[];donors:{total:number;matching:number}}
 return `${donors.total>0?`<p>${donors.matching} of ${donors.total} donors’ gift totals match one by one.${donors.matching<donors.total?' The donors that differ are listed below.':''}</p>`:''}${totals_(rows)}`
}
function totals_(rows:Row[]) {
 return `<div class="scroll"><table class="stack crm-totals"><thead><tr><th>Group</th><th>Records in your files</th><th>Records in Coffer</th><th>Amount in your files</th><th>Amount in Coffer</th><th>Check</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="lead">${e(r.scope==='restriction'?'Communication preferences':r.scope)} · ${e(r.key||'All gifts')}</td><td data-label="Records in your files">${r.sourceCount??'Not supplied'}</td><td data-label="Records in Coffer">${r.cofferCount}</td><td data-label="Amount in your files">${r.scope==='restriction'?'Not applicable':r.sourceCents===null?'Not supplied':money(r.sourceCents)}</td><td data-label="Amount in Coffer">${r.scope==='restriction'?'Not applicable':money(r.cofferCents)}</td><td>${chip(r.matches?'Match':'Difference',r.matches?'ok':'warn')}</td></tr>`).join('')}</tbody></table></div>`
}
const counts=(values:Row)=>`<ul class="list">${Object.entries(values).map(([k,v])=>`<li><strong>${v}</strong> ${e(({softCredits:'soft credits',solicitations:'constituents with solicitation restrictions',channelWithdrawals:'channel permission withdrawals',consents:'channel preferences',codeTags:'communication tags',householdsWithHead:'households with a source head',householdsWithoutHead:'households without a head'} as Record<string,string>)[k]||k)}</li>`).join('')}</ul>`
const location=(v:Row)=>`${e(v.file||'')}${v.sheet&&v.sheet!=='CSV'?` / ${e(v.sheet)}`:''}${v.row?` · row ${v.row}`:''}${v.column?` · ${e(v.column)}`:''}`
const records=(title:string,total:number,values:Row[],render:(v:Row)=>string)=>`<details class="card"><summary>${e(title)} · ${total}</summary>${values.length?`<ul class="list">${values.map(v=>`<li>${render(v)}<br><span class="muted">${location(v.location||v)}</span></li>`).join('')}</ul>${total>values.length?`<p class="muted">The first ${values.length} of ${total} are shown. The totals check covers all of them.</p>`:''}`:empty('None in these exports.')}</details>`
const plural=(n:number,one:string,many=one+'s')=>`${n} ${n===1?one:many}`
const SEVERITY:Record<string,string>={error:'Must fix',warning:'Check'}
const query=(id:string,q:Row)=>new URLSearchParams(Object.entries({id,...q}).filter(([,v])=>v!==undefined&&v!==''&&v!==null).map(([k,v])=>[k,String(v)])).toString()

/** Every row the review names: filter by kind of row, reason and file, page through, or download them all. */
function rowsToLook(id:string,list:Row) {
 const q=list.query, errors=list.codes.filter((c:Row)=>c.severity==='error').reduce((n:number,c:Row)=>n+c.n,0), warnings=list.codes.filter((c:Row)=>c.severity==='warning').reduce((n:number,c:Row)=>n+c.n,0)
 if(!errors&&!warnings)return box('Rows to look at',empty('No row needs fixing or checking.'),'rows')
 const reasons=list.codes.filter((c:Row)=>!q.show||c.severity===q.show)
 const filters=`<form method="get" action="/app/move-in/crm/review#rows" class="filters">${hidden('id',id)}
 ${select('Show','show',[['error',`Must fix (${errors})`],['warning',`Check (${warnings})`],['all',`All (${errors+warnings})`]],q.show||'all')}
 ${select('Reason','code',[['','Every reason'],...reasons.map((c:Row)=>[c.code,`${SEVERITY[c.severity]} · ${reasonName(c.code)} (${c.n})`] as [string,string])],q.code||'')}
 ${select('File','file',[['','Every file'],...list.files.map((f:Row)=>[f.file,`${f.file} (${f.n})`] as [string,string])],q.file||'')}<button class="secondary">Filter</button></form>`
 const shown=list.rows.length?`<ol class="list issues" start="${(list.page-1)*50+1}">${list.rows.map((d:Row)=>`<li>${chip(SEVERITY[d.severity],d.severity==='error'?'warn':'')} ${location(d)}<p>${e(d.message)}</p></li>`).join('')}</ol>`:empty('No rows match this filter.')
 const filter={show:q.show==='all'?'':q.show,code:q.code,file:q.file}
 const pager=list.pages>1?`<nav class="pager" aria-label="Pages of rows"><span>Page ${list.page} of ${list.pages} · ${list.total} rows</span>${list.page>1?`<a href="/app/move-in/crm/review?${query(id,{...filter,show:q.show,page:list.page-1})}#rows">Previous</a>`:''}${list.page<list.pages?`<a href="/app/move-in/crm/review?${query(id,{...filter,show:q.show,page:list.page+1})}#rows">Next</a>`:''}</nav>`:`<p class="muted">${plural(list.total,'row')}.</p>`
 return box('Rows to look at',`<p>${errors?`<strong>${plural(errors,'row')} must be fixed</strong> before moving in. `:''}${warnings?`${plural(warnings,'row')} only need a look: they move in as described.`:''}</p>
 <p><a href="/app/move-in/crm/issues.csv?${query(id,{show:'error'})}" download>Download the ${plural(errors,'row')} to fix (CSV)</a> · <a href="/app/move-in/crm/issues.csv?${query(id,{})}" download>Download every row named here (CSV)</a></p>
 <p class="muted">Each line gives the file, the row number in that file, the column and what to change. Fix them in your CRM or in the files, then upload the corrected files below: the review checks them again and names anything still to fix.</p>
 ${filters}${shown}${pager}`,'rows')
}
const REASONS:Record<string,string>={PLEDGE_OVERPAID:'Pledge payments exceed the promise',PLEDGE_ROUNDING:'Rounded pledge payments accepted',PLEDGE_PAYMENT:'Payment donor or fund differs from pledge',GOODS_VALUE:'Gift worth no more than its benefit',SHARED_EMAIL:'Email shared by two constituents',SHARED_EMAIL_HOUSEHOLD:'Email shared in one household',SOFT_DUPLICATE:'Soft credit repeated',SOFT_SELF:'Soft credit to the giver',PAYMENT_METHOD:'Payment method',MOVE_IN_MAPPING:'Conflicts with Coffer',ALREADY_MOVED_IN:'Already moved in',MATCHED_DONOR:'Matches a donor in Coffer',DUPLICATE_ID:'Repeated record ID',MISSING_REFERENCE:'Missing linked record',REQUIRED:'Missing value',DATE:'Unreadable date',AMOUNT:'Unreadable amount',EMAIL:'Unreadable email',DEDUCTIBILITY:'Deductible amount',FILE_READ:'File could not be read',ROW_TYPE:'Unrecognized row type',RECONCILIATION:'Totals do not reconcile',CONTROL_MISMATCH:'Totals report differs',DONOR_CONFLICT:'Conflicting constituent details',INSTALLMENT_TOTAL:'Installments differ from pledge',SOFT_AMOUNT:'Soft credit above gift'}
export const reasonName=(code:string)=>REASONS[code]||code.toLowerCase().replace(/_/g,' ')

/** The values Coffer would leave out, one line per column, with how many and where. */
function leftOutColumns(columns:Row[]) {
 if(!columns?.length)return empty('Every filled column has a place in Coffer.')
 return `<p>These columns have no place in Coffer. Their values stay in your files and are not moved in.</p><div class="scroll"><table class="stack"><thead><tr><th>Column</th><th>File</th><th>Values left out</th><th>For example</th></tr></thead><tbody>${columns.map(c=>`<tr><td class="lead">${e(c.column)}</td><td data-label="File">${e(c.file)}</td><td data-label="Values left out">${c.values}</td><td data-label="For example">“${e(String(c.example).slice(0,60))}” · row ${c.rows.join(', ')}</td></tr>`).join('')}</tbody></table></div>`
}

const upload=(source:string,title:string,report:Row)=>box(title,`<form method="post" action="/app/move-in/crm/preview" enctype="multipart/form-data">${hidden('source',source)}
 <label>Export files (CSV or XLSX)<input type="file" name="exports" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple required></label>
 ${restrictionMapping(report.solicitCodes)}${customMapping(source,report)}<label><input type="checkbox" name="noGoodsOrServices" value="yes"> All gifts without a recorded goods value were donations with no goods or services in return.</label>
 <p class="muted">Upload all the files again, not only the one you changed. Reading and checking 100,000 rows takes up to a minute.</p><button>Check the files again</button></form>`,'again')

export function crmReviewPage(job:Row,list:Row,today:string) {
 const r=job.report, blocked=!r.canApply, differences=r.reconciliation.rows.filter((x:Row)=>!x.matches).length, errors=list.codes.filter((c:Row)=>c.severity==='error').reduce((n:number,c:Row)=>n+c.n,0)
 const done=['completed','applying'].includes(job.state), s=r.sample
 return `<p>${e(name(job.source))} · ${plural(r.files.length,'file')} · ${r.files.reduce((n:number,f:Row)=>n+f.rows,0)} rows. Your donor records have not changed yet.</p>
 ${done?`<p class="notice">This exact file set was already ${job.state==='completed'?'moved in':'started'}. <a href="/app/move-in/crm/journal?id=${e(job.id)}">Open its journal</a>.</p>`:''}
 <p class="${blocked||differences?'alert':'notice'}" role="status">${blocked?`${plural(errors,'row')} must be fixed before these records can move in. Every one is listed under <a href="#rows">Rows to look at</a>, and you can download them as a spreadsheet.`:differences?`${differences} totals differ between your files and what Coffer would hold.`:'Nothing blocks this move-in. Gift counts and totals match.'} ${r.unmapped?`${r.unmapped} values in ${plural(r.leftOut.length,'column')} have no place in Coffer and would be left out (<a href="#left-out">which columns</a>).`:''}</p>
 <div class="grid wide"><div>${rowsToLook(job.id,list)}
 ${box('2. Check totals before switching',`<p>“Your files” counts every gift row exactly as exported. “Coffer” counts the gifts Coffer will hold after the move-in. Pledges and soft credits are promises and recognition, so they are not counted as money received. If you exported a totals report, its numbers are checked too.</p>${totals(r.reconciliation)}`)}
 ${box('Columns left out',leftOutColumns(r.leftOut),'left-out')}
 ${reviewedCustom(r)}${preferenceReview(r)}
 ${r.solicitCodes?box('Reviewed communication codes',`<ul>${Object.entries(r.solicitCodes).map(([code,rule])=>`<li>${e(code)}: ${e(codeMeaning(rule))}</li>`).join('')}</ul>`):''}
 ${records('Donors',r.counts.donors,s.donors,d=>`<strong>${e(d.name)}</strong> · ${e(d.externalId)}${d.householdName?` · ${e(d.householdName)}`:''}${d.contacts?.length?`<ul>${d.contacts.map((p:ParsedContact)=>`<li>${e(p.kind)} · ${e(p.type)}${p.primary?' · primary':''}: ${e(p.kind==='address'?Object.values(JSON.parse(p.value)).filter(Boolean).join(', '):p.value)}${p.startsOn?` · ${e(p.startsOn)} through ${e(p.endsOn)}`:''}</li>`).join('')}</ul>`:''}`)}
 ${records('Households',r.counts.households,s.households,h=>`${e(h.name)} · ${e(h.externalId.startsWith('members:')?`linked as spouses or at one address`:h.externalId)}`)}
 ${records('Gifts',r.counts.gifts,s.gifts,g=>`${e(g.externalId)} · donor ${e(g.donorExternalId)} · ${longDay(g.receivedOn)} · ${money(g.amountCents)} · ${e(g.fund)}${g.campaign?` · ${e(g.campaign)}`:''}`)}
 ${records('Relationships',r.counts.relationships,s.relationships,x=>`${e(x.donorExternalId)} → ${e(x.relatedDonorExternalId)} · ${e(x.type)}`)}
 ${records('Soft credits',r.counts.softCredits,s.softCredits,x=>`${money(x.amountCents)} · donor ${e(x.donorExternalId)} · original gift ${e(x.giftExternalId)}`)}
 ${records('Pledges',r.counts.pledges,s.pledges,v=>`${e(v.externalId)} · donor ${e(v.donorExternalId)} · ${money(v.amountCents)} · ${e(v.fund)}${v.note?`<p>${e(v.note)}</p>`:''}`)}
 ${records('Installments',r.counts.installments,s.installments,i=>`${e(i.pledgeExternalId)} · ${longDay(i.dueOn)} · ${money(i.amountCents)}`)}
 ${records('Notes and conversations',r.counts.notes,s.notes,n=>`Donor ${e(n.donorExternalId)} · ${e(n.type)} · ${e(n.text)}`)}
 </div><div>${box('What moves in',`${counts(r.counts)}${r.parts>1?`<p>This goes in ${r.parts} parts of about 800 records. You can leave and come back between parts.</p>`:''}`)}
 ${box('3. Move it in',blocked?`<p>Fix the ${plural(errors,'row')} marked “Must fix”, then upload the corrected files below.</p>`:done?'<p>Open the journal above.</p>':`<form method="post" action="/app/move-in/crm/apply">${hidden('id',job.id)}${hidden('fingerprint',job.fingerprint)}
 <fieldset><legend>Were these gifts already thanked in ${e(name(job.source))}?</legend><label><input type="radio" name="acknowledged" value="yes" checked> Yes, gifts before this date were already thanked. Coffer will not list them as letters due.</label>${field('Thanked before','acknowledgedBefore','date',today,'required')}<label><input type="radio" name="acknowledged" value="no"> No, list every imported gift as waiting for a letter.</label></fieldset>
 ${area('Why the differences or left-out values are fine','acceptedReason','',r.needsAcceptance?'required maxlength="2000"':'maxlength="2000"')}
 <label><input type="checkbox" name="confirm" value="yes" required> I checked the totals and want to move these records in.</label><p>Moving the same files in again never makes copies.</p><button>Move these records in</button></form>`)}
 ${upload(job.source,blocked?'Upload the corrected files':'Check other files',r)}
 <p><a href="/app/move-in/crm">Start over</a> · <a href="${sourceGuide}">CRM move-in guide</a></p></div></div>`
}

export function crmJournalPage(result:Row,tz:string) {
 const j=result.job,r=j.report,check=j.check_report
 const state=j.state==='completed'?chip('Moved in','ok'):j.state==='applying'?chip(`Part ${j.applied_parts} of ${j.parts}`,'info'):j.state==='reviewed'?chip('Reviewed, not moved in','warn'):chip('Undone','')
 const progress=j.state==='applying'?box('Moving in',`<p><progress max="${j.parts}" value="${j.applied_parts}">${j.applied_parts} of ${j.parts}</progress></p><p>${j.applied_parts} of ${j.parts} parts are in Coffer. Each press of Continue moves in as many parts as fit in about 20 seconds. It is safe to leave and come back: nothing is applied twice.</p><form method="post" action="/app/move-in/crm/continue">${hidden('id',j.id)}<button>Continue</button></form>`):''
 const checked=check?box('Totals check',`<p>${check.matches?chip('All totals match','ok'):chip('Totals differ','warn')} Checked ${when(j.checked_at,tz)}: the gifts now in Coffer from this move-in, against your files.</p>${check.donors?totals(check):totals_(check.rows)}<form method="post" action="/app/move-in/crm/check">${hidden('id',j.id)}<button class="secondary">Check totals again</button></form>`):''
 return `<p>${state} ${e(name(j.source))} · ${when(j.created_at,tz)} · ${e(j.created_by)}</p>
 ${j.state==='reviewed'?`<p><a href="/app/move-in/crm/review?id=${e(j.id)}">Open the review</a></p>`:''}<p>${j.state==='completed'?'Everything in this move-in is in Coffer. Moving the same files in again changes nothing.':j.state==='applying'?'This move-in is under way.':j.state==='undone'?'Everything this move-in added was removed. Records that already existed were kept.':'Nothing from this review has been moved in yet.'}${j.acknowledged_before?` Gifts before ${longDay(j.acknowledged_before)} count as already thanked.`:''}</p>
 <div class="grid wide"><div>${progress}${checked}${!check&&r.reconciliation?.rows?box('Totals in your files',totals(r.reconciliation)):''}${r.counts?box('Imported history',counts(r.counts)):''}
 ${r.files?box('Source files',`<ul class="list">${r.files.map((f:Row)=>`<li>${e(f.name)} · ${f.rows} rows</li>`).join('')}</ul><p class="muted">Coffer does not keep the uploaded files. Keep your exports somewhere safe.</p>`):''}</div><div>
 ${j.accepted_reason?box('Accepted differences',`<p>${e(j.accepted_reason)}</p>`):''}
 ${['completed','applying'].includes(j.state)?box('Undo as one step',j.redacted?'<p>A donor was erased. This import can no longer be undone.</p>':`<form method="post" action="/app/move-in/crm/undo">${hidden('id',j.id)}<p>Undo removes every record this move-in added. If anyone has edited or used one since (a gift, a letter, a call), nothing is undone, so work done since stays safe.</p><button class="secondary">Undo this move-in</button></form>`):''}
 <p><a href="/app/donors">Look at donor histories</a> · <a href="/app/move-in/crm">Move in more exports</a></p></div></div>`
}

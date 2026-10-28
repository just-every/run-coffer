import { box, e, field, hidden, select } from './common'
import type { Row } from '../db'
import type { CustomReview } from '../move-in/custom-review-types'

export function customCaptureForm(job:Row){
 if(job.state!=='completed'||job.redacted||!['bloomerang','lgl','re-nxt','neon','spreadsheet'].includes(job.source))return ''
 if(job.report.customReview)return box('Source custom fields',`<p><a href="/app/move-in/crm/custom-review?id=${e(job.id)}">Review source custom fields</a></p>`)
 if(job.source==='spreadsheet')return ''
 return box('Bring source custom fields',`<details><summary>Read custom field definitions and values</summary><form method="post" action="/app/move-in/crm/custom-capture">${hidden('id',job.id)}${field(job.source==='re-nxt'?'Source access token':'Source API key','apiKey','password','','required autocomplete="off"')}${job.source==='neon'?field('Neon organization ID','organizationId','text','','required autocomplete="off"'):''}${job.source==='re-nxt'?field('Blackbaud subscription key','subscriptionKey','password','','required autocomplete="off"')+select('Identifiers in these exports','idType',[['','Choose the exported identifier type'],['system','Native system record IDs'],['lookup','Lookup IDs']],'','required'):''}<p>The key is used for this read only. Review target fields and waiting values before applying.</p><button>Read source custom fields</button></form></details>`)
}
export function customImportReviewPage(job:Row,fields:Row[]){
 const r=job.report.customReview as CustomReview|undefined
 if(!r)return '<p>Read the source definitions from the import journal first.</p>'
 const frozen=Boolean(r.applied),forms=r.definitions.map(d=>{
  const m=r.mappings.find(m=>m.id===d.id)!,f=m.field,eligible=fields.filter(f=>f.kind===d.kind&&f.type===d.type&&f.entry===d.entry),count=r.counts.find(c=>c.id===d.id)!
  return `<fieldset>${hidden('fieldId',d.id)}<legend>${e(d.name)} · ${e(d.kind)}</legend><p>${e(d.type)} · ${e(d.entry)}${d.choices.length?' · '+e(d.choices.join(', ')):''}</p><p>${count.source} source values · ${count.carried} carried or ready · ${count.waiting} waiting · ${count.skipped} explicitly skipped</p>
  ${select('Destination','mappingAction',[['field','Custom field'],...(d.type==='text'&&d.entry!=='free-form'?[['tags','Tags on this record’s constituent'] as [string,string]]:[]),['skip','Skip this source field']],m.action,frozen?'disabled':'')}
  ${d.kind==='note'?'<p>Only ordinary, non-confidential notes can supply constituent tags.</p>':''}
  ${f?.choices?.length?`<p>Target choices: ${e(f.choices.join(', '))}</p>`:''}
  ${select('Existing target field','existingField',[['','Create a field'],...eligible.map(f=>[f.key,f.label] as [string,string])],f?.version?f.key:'',frozen?'disabled':'')}
  ${field('Target field key','targetKey','text',f?.key??'',frozen?'readonly':'pattern="[a-z][a-z0-9_]*" maxlength="80"')}${field('Target field name','targetLabel','text',f?.label??d.name,frozen?'readonly':'maxlength="100"')}
  </fieldset>`
 }).join('')
 const waiting=r.values.filter(v=>v.state==='waiting'),resolutions=waiting.map(v=>{
  const d=r.definitions.find(d=>d.id===v.fieldId)!
  return `<fieldset><legend>${e(d.name)} · source record ${e(v.recordId)}</legend>${hidden('valueId',v.id)}<p>Source value: <strong>${e(JSON.stringify(v.original))}</strong></p><p role="status">${e(v.reason)}</p>${select('Resolve value','resolutionAction',[['','Keep waiting'],['fix','Fix this value'],['map','Map to an allowed value'],['skip','Explicitly skip this value']])}${field('Replacement value','replacementValue','text','','maxlength="2000"')}<p>Pick-many replacements use a JSON list. A blank answer keeps the source value waiting.</p></fieldset>`
 }).join('')
 return `<p><a href="/app/move-in/crm/journal?id=${e(job.id)}">Back to import journal</a></p>${box('Source custom field review',`<form method="post" action="/app/move-in/crm/custom-review">${hidden('id',job.id)}${hidden('version',r.version)}${forms}${waiting.length?`<h2>Values waiting for review</h2>${resolutions}`:'<p>No values are waiting.</p>'}${!frozen||waiting.length?'<button>Review these choices</button>':''}</form>`)}
 ${box('Carry reviewed values',`<p>Every source value is counted as carried, waiting or explicitly skipped. Waiting values remain here until you resolve them.</p><form method="post" action="/app/move-in/crm/custom-apply">${hidden('id',job.id)}${hidden('version',r.version)}<label><input type="checkbox" name="confirm" value="yes" required> I reviewed the field mappings and waiting values.</label><button>Carry valid custom values</button></form>`)}
 ${box('Source reconciliation',`<ul class="list">${r.counts.map(c=>`<li><strong>${e(c.name)}</strong> · ${c.defined} target field · ${c.source} source values = ${c.carried} carried or ready + ${c.waiting} waiting + ${c.skipped} skipped</li>`).join('')}</ul>`)}
 `
}

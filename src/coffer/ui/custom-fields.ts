import { manager } from '../auth'
import { customFields } from '../custom-fields'
import { all, type Context, type Row } from '../db'
import { area, box, e, field, form, money, select } from './common'

const entryValue=(f:Row,v:any)=>{if(v==null)return '';if(f.type!=='currency')return String(v);const cents=BigInt(String(v)),absolute=cents<0n?-cents:cents;return `${cents<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`}
export async function customDefinitionsPanel(c:Context){
 if(!manager(c.actor))return ''
 const definitions=await customFields(c)
 const choices=(f:Row)=>f.entry==='free-form'?'':area('Pick-list choices (one per line; keep existing choices)','choices',JSON.parse(f.choices).map((v:any)=>entryValue(f,v)).join('\n'),'rows="4"')
 const existing=definitions.map(f=>`<li><details><summary>${e(f.label)} · ${e(f.kind)} · ${e(f.type)} · ${e(f.entry)}</summary><p>Template field <code>{{custom.${e(f.key)}}}</code> · version ${f.version}</p>${form('custom.define',field('Field label','label','text',f.label,'required maxlength="100"')+choices(f),'Save field',{key:f.key,kind:f.kind,type:f.type,entry:f.entry,version:f.version})}</details></li>`).join('')
 const add=form('custom.define',field('Field key (used in templates)','key','text','','required pattern="[a-z][a-z0-9_]*" maxlength="80"')+field('Field label','label','text','','required maxlength="100"')+select('Record kind','kind',[['constituent','Constituent'],['gift','Gift'],['interaction','Interaction']])+select('Value type','type',[['text','Text'],['number','Number'],['currency','Currency (USD)'],['date','Date'],['year','Year'],['checkbox','Checkbox']])+select('Entry method','entry',[['free-form','Free-form'],['pick-one','Pick one'],['pick-many','Pick many']])+area('Pick-list choices (one per line; leave blank for free-form)','choices','','rows="4"'),'Add field')
 return box('Custom fields',`<p>The owner and admins define and fill these fields. Keys, record kinds and types stay fixed; changing a label keeps values and prepared documents. Add pick-list choices while keeping existing ones. Only fields deliberately used in a reviewed template enter its wording; no new field is automatically added to an external provider profile.</p>${existing?`<ul class="list">${existing}</ul>`:'<p>No custom fields defined.</p>'}<details><summary>Add a custom field</summary>${add}</details>`,'custom-field-definitions')
}
export async function customRecordPanel(c:Context,donor:Row,gifts:Row[],interactions:Row[],url?:URL){
 if(!manager(c.actor))return ''
 const definitions=await customFields(c)
 const records=[{id:donor.id,kind:'constituent',label:donor.name},...gifts.filter(g=>(g.kind==='gift'||g.kind==='in_kind')&&g.source!=='stripe-adjustment').map(g=>({id:g.id,kind:'gift',label:(g.kind==='in_kind'?'Property':'Gift')+' · '+g.received_on+' · '+(g.property_description??money(g.amount_cents))})),...interactions.map(i=>({id:i.id,kind:'interaction',label:i.kind+' · '+i.occurred_on}))]
 const record=records.find(r=>r.id===url?.searchParams.get('customRecord'))??records[0]
 const values=await all(c,'SELECT * FROM cf_custom_values WHERE record_id=? AND donor_id=?',record.id,donor.id)
 const fields=definitions.filter(f=>f.kind===record.kind).map(f=>{
  const stored=values.find(v=>v.field_key===f.key),value=stored?JSON.parse(stored.value):null,choices:any[]=JSON.parse(f.choices),version=stored?.version??0
  const input=f.entry==='pick-many'?`<input type="hidden" name="customMany" value="yes"><label>Values<select name="customValues" multiple size="${Math.min(6,Math.max(2,choices.length))}">${choices.map(v=>`<option value="${e(entryValue(f,v))}"${Array.isArray(value)&&value.includes(v)?' selected':''}>${e(entryValue(f,v))}</option>`).join('')}</select></label><p class="muted">Select one or more choices.</p>`:f.entry==='pick-one'?select('Value','value',[['','Choose a value'],...choices.map(v=>[entryValue(f,v),entryValue(f,v)] as [string,string])],entryValue(f,value),'required'):f.type==='checkbox'?select('Value','value',[['true','Yes'],['false','No']],entryValue(f,value)||'false'):field('Value','value',f.type==='date'?'date':f.type==='number'||f.type==='currency'||f.type==='year'?'number':'text',entryValue(f,value),`required${f.type==='currency'?' step="0.01"':f.type==='number'?' step="any"':f.type==='year'?' min="1000" max="9999"':''}`)
  const hidden={key:f.key,recordId:record.id,version,returnDonorId:donor.id}
  return `<li><details><summary>${e(f.label)}${value==null?' · Not set':''}</summary><p><code>{{custom.${e(f.key)}}}</code>${stored?` · last source ${e(stored.source)}`:''}</p>${form('custom.set',input+field('Source','source','text','staff','required maxlength="100"'),'Save value',hidden)}${value!=null?form('custom.clear',field('Source for clearing','source','text','staff','required maxlength="100"'),'Clear value',hidden):''}</details></li>`
 }).join('')
 return box('Custom record fields',`<form method="get" action="/app/donors/${e(donor.id)}#custom-fields">${select('Record','customRecord',records.map(r=>[r.id,r.label] as [string,string]),record.id)}<button>Open custom fields</button></form><p>${e(record.label)}</p>${fields?`<ul class="list">${fields}</ul>`:'<p>No fields defined for this record kind.</p>'}<p><a href="/app/settings#custom-field-definitions">Define or label fields</a>. Clearing a value keeps its history and lets a template’s literal default apply. Prepared wording stays frozen.</p>`,'custom-fields')
}

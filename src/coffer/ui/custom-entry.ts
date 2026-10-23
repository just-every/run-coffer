import { centsDecimal } from '../money'
import { customFields } from '../custom-fields'
import { manager } from '../auth'
import { type Context } from '../db'
import { e, field, select } from './common'

/** Optional native entry controls; blank means no value, never a fabricated default. */
export async function customEntryFields(c:Context,kind:string,values:Record<string,any>={}){
 if(!manager(c.actor))return ''
 const fields=(await customFields(c)).filter(f=>f.kind===kind)
 if(!fields.length)return ''
 return `<details><summary>Custom ${e(kind)} fields</summary>${fields.map(f=>{
  const name='custom.'+f.key,value=values[f.key]??'',choices=JSON.parse(f.choices)
  if(f.entry==='pick-many')return `<input type="hidden" name="many.${e(name)}" value="yes"><label>${e(f.label)}<select name="${e(name)}" multiple>${choices.map((choice:string)=>`<option value="${e(f.type==='currency'?centsDecimal(String(choice)):choice)}"${Array.isArray(value)&&value.includes(choice)?' selected':''}>${e(f.type==='currency'?centsDecimal(String(choice)):choice)}</option>`).join('')}</select></label>`
  if(f.entry==='pick-one')return select(f.label,name,[['','Not set'],...choices.map((choice:string)=>{const v=f.type==='currency'?centsDecimal(String(choice)):choice;return [v,v] as [string,string]})],String(value))
  if(f.type==='checkbox')return select(f.label,name,[['','Not set'],['true','Yes'],['false','No']],String(value))
  return field(f.label,name,f.type==='date'?'date':f.type==='text'?'text':'number',value,f.type==='currency'?'step="0.01"':f.type==='number'?'step="any"':f.type==='year'?'min="1000" max="9999"':'')
 }).join('')}</details>`
}

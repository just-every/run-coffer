import { fail } from '../db'
import { reviewedCustomMappings } from './custom-fields'
import { day } from './source-rows'
import type { CustomImportMapping, ImportedCustomValue, ParsedImport } from './types'

type Row=Record<string,any>
const error=(message:string):never=>fail('SKY_CUSTOM',message+' Nothing was applied.',400)

/** Source definitions are an explicitly attested database-view supplement, not
 * an undocumented API response. Every supplied category needs a typed mapping,
 * including categories with no values in the selected source records. */
export function blackbaudCustom(review:Row,fallback:unknown) {
 const raw=review.customFields??fallback??[],validation={customFields:[],diagnostics:[]} as unknown as ParsedImport
 reviewedCustomMappings({source:'re-nxt',files:[],customFields:raw},validation)
 if(validation.diagnostics.length)error(validation.diagnostics[0].message)
 const mappings=validation.customFields!,inventory=review.definitions
 const definitions:CustomImportMapping[]=[]
 if(inventory!==undefined) {
  if(!Array.isArray(inventory)||inventory.length>100)error('Supply at most 100 source custom definitions.')
  const seen=new Set<string>()
  for(const d of inventory as Row[]) {
   if(!d||!['constituent','gift','action'].includes(d.kind)||typeof d.id!=='string'||!d.id||typeof d.category!=='string'||!d.category||!Array.isArray(d.choices)||Object.keys(d).some(k=>!['id','kind','category','type','entry','choices'].includes(k)))error('Review each source definition identity, kind, category, type, entry method and complete code table.')
   const identity=JSON.stringify([d.kind,d.category])
   if(seen.has(identity))error('Source definition categories must be unambiguous within their record kind.')
   seen.add(identity)
   const matches=mappings.filter(m=>m.column===d.category&&(d.kind==='action'?['interaction','note'].includes(m.kind):m.kind===d.kind))
   if(!matches.length)error('Map every source definition, including empty categories, before applying.')
   const check={customFields:[],diagnostics:[]} as unknown as ParsedImport
   reviewedCustomMappings({source:'re-nxt',files:[],customFields:matches.map(m=>({...m,type:d.type,entry:d.entry,choices:d.choices,version:0}))},check)
   if(check.diagnostics.length)error(check.diagnostics[0].message)
   for(const m of matches) {
    const source=check.customFields!.find(f=>f.kind===m.kind)!
    if(m.type!==source.type||m.entry!==source.entry||JSON.stringify(m.choices)!==JSON.stringify(source.choices))error('A native mapping must retain the source type, entry method and complete code table.')
    if(definitions.some(f=>f.key===m.key))error('Use a distinct native field key for each source definition and action record kind.')
    definitions.push(m)
   }
  }
  if(mappings.some(m=>!definitions.includes(m)))error('Every mapped category must occur in the attested definition inventory.')
 }
 const used=new Set<CustomImportMapping>()
 const provenance=new Map<string,Map<string,Row[]>>()
 const values=(records:Row[],kind:string,row:Row,externalId:string)=>{
  const grouped=new Map<string,Row[]>()
  for(const v of records) {
   if(!v||typeof v.category!=='string'||!Object.hasOwn(v,'value'))error('A source custom value needs its category and value.')
   for(const key of ['start','end'])if(v[key]&&(typeof v[key]!=='string'||!day(v[key].slice(0,10))))error('Review the source custom-value dates.')
   if(v.start&&v.end&&v.start>v.end)error('A source custom-value period cannot end before it starts.')
   if(v.comment!==undefined&&typeof v.comment!=='string')error('A source custom-value comment must remain text.')
   grouped.set(v.category,[...(grouped.get(v.category)??[]),v])
  }
  const facts=new Map<string,Row[]>()
  for(const [category,items] of grouped) {
   const m=mappings.find(m=>m.kind===kind&&m.column===category)??error('Every source category needs one unambiguous reviewed custom mapping.')
   if(Object.hasOwn(row,category))error('Every source category needs one unambiguous reviewed custom mapping.')
   used.add(m)
   const scalar=(v:any):string|number|boolean=>{
    if(m.type==='date'&&v&&typeof v==='object'&&Number.isInteger(v.y)&&Number.isInteger(v.m)&&Number.isInteger(v.d))return `${v.y}-${String(v.m).padStart(2,'0')}-${String(v.d).padStart(2,'0')}`
    if(!['string','number','boolean'].includes(typeof v))error('Structured custom values have no lossless native mapping.')
    return v
   }
   if(items.length>1&&m.entry!=='pick-many')error('Repeated scalar custom values need separate source review.')
   row[category]=m.entry==='pick-many'?JSON.stringify(items.flatMap(v=>Array.isArray(v.value)?v.value.map(scalar):[scalar(v.value)])):String(scalar(items[0].value))
   facts.set(m.key,items.map(v=>({id:v.id,category,start:v.start??null,end:v.end??null,comment:v.comment??null})))
  }
  provenance.set(JSON.stringify([kind,externalId]),facts)
 }
 const attach=(kind:string,externalId:string,values:ImportedCustomValue[]|undefined)=>{
  const facts=provenance.get(JSON.stringify([kind,externalId]))
  for(const v of values??[])v.sourceMetadata=facts?.get(v.mapping.key)
 }
 return {mappings,definitions,values,attach,used}
}

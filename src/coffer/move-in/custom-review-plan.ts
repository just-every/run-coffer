import { customValue } from '../custom-fields'
import { fail, sha256, type Row } from '../db'
import type { CustomImportMapping } from './types'
import type { SourceDefinition } from './source-definitions'
import type { CustomReview, FieldMapping, ValueResolution } from './custom-review-types'

const targetChoices=(d:SourceDefinition):string[]=>d.choices.map(value=>JSON.parse(customValue({...d,label:d.name,entry:'free-form',choices:'[]'},value)))

export function defaultMappings(source:string,definitions:SourceDefinition[],saved:FieldMapping[]=[],fields:Row[]=[]):FieldMapping[] {
 return definitions.map(d=>{
  const previous=saved.find(m=>m.id===d.id),held=previous?.field&&fields.find(f=>f.key===previous.field!.key)
  if(previous)return {...previous,...(held?{field:{...previous.field!,label:held.label,version:held.version}}:{})}
  return {id:d.id,action:'field',field:{source,column:d.name,key:'import_'+source.replace(/[^a-z0-9_]/g,'_')+'_'+d.id.replace(/[^a-z0-9_]/gi,'_').toLowerCase(),label:d.name,kind:d.kind,type:d.type,entry:d.entry,choices:targetChoices(d),version:0} as CustomImportMapping}
 })
}

/** Validation produces a visible waiting row, never a substituted or missing value. */
export async function buildCustomReview(definitions:SourceDefinition[],mappings:FieldMapping[],resolutions:ValueResolution[],version:number):Promise<CustomReview> {
 if(!Array.isArray(mappings)||mappings.length!==definitions.length||new Set(mappings.map(m=>m.id)).size!==mappings.length)fail('CUSTOM_MAPPING','Review each source definition once.',400)
 if(!Array.isArray(resolutions)||resolutions.length>10000||new Set(resolutions.map(r=>r.id)).size!==resolutions.length)fail('CUSTOM_MAPPING','Review each source value once.',400)
 const values:CustomReview['values']=[],counts:CustomReview['counts']=[],keys=new Set<string>()
 for(const d of definitions){
  const m=mappings.find(m=>m.id===d.id)
  if(!m||!['field','tags','skip'].includes(m.action))fail('CUSTOM_MAPPING','Choose a field, tags or skip for every definition.',400)
  if(m.action==='field'){
   const f=m.field
   if(!f||!/^[a-z][a-z0-9_]{0,79}$/.test(f.key)||!f.label?.trim()||f.label.length>100||f.kind!==d.kind||f.type!==d.type||f.entry!==d.entry||JSON.stringify(f.choices)!==JSON.stringify(targetChoices(d))||keys.has(f.key))fail('CUSTOM_MAPPING','Keep the source kind, type, entry method and choices; use a distinct target field.',400)
   keys.add(f.key)
  }
  if(m.action==='tags'&&(d.kind!=='constituent'||d.type!=='text'||d.entry==='free-form'))fail('CUSTOM_MAPPING','Only constituent text pick lists map to constituent tags.',400)
  const count={id:d.id,name:d.name,defined:m.action==='field'?1:0,source:d.values.length,carried:0,waiting:0,skipped:0}
  for(const source of d.values){
   const id=await sha256(JSON.stringify([d.id,source.recordId])),resolution=resolutions.find(r=>r.id===id)
   if(resolution&&!['fix','map','skip'].includes(resolution.action))fail('CUSTOM_MAPPING','Choose fix, map or skip.',400)
   const row:CustomReview['values'][number]={id,fieldId:d.id,recordId:source.recordId,original:source.value,state:'ready'}
   if(m.action==='skip'||resolution?.action==='skip'){row.state='skipped';count.skipped++}
   else try {
    if(source.reason&&!resolution)throw Error(source.reason)
    const input=resolution?resolution.value:source.value
    row.value=customValue(m.action==='field'?{...m.field,choices:JSON.stringify(m.field!.choices)}:{...d,label:d.name,choices:JSON.stringify(targetChoices(d))},input)
    count.carried++
   }catch(e){row.state='waiting';row.reason=e instanceof Error?e.message:String(e);count.waiting++}
   values.push(row)
  }
  counts.push(count)
 }
 if(resolutions.some(r=>!values.some(v=>v.id===r.id)))fail('CUSTOM_MAPPING','A resolution no longer matches this source capture.',409)
 return {version,definitions,mappings,resolutions,values,counts}
}

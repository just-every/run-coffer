import { fail } from '../db'
import type { CustomImportKind, CustomImportMapping } from './types'

/** Convert documented Neon definitions without guessing a type from its value. */
export function neonFields(definitions:Record<string,any>[]) {
 const fields=new Map<string,{definition:Record<string,any>;mapping:CustomImportMapping}>()
 const kinds:Record<string,CustomImportKind>={Account:'constituent',Donation:'gift',Activity:'interaction'}
 const types:Record<string,CustomImportMapping['type']>={Text:'text',Email:'text',Phone:'text',Area_Code:'text',Name:'text',Whole_Number:'number',Integer:'number',Decimal:'number',Float:'number',Currency:'currency',Amount:'currency',Date:'date',Boolean:'checkbox'}
 for(const f of definitions){
  const kind=kinds[f.component],type=types[f.dataType]
  if(!f.id||!f.name||!kind||!type||!['Dropdown','Radio','Checkbox','OneLineText','MultiLineText'].includes(f.displayType))fail('NEON_UNSUPPORTED','A Neon custom definition has no safe native type. Review it separately; no definition was dropped.',400)
  const choices=f.optionValues??[],entry=choices.length?(f.displayType==='Checkbox'?'pick-many':'pick-one'):'free-form'
  if(!Array.isArray(choices)||entry==='free-form'&&['Dropdown','Radio'].includes(f.displayType))fail('NEON_SCHEMA','A Neon pick list needs its complete choices.',502)
  const key=(f.component==='Account'?'neon_':'neon_'+f.component.toLowerCase()+'_')+String(f.id).replace(/[^a-zA-Z0-9_]/g,'_').toLowerCase()
  const identity=f.component+':'+f.id
  if(fields.has(identity)||[...fields.values()].some(v=>v.mapping.key===key))fail('NEON_SCHEMA','Neon custom definition IDs are ambiguous.',502)
  fields.set(identity,{definition:f,mapping:{source:'neon',column:f.component==='Account'?'Neon field '+f.id:'Neon '+f.component+' field '+f.id,key,label:f.name,kind,type,entry,choices:choices.map((c:any)=>c.name),version:0}})
 }
 return {
  mappings:[...fields.values()].map(f=>f.mapping),
  values(component:string,values:Record<string,any>[]=[]){
   if(!Array.isArray(values))fail('NEON_SCHEMA','Neon custom values must be a list.',502)
   const result:Record<string,string>={},seen=new Set<string>()
   for(const value of values){
    const field=fields.get(component+':'+value.id)
    if(!field||seen.has(value.id))fail('NEON_SCHEMA','A Neon custom value has a missing or repeated definition.',502)
    seen.add(value.id)
    const {definition,mapping}=field
    if(mapping.entry==='free-form'){
     if(value.optionValues?.length)fail('NEON_SCHEMA','A free-form Neon value cannot contain pick-list choices.',502)
     result[mapping.column]=value.value??''
    }else{
     if(!Array.isArray(value.optionValues)||mapping.entry==='pick-one'&&value.optionValues.length>1)fail('NEON_SCHEMA','A Neon value does not match its entry method.',502)
     const selected=value.optionValues.map((option:any)=>{
      const choice=definition.optionValues.find((c:any)=>String(c.id)===String(option.id))
      if(!choice||option.name!==undefined&&option.name!==choice.name)fail('NEON_SCHEMA','A Neon choice does not match its source definition.',502)
      return choice.name
     })
     result[mapping.column]=!selected.length?'':mapping.entry==='pick-many'?JSON.stringify(selected):selected[0]
    }
   }
   // Definitions with no populated values still belong to the reviewed schema.
   for(const {definition,mapping} of fields.values())if(definition.component===component&&!(mapping.column in result))result[mapping.column]=''
   return result
  },
 }
}

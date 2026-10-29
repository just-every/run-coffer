import { customValue } from '../custom-fields'
import { fail } from '../db'
import type { CustomImportMapping, SourceDefinition } from './types'

type Row=Record<string,any>
type Reader={read:(path:string)=>Promise<any>}
const error=(message:string):never=>fail('SKY_CUSTOM_FIELDS',message+' Nothing was applied.',400)
const nativeTypes:Record<string,string>={Text:'text',Number:'number',Currency:'currency',Date:'date',Boolean:'checkbox',CodeTableEntry:'text'}

/** Category catalogs are complete, unpaged collections in the published SKY
 * schemas. They have names (or string values), not fabricated record IDs. */
async function catalog(reader:Reader,path:string):Promise<any[]> {
 const result=await reader.read(path)
 if(!result||!Array.isArray(result.value)||!Number.isSafeInteger(result.count)||result.count!==result.value.length||result.count>1000||result.next_link)error('The source custom-field catalog is incomplete or exceeds this review.')
 return result.value
}

export async function blackbaudFields(reader:Reader,mappings:CustomImportMapping[]) {
 const definitions:SourceDefinition[]=[],byScope=new Map<string,Row>()
 for(const [scope,path] of [['constituent','/constituent/v1/constituents/customfields/categories/details'],['gift','/gift/v1/gifts/customfields/categories'],['action','/constituent/v1/actions/customfields/categories/details']]) {
  const categories=await catalog(reader,path),seen=new Set<string>()
  for(const category of categories) {
   if(!category||typeof category.name!=='string'||!category.name.trim()||seen.has(category.name)||!nativeTypes[category.type]||category.one_per_record!==undefined&&typeof category.one_per_record!=='boolean')error('A source category has an unsupported type, duplicate name or incomplete definition.')
   seen.add(category.name)
   const choices=category.type==='CodeTableEntry'?await catalog(reader,path.replace(/(?:\/details)?$/,'').replace(/\/categories$/,'/categories/values')+'?category_name='+encodeURIComponent(category.name)):[]
   if(choices.some(v=>typeof v!=='string'||!v.trim())||new Set(choices).size!==choices.length)error('The source code table has invalid or repeated choices.')
   const kinds=scope==='action'?['interaction','note']:scope==='gift'?['gift','pledge']:['constituent'],selected=mappings.filter(m=>kinds.includes(m.kind)&&m.column===category.name)
   if(!selected.length)error(`Map the complete ${scope} definition “${category.name}”, including unused fields.`)
   for(const mapping of selected) {
    if(mapping.type!==nativeTypes[category.type]||(category.type==='CodeTableEntry'?!['pick-one','pick-many'].includes(mapping.entry):mapping.entry!=='free-form'))error(`The mapping for “${category.name}” must retain its source type and entry method.`)
    if(category.one_per_record===true&&mapping.entry==='pick-many')error(`The source field “${category.name}” permits one value per record.`)
    if(category.type==='CodeTableEntry'&&(mapping.choices.length!==choices.length||choices.some(v=>!mapping.choices.includes(v))))error(`The mapping for “${category.name}” must retain every source code-table choice.`)
    definitions.push({values:0,scope:scope as SourceDefinition['scope'],name:category.name,sourceType:category.type,onePerRecord:category.one_per_record??null,choices,mapping})
   }
   byScope.set(scope+':'+category.name,{...category,choices})
  }
 }
 for(const mapping of mappings)if(!definitions.some(d=>d.mapping===mapping))error(`The mapped field “${mapping.column}” has no matching source category.`)
 const values=(rows:Row[],scope:string,kind:CustomImportMapping['kind'],target:Row)=>{
  const groups=new Map<string,Row[]>()
  for(const value of rows){
   if(!value||typeof value.category!=='string'||!byScope.has(scope+':'+value.category)||value.comment||value.date||value.end||value.start)error('Every custom value must resolve to a read source definition; dated or annotated values need separate migration.')
   const definition=byScope.get(scope+':'+value.category)!
   if(value.type&&value.type!==definition.type)error('A custom value disagrees with its source definition.')
   groups.set(value.category,[...(groups.get(value.category)??[]),value])
  }
  for(const [name,rows] of groups){
   if(new Set(rows.map(r=>JSON.stringify(r.value))).size!==rows.length)error('Repeated source custom selections need review; observations will not be collapsed.')
   const definition=byScope.get(scope+':'+name)!,mapping=mappings.find(m=>m.kind===kind&&m.column===name)??error('Review a mapping for every source custom value.')
   if(!mapping||Object.hasOwn(target,name)||rows.length>1&&(mapping.entry!=='pick-many'||definition.one_per_record===true))error('Every source value needs an unambiguous mapping that preserves its multiplicity.')
   const scalar=(v:any)=>{
    if(definition.type==='Date'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:Z)?)?$/.test(v))error('A source custom date must be a complete calendar date.');v=v.slice(0,10)}
    if(definition.type==='Boolean'&&typeof v!=='boolean'||['Number','Currency'].includes(definition.type)&&typeof v!=='number'||['Text','CodeTableEntry'].includes(definition.type)&&typeof v!=='string')error('A source custom value has the wrong declared type.')
    return v
   }
   const retained=definitions.find(d=>d.scope===scope&&d.name===name&&d.mapping.kind===kind)!;retained.values+=rows.length
   const input=mapping.entry==='pick-many'?rows.map(r=>scalar(r.value)):scalar(rows[0].value)
   // Validate before the CSV bridge, which otherwise cannot distinguish a JSON
   // Boolean from source text. The regular importer validates the value again.
   customValue({...mapping,choices:JSON.stringify(mapping.choices)},input)
   target[name]=mapping.entry==='pick-many'?JSON.stringify(input):String(input)
  }
 }
 return {definitions,values}
}

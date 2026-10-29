import type { SourceDefinition } from './source-definitions'
import type { CustomImportMapping, ParsedImport } from './types'
import type { FieldMapping } from './custom-review-types'

const sourceChoice=(m:CustomImportMapping,value:string)=>{
 if(m.type!=='currency')return value
 const cents=BigInt(value),negative=cents<0n,raw=String(negative?-cents:cents).padStart(3,'0')
 return (negative?'-':'')+raw.slice(0,-2)+'.'+raw.slice(-2)
}
/** Spreadsheet definitions come from the person's explicit column declarations. */
export function columnDefinitions(parsed:ParsedImport){
 const definitions:SourceDefinition[]=[],mappings:FieldMapping[]=[]
 for(const m of parsed.customFields??[]){
  if(m.kind==='pledge')continue
  const id=JSON.stringify([m.kind,m.sheet??'',m.column])
  definitions.push({id,name:m.column,kind:m.kind,type:m.type,entry:m.entry,choices:m.choices.map(value=>sourceChoice(m,value)),values:[]})
  mappings.push({id,action:'field',field:m})
 }
 return {definitions,mappings}
}
export function stageColumnValue(parsed:ParsedImport,mapping:CustomImportMapping,recordId:string,original:string){
 const definition=parsed.columnDefinitions?.find(d=>d.id===JSON.stringify([mapping.kind,mapping.sheet??'',mapping.column]))
 if(!definition)return false
 let value:unknown=original
 if(mapping.entry==='pick-many')try{value=JSON.parse(original)}catch{}
 definition.values.push({recordId,value})
 return true
}

import { acknowledgmentFilters } from '../acknowledgment-filters'
import { customFields } from '../custom-fields'
import { choice, date, fail, object, text, type Context, type Row } from '../db'
import { solicitationFilter } from '../solicitation-filter'
import { exportRecords } from '../exports-records'

export const BUILDER_TYPES = ['constituents','gifts','pledges','opportunities','interactions'] as const
export type BuilderType = typeof BUILDER_TYPES[number]
export type Definition = {schemaVersion:1;recordType:BuilderType;columns:string[];groupBy:string[];totals:string[];filters:{field:string;operator:string;value:string|number}[];from:string;through:string;acknowledgment:Record<string,string>;solicitation:string}
export type BuilderField = {key:string;label:string;numeric:boolean}
const kinds={constituents:'constituent',gifts:'gift',pledges:'pledge',opportunities:'opportunity',interactions:'interaction'}
export const dateField={constituents:'created_at',gifts:'received_on',pledges:'pledged_on',opportunities:'expected_close_on',interactions:'occurred_on'}
export async function builderFields(c:Context,type:BuilderType):Promise<BuilderField[]> {
 const native=exportRecords[type].columns.map(key=>({key,label:key.replace(/_/g,' '),numeric:/_cents$|_percent$|^version$|^quantity$/.test(key)}))
 const fields=(await customFields(c)).filter(f=>f.kind===kinds[type]||(type==='interactions'&&f.kind==='note'))
 return [...native,{key:'month',label:'month',numeric:false},...fields.map(f=>({key:'custom.'+f.key,label:f.label,numeric:['number','currency','year'].includes(f.type)}))]
}
export async function definition(c:Context,input:unknown):Promise<Definition> {
 const p=object(input,'Report definition'),recordType=choice(p.recordType,BUILDER_TYPES,'report record type'),fields=await builderFields(c,recordType)
 if(p.schemaVersion!==undefined&&p.schemaVersion!==1)fail('INPUT','This report definition version is not supported.',400)
 const list=(value:unknown,label:string,required=false)=>{
  if(!Array.isArray(value)||value.length>fields.length||required&&!value.length||value.some(k=>typeof k!=='string'||!fields.some(f=>f.key===k)))fail('INPUT','Choose defined '+label+'.',400)
  return [...new Set(value)] as string[]
 }
 const columns=list(p.columns,'columns',true),groupBy=list(p.groupBy??[],'groupings'),totals=list(p.totals??[],'totals')
 if(totals.some(k=>!fields.find(f=>f.key===k)!.numeric))fail('INPUT','Totals require numeric fields.',400)
 if(!Array.isArray(p.filters??[])||(p.filters??[]).length>20)fail('INPUT','Choose up to 20 filters.',400)
 const filters=(p.filters??[]).map((v:unknown)=>{
  const f=object(v,'Filter'),field=choice(f.field,fields.map(f=>f.key),'filter field'),operator=choice(f.operator,['eq','neq','contains','gt','gte','lt','lte','empty','notEmpty'],'filter comparison')
  const numeric=fields.find(f=>f.key===field)!.numeric
  let value:string|number=operator==='empty'||operator==='notEmpty'?'':text(String(f.value??''),'Filter value',2000)
  if(numeric&&operator!=='contains'&&value!==''){value=Number(value);if(!Number.isFinite(value)||(/_cents$/.test(field)&&!Number.isSafeInteger(value)))fail('INPUT','Use exact numeric filter values, in cents for money.',400)}
  return {field,operator,value}
 })
 const from=p.from?date(p.from,'From'):'',through=p.through?date(p.through,'Through'):''
 if(from&&through&&from>through)fail('INPUT','From must be on or before Through.',400)
 const acknowledgment=acknowledgmentFilters(object(p.acknowledgment??{}))
 if(recordType!=='gifts'&&Object.keys(acknowledgment).length)fail('INPUT','Thank-you filters select gifts.',400)
 const solicitation=solicitationFilter(p.solicitation)
 return {schemaVersion:1,recordType,columns,groupBy,totals,filters,from,through,acknowledgment,solicitation}
}
export function fieldSql(field:string,alias='r') {
 if(field==='month')return `${alias}.month`
 if(field.startsWith('custom.'))return `json_extract(${alias}.custom_fields,'$."${field.slice(7)}"')`
 return `${alias}.${field}`
}
export function valueOf(row:Row,field:string):unknown {
 if(field.startsWith('custom.'))return JSON.parse(row.custom_fields||'{}')[field.slice(7)]??null
 return row[field]??null
}

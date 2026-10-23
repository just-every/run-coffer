import { requireRole } from './auth'
import { all, choice, commit, date, event, fail, guard, id, integer, one, sql, text, type Context, type Row } from './db'
import { exactUsd } from './money'
import { customRecord } from './custom-records'

export const customFields = (c:{db:D1Database}) => all(c,'SELECT * FROM cf_custom_fields ORDER BY key')
export async function customFieldNames(c:{db:D1Database}) { return (await customFields(c)).map(f=>'custom.'+f.key) }
export async function customAllowed(c:{db:D1Database},fields:string[],options:{currency?:boolean}={}) { return [...fields,...(await customFields(c)).filter(f=>options.currency!==false||f.type!=='currency').map(f=>'custom.'+f.key)] }
export function customValue(field:Row,input:unknown):string {
 const scalar=(v:unknown):string=>{
  if(field.type==='checkbox') { if(v!==true&&v!==false&&v!=='true'&&v!=='false')fail('INPUT','Choose true or false.',400);return String(v) }
  if(field.type==='date')return date(v,field.label)
  if(field.type==='year')return String(integer(Number(v),field.label,1000,9999))
  if(field.type==='number'||field.type==='currency') {
   if((typeof v!=='number'&&typeof v!=='string')||String(v).trim()===''||!Number.isFinite(Number(v)))fail('INPUT',field.label+' must be a number.',400)
   if(field.type==='number')return String(Number(v))
   const s=String(v);if(!/^-?\d+(?:\.\d{1,2})?$/.test(s))fail('INPUT',field.label+' must have at most two decimal places.',400)
   const negative=s.startsWith('-'),[whole,fraction='']=s.replace(/^-/,'').split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'))
   integer(cents,field.label,0);return String(negative?-cents:cents)
  }
  return text(v,field.label,2000)
 }
 const choices:string[]=JSON.parse(field.choices)
 const values=field.entry==='pick-many'?(Array.isArray(input)?input:fail('INPUT','Choose a list of values.',400)):[input]
 if(!values.length||values.length>100)fail('INPUT','Choose 1–100 values.',400)
 const converted=[...new Set(values.map(scalar))]
 if(field.entry!=='free-form'&&converted.some(v=>!choices.includes(v)))fail('INPUT','Choose a value from '+field.label+'’s pick list.',400)
 return JSON.stringify(field.entry==='pick-many'?converted:converted[0])
}
export async function customFieldCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(!['custom.define','custom.set','custom.clear'].includes(command))return
 requireRole(c.actor,['owner','admin'],'manage custom data')
 const key=text(p.key,'Field key',80);if(!/^[a-z][a-z0-9_]*$/.test(key))fail('INPUT','Use a lowercase field key with underscores.',400)
 if(command==='custom.define') {
  const existing=await one(c,'SELECT * FROM cf_custom_fields WHERE key=?',key)
  const version=existing?integer(Number(p.version),'Field version',1):0
  const kind=choice(p.kind??existing?.kind,['constituent','gift','pledge','opportunity','interaction','note'],'record kind'),type=choice(p.type??existing?.type,['text','number','currency','date','year','checkbox'],'field type')
  const entry=choice(p.entry??existing?.entry??'free-form',['free-form','pick-one','pick-many'],'entry method'),label=text(p.label,'Field label',100)
  if(existing&&(existing.kind!==kind||existing.type!==type||existing.entry!==entry))fail('INPUT','A field keeps its record kind, type and entry method.',400)
  const choices=entry==='free-form'?[]:typeof p.choices==='string'?p.choices.split(/\r?\n/).map(v=>v.trim()).filter(Boolean):p.choices
  if(!Array.isArray(choices)||choices.length>100||entry!=='free-form'&&!choices.length)fail('INPUT','Provide 1–100 pick-list choices.',400)
  const normalized=choices.map(v=>JSON.parse(customValue({type,entry:'free-form',label,choices:'[]'},v)))
  if(new Set(normalized).size!==normalized.length)fail('INPUT','Pick-list choices must be distinct.',400)
  if(existing&&JSON.parse(existing.choices).some((v:string)=>!normalized.includes(v)))fail('INPUT','Existing choices cannot be removed while saved records may use them.',400)
  await commit(c,[...(existing?[guard('EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=? AND version=?)','VERSION','This field changed.',key,version),sql('UPDATE cf_custom_fields SET label=?,choices=?,version=version+1 WHERE key=?',label,JSON.stringify(normalized),key)]:[sql('INSERT INTO cf_custom_fields VALUES(?,?,?,?,?,?,1,?)',key,label,kind,type,entry,JSON.stringify(normalized),c.now)]),event(c,command,'custom_field',key,null,{kind,type,version:version+1})])
  return {key,version:version+1}
 }
 const field=await one(c,'SELECT * FROM cf_custom_fields WHERE key=?',key);if(!field)fail('NOT_FOUND','Choose a defined custom field.',404)
 const recordId=id(p.recordId,'Record'),version=integer(Number(p.version??0),'Value version',0),source=text(p.source??'staff','Source',100)
 const record=await customRecord(c,field.kind,recordId)
 if(!record)fail('NOT_FOUND','Choose a current record.',404)
 let input=p.value;if(field.entry==='pick-many'&&typeof input==='string'){try{input=JSON.parse(input)}catch{fail('INPUT','Choose a JSON list of values.',400)}}
 const value=command==='custom.clear'?'null':customValue(field,input)
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','RECORD_CHANGED','This donor changed.',record.donor_id,record.donor_id),guard('EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=? AND version=?)','VERSION','This field changed.',key,field.version),guard('COALESCE((SELECT version FROM cf_custom_values WHERE field_key=? AND record_id=?),0)=?','VERSION','This value changed.',key,recordId,version),
 sql('INSERT INTO cf_custom_values VALUES(?,?,?,?,?,?,?) ON CONFLICT(field_key,record_id) DO UPDATE SET value=excluded.value,version=excluded.version,source=excluded.source,updated_at=excluded.updated_at',key,recordId,record.donor_id,value,version+1,source,c.now),
 sql('INSERT INTO cf_custom_value_history VALUES(?,?,?,?,?,?,?,?)',key,recordId,record.donor_id,version+1,value,source,c.now,c.actor.id),event(c,command,'custom_value',recordId,record.donor_id,{key,version:version+1}),sql('UPDATE cf_donors SET version=version+1 WHERE id=?',record.donor_id)])
 return {key,recordId,donorId:record.donor_id,version:version+1}
}
export function customDisplay(field:Row,value:unknown):string {
 if(value==null)return ''
 const render=(v:unknown)=>field.type==='currency'?exactUsd(String(v)):String(v)
 return Array.isArray(value)?value.map(render).join(', '):render(value)
}
export async function customMerge(c:{db:D1Database},kind:string,recordId:string):Promise<Record<string,string>> {
 const values=await all(c,'SELECT f.key,f.type,v.value FROM cf_custom_fields f JOIN cf_custom_values v ON v.field_key=f.key JOIN cf_donors d ON d.id=v.donor_id WHERE f.kind=? AND v.record_id=? AND d.erased_at IS NULL',kind,recordId)
 return Object.fromEntries(values.map(v=>['custom.'+v.key,customDisplay(v,JSON.parse(v.value))]))
}

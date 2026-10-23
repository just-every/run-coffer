import { requireRole } from './auth'
import { customFields, customValue } from './custom-fields'
import { event, fail, guard, object, sql, type Context, type Stmt } from './db'

/** Entry, batch close and import use the same typed validator before writing. */
export async function customEntry(c:Context,kind:string,recordId:string,donorId:string,input:unknown,source:string):Promise<Stmt[]>{
 if(input===undefined||input===null)return []
 const values=object(input,'Custom fields');if(!Object.keys(values).length)return []
 requireRole(c.actor,['owner','admin'],'enter custom values')
 const definitions=await customFields(c),writes:Stmt[]=[]
 for(const [key,input] of Object.entries(values)){
  const field=definitions.find(f=>f.key===key&&f.kind===kind)
  if(!field)fail('INPUT','Choose a defined '+kind+' field: '+key,400)
  const value=customValue(field,input)
  writes.push(guard('EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=? AND version=?)','VERSION','A custom definition changed. Review this entry again.',key,field.version),
   sql('INSERT INTO cf_custom_values VALUES(?,?,?,?,1,?,?)',key,recordId,donorId,value,source,c.now),
   sql('INSERT INTO cf_custom_value_history VALUES(?,?,?,1,?,?,?,?)',key,recordId,donorId,value,source,c.now,c.actor.id),event(c,'custom.set','custom_value',recordId,donorId,{key,version:1,source}))
 }
 return writes
}

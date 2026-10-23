import { requireRole } from './auth'
import { customValue } from './custom-fields'
import { centsDecimal } from './money'
import { all, commit, event, fail, guard, integer, one, sql, text, type Context, type Row, type Stmt } from './db'

/** Rename is a migration of current values; prior history and documents stay literal. */
export async function customChoiceCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(command!=='custom.renameChoice')return
 requireRole(c.actor,['owner','admin'],'rename custom choices')
 const key=text(p.key,'Field key',80),version=integer(Number(p.version),'Field version',1),field=await one(c,'SELECT * FROM cf_custom_fields WHERE key=?',key)
 if(!field||field.entry==='free-form')fail('INPUT','Choose a pick-list field.',400)
 const scalar=(v:unknown)=>JSON.parse(customValue({...field,entry:'free-form'},v))
 const from=scalar(p.from),to=scalar(p.to),choices:string[]=JSON.parse(field.choices)
 if(!choices.includes(from)||choices.includes(to))fail('INPUT','Choose an existing value and a distinct new value.',400)
 const values=await all(c,'SELECT * FROM cf_custom_values WHERE field_key=? ORDER BY record_id',key),writes:Stmt[]=[guard('(SELECT COUNT(*) FROM cf_custom_values WHERE field_key=?)=?','VERSION','Stored values changed. Review the rename again.',key,values.length)]
 for(const row of values)writes.push(guard('EXISTS(SELECT 1 FROM cf_custom_values WHERE field_key=? AND record_id=? AND version=?)','VERSION','A stored value changed. Review the rename again.',key,row.record_id,row.version))
 let changed=0
 for(const row of values){
  const old=JSON.parse(row.value),next=Array.isArray(old)?old.map(v=>v===from?to:v):old===from?to:old
  if(JSON.stringify(old)===JSON.stringify(next))continue
  changed++
  writes.push(sql('UPDATE cf_custom_values SET value=?,version=version+1,source=?,updated_at=? WHERE field_key=? AND record_id=?',JSON.stringify(next),'pick-list rename',c.now,key,row.record_id),
   sql('INSERT INTO cf_custom_value_history VALUES(?,?,?,?,?,?,?,?)',key,row.record_id,row.donor_id,row.version+1,JSON.stringify(next),'pick-list rename',c.now,c.actor.id),
   sql('UPDATE cf_donors SET version=version+1 WHERE id=?',row.donor_id),event(c,command,'custom_value',row.record_id,row.donor_id,{key,from,to}))
 }
 const filter=(value:string)=>field.type==='currency'?centsDecimal(value):String(value)
 const oldFilter=filter(from),newFilter=filter(to)
 // Saved filters follow the choice so a rename cannot silently empty a live list.
 writes.push(sql("UPDATE cf_saved_lists SET filters=json_set(filters,'$.customValue',?),version=version+1,updated_at=?,updated_by=? WHERE json_extract(filters,'$.customKey')=? AND json_extract(filters,'$.customValue')=?",newFilter,c.now,c.actor.id,key,oldFilter))
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=? AND version=?)','VERSION','The field changed. Review the rename again.',key,version),sql('UPDATE cf_custom_fields SET choices=?,version=version+1 WHERE key=?',JSON.stringify(choices.map(v=>v===from?to:v)),key),...writes,event(c,command,'custom_field',key,null,{from,to,changed,version:version+1})])
 return {key,version:version+1,changed}
}

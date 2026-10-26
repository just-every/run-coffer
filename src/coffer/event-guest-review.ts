import { customValue } from './custom-fields'
import { centsDecimal } from './money'
import { commit, event, fail, guard, id, integer, one, sql, type Context, type Row, type Stmt } from './db'

/** An operator reviews the real person and values before any native field changes. */
export async function matchEventGuest(c:Context,p:Row) {
 const registrationId=id(p.registrationId,'Guest'),donorId=id(p.donorId,'Guest donor'),version=integer(Number(p.version),'Guest version',1)
 if(p.reviewed!=='yes'&&p.reviewed!==true)fail('INPUT','Review the guest identity and submitted answers before matching.',400)
 const r=await one(c,`SELECT r.*,o.questions_json FROM cf_event_registrations r JOIN cf_event_orders o ON o.intent_id=r.intent_id WHERE r.id=? AND o.paid_at IS NOT NULL`,registrationId)
 if(!r)fail('NOT_FOUND','Choose a paid guest registration.',404)
 if(r.version!==version)fail('VERSION','The guest changed. Review the current registration.',409)
 if(r.donor_id&&r.donor_id!==donorId)fail('GUEST_MATCHED','This guest already belongs to a different donor.',409)
 if(r.answers_applied_at)return {id:registrationId,eventId:r.event_id,donorId,version:r.version,reviewed:true}
 const writes:Stmt[]=[guard('EXISTS(SELECT 1 FROM cf_event_registrations r JOIN cf_event_orders o ON o.intent_id=r.intent_id WHERE r.id=? AND r.version=? AND r.donor_id IS ? AND r.answers_applied_at IS NULL AND o.paid_at IS NOT NULL)','VERSION','The guest changed. Review it again.',registrationId,version,r.donor_id),
  guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','DONOR_CHANGED','Choose a current donor record.',donorId,donorId)]
 const questions:Row[]=JSON.parse(r.questions_json),answers:Row=JSON.parse(r.answers_json)
 for(const [key,value] of Object.entries(answers)){
  const definition=questions.find(q=>q.field_key===key),field=await one(c,"SELECT * FROM cf_custom_fields WHERE key=? AND kind='constituent'",key)
  if(!field||!definition||field.type!==definition.type||field.entry!==definition.entry)fail('FIELD_CHANGED','The mapped custom field changed. Review this guest with an administrator.',409)
  const raw=field.type==='currency'?(Array.isArray(value)?value.map(v=>centsDecimal(String(v))):centsDecimal(String(value))):value
  const normalized=customValue(field,raw),existing=await one(c,'SELECT * FROM cf_custom_values WHERE field_key=? AND record_id=?',key,donorId)
  if(existing&&existing.value!==normalized)fail('CUSTOM_CONFLICT','The donor already has a different value for '+field.label+'. Resolve it in the native custom field before accepting this answer.',409)
  writes.push(guard('EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=? AND version=?)','FIELD_CHANGED','The custom field changed. Review the guest again.',key,field.version),
   guard('COALESCE((SELECT version FROM cf_custom_values WHERE field_key=? AND record_id=?),0)=?','VALUE_CHANGED','The donor value changed. Review the guest again.',key,donorId,existing?.version??0))
  if(!existing)writes.push(sql('INSERT INTO cf_custom_values VALUES(?,?,?,?,1,?,?)',key,donorId,donorId,normalized,'event registration '+registrationId,c.now),
   sql('INSERT INTO cf_custom_value_history VALUES(?,?,?,1,?,?,?,?)',key,donorId,donorId,normalized,'event registration '+registrationId,c.now,c.actor.id),
   event(c,'custom.set','custom_value',donorId,donorId,{key,version:1,registrationId}))
 }
 writes.push(sql('UPDATE cf_event_registrations SET donor_id=?,answers_applied_at=?,version=version+1 WHERE id=?',donorId,c.now,registrationId),
  sql('UPDATE cf_donors SET version=version+1 WHERE id=?',donorId),event(c,'event.matchGuest','eventRegistration',registrationId,donorId,{eventId:r.event_id,answerCount:Object.keys(answers).length}))
 await commit(c,writes)
 return {id:registrationId,eventId:r.event_id,donorId,version:version+1,reviewed:true}
}

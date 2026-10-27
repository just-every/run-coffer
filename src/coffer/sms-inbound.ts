import { routingOwner } from './relationship-owner'
import { all, commit, guard, one, sha256, sql, today, type Context } from './db'
import { settings } from './settings'

/** Called only after the Twilio signature, account and destination are verified. */
export async function smsHelp(c:Context,fields:URLSearchParams):Promise<string|null>{
 if(!/^HELP$/i.test((fields.get('Body')??'').trim()))return null
 const receipt=await c.db.prepare('INSERT OR IGNORE INTO cf_sms_inbound VALUES(?,?) RETURNING message_id').bind(fields.get('MessageSid'),c.now).first()
 if(!receipt)return ''
 const s=await settings(c)
 return `${s.organisation}. For help, reply with your question and our team will follow up. Reply STOP to unsubscribe. Message and data rates may apply.`
}

export async function recordSmsReply(c:Context,fields:URLSearchParams):Promise<void>{
 const from=fields.get('From')??'',messageId=fields.get('MessageSid')??'',body=(fields.get('Body')??'').trim().slice(0,4000)
 if(!body||await one(c,'SELECT 1 FROM cf_sms_inbound WHERE message_id=?',messageId))return
 // A shared, changed or merged phone cannot identify a donor safely. Never
 // choose one candidate merely because their record happened to sort first.
 const donors=await all(c,`SELECT d.id,p.id AS preference_id FROM cf_donors d JOIN cf_sms_preferences p ON p.donor_id=d.id
  WHERE d.phone=? AND p.phone=d.phone AND p.id=(SELECT MAX(id) FROM cf_sms_preferences WHERE donor_id=d.id)
  AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`,from)
 if(donors.length!==1)return
 const donor=donors[0],owner=await routingOwner(c.db,donor.id)
 if(!owner)return
 const taskId='sms-'+await sha256(messageId),day=today((await settings(c)).timezone,new Date(c.now)),note='SMS reply: '+body
 await commit(c,[
  guard(`EXISTS(SELECT 1 FROM cf_donors d JOIN cf_sms_preferences p ON p.donor_id=d.id WHERE d.id=? AND d.phone=? AND p.phone=d.phone
   AND p.id=? AND p.id=(SELECT MAX(id) FROM cf_sms_preferences WHERE donor_id=d.id) AND d.erased_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`,'SMS_REPLY_CHANGED','The reply identity changed.',donor.id,from,donor.preference_id),
  guard(`(SELECT COUNT(*) FROM cf_donors d JOIN cf_sms_preferences p ON p.donor_id=d.id WHERE d.phone=? AND p.phone=d.phone AND p.id=(SELECT MAX(id) FROM cf_sms_preferences WHERE donor_id=d.id) AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))=1`,'SMS_REPLY_CHANGED','The reply phone is shared or changed.',from),
  guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))",'OWNER_CHANGED','The reply owner changed.',owner.id),
  sql(`INSERT OR IGNORE INTO cf_donor_notes(id,donor_id,occurred_on,body,source,recorded_at,recorded_by,kind,who,next_step,recorded_by_id)
   SELECT ?,?,?,?,'Twilio SMS',?,'Twilio SMS','note','Donor','Follow up on the assigned SMS reply task.','twilio-reply'
   WHERE NOT EXISTS(SELECT 1 FROM cf_sms_inbound WHERE message_id=?)`,taskId,donor.id,day,note,c.now,messageId),
  sql(`INSERT OR IGNORE INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask,task_kind)
   SELECT ?,?,?,'sms-reply',?,0,?,?,?,0,'follow_up' WHERE NOT EXISTS(SELECT 1 FROM cf_sms_inbound WHERE message_id=?)`,taskId,donor.id,taskId,note,owner.id,day,c.now,messageId),
  sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,'twilio-reply','Twilio SMS','system','sms.reply','task',?,?,? WHERE NOT EXISTS(SELECT 1 FROM cf_sms_inbound WHERE message_id=?)`,c.now,taskId,donor.id,JSON.stringify({ownerId:owner.id}),messageId),
  sql('INSERT OR IGNORE INTO cf_sms_inbound VALUES(?,?)',messageId,c.now),
 ])
}

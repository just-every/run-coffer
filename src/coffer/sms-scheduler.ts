import type { Bindings } from '../auth.server'
import { all, commit, event, sql, type Context } from './db'
import { smsCommand } from './sms'

/** Resume only explicit human schedules. Claims and unknown-result holds use
 * the same submission path as the human send door. */
export async function runScheduledTexts(env:Bindings,at:Date){
 const now=at.toISOString(),rows=await all({db:env.DB},`SELECT s.*,r.version,o.display_name,o.role,o.status AS operator_status
  FROM cf_sms_schedules s JOIN cf_sms_runs r ON r.id=s.run_id LEFT JOIN oa_operators o ON o.id=s.scheduled_by
  WHERE s.state='scheduled' AND s.scheduled_at<=? AND r.state='approved' ORDER BY s.scheduled_at,s.run_id LIMIT 50`,now)
 for(const row of rows){
  const c:Context={db:env.DB,env,now,actor:{id:row.scheduled_by,name:row.display_name??'Former text scheduler',role:row.role??'owner'},authority:{sql:'1',params:[]}}
  try{
   if(row.operator_status!=='active'||!['owner','admin'].includes(row.role))throw Error('The scheduling owner or admin is no longer active.')
   c.authority={sql:"EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin')) AND EXISTS(SELECT 1 FROM cf_sms_schedules WHERE run_id=? AND state='scheduled')",params:[row.scheduled_by,row.run_id]}
   await smsCommand(c,'sms.send',{runId:row.run_id,version:row.version})
   await commit(c,[sql(`UPDATE cf_sms_schedules SET state='complete',note='All recipients have a saved result.',updated_at=? WHERE run_id=?
    AND NOT EXISTS(SELECT 1 FROM cf_sms_recipients WHERE run_id=? AND state IN ('pending','held'))`,now,row.run_id,row.run_id)])
  }catch(error){
   // Eligibility or authority changes require a new human review, never an
   // automatic weakening of the frozen approval or an automatic retry.
   const paused:Context={...c,authority:{sql:'1',params:[]}}
   await commit(paused,[sql("UPDATE cf_sms_schedules SET state='paused',note=?,updated_at=? WHERE run_id=? AND state='scheduled'",error instanceof Error?error.message:'Scheduled send requires review.',now,row.run_id),event(paused,'sms.schedulePaused','sms',row.run_id,null,{})])
  }
 }
 return {examined:rows.length}
}

import { all, commit, event, guard, id, integer, sql, text, type Context, type Row } from './db'

/** Tasks follow the frozen letter's current donor through merge and erasure. */
export async function receiptTasks(c: Pick<Context,'db'>, donorId?: string) {
 return all(c, `SELECT t.*,a.donor_id,a.batch_id,a.delivery_status,d.name AS donor_name
  FROM cf_receipt_address_tasks t JOIN cf_acks a ON a.id=t.letter_id JOIN cf_donors d ON d.id=a.donor_id
  WHERE d.erased_at IS NULL AND (? IS NULL OR d.id=?) ORDER BY t.completed_at IS NOT NULL,t.created_at,t.id`, donorId??null,donorId??null)
}
export async function receiptTaskCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if(command!=='receiptTask.complete')return undefined
 const taskId=id(p.taskId,'Address task'),version=integer(Number(p.version),'Task version',1),resolution=text(p.resolution,'How the address was checked',1000)
 await commit(c,[
  guard(`EXISTS(SELECT 1 FROM cf_receipt_address_tasks t JOIN cf_acks a ON a.id=t.letter_id JOIN cf_donors d ON d.id=a.donor_id WHERE t.id=? AND t.version=? AND t.completed_at IS NULL AND d.erased_at IS NULL)`, 'TASK_CHANGED','This address task changed or its donor was erased. Refresh before completing it.',taskId,version),
  sql('UPDATE cf_receipt_address_tasks SET version=version+1,completed_at=?,completed_by=?,resolution=? WHERE id=?',c.now,c.actor.id,resolution,taskId),
  event(c,command,'receipt_address_task',taskId,null),
 ])
 return {id:taskId,completed:true}
}

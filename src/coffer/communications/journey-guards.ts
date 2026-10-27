import { guard, one, today, type Context, type Stmt } from '../db'
import { listMembers } from '../list-members'
import { settings } from '../settings'

/** Guard native facts in the same batch that prepares or hands off a message.
 * Provider contact reconciliation may have awaited the network in between. */
export async function journeySendGuards(c:Context,stepId:string):Promise<Stmt[]>{
 const row=await one(c,`SELECT e.*,j.trigger,j.list_id,t.condition FROM cf_journey_steps s JOIN cf_journey_enrollments e ON e.id=s.enrollment_id JOIN cf_journeys j ON j.id=e.journey_id JOIN cf_journey_templates t ON t.journey_id=j.id AND t.step=s.step WHERE s.id=?`,stepId)
 if(!row)return []
 const guards=[guard(`EXISTS(SELECT 1 FROM cf_journey_enrollments e JOIN cf_journeys j ON j.id=e.journey_id JOIN cf_donors d ON d.id=e.donor_id WHERE e.id=? AND e.status='active' AND j.stopped_at IS NULL AND d.erased_at IS NULL AND d.constituent_status='active' AND (SELECT status FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1)='granted' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id OR (into_id=d.id AND merged_at>=e.enrolled_at)) AND NOT EXISTS(SELECT 1 FROM cf_gifts g WHERE g.donor_id=d.id AND g.kind='gift' AND g.id NOT IN(SELECT value FROM json_each(e.gift_ids))))`,'JOURNEY_CHANGED','The donor left this journey before submission.',row.id)]
 if(row.condition!=='always'){
  guards.push(guard(`(EXISTS(SELECT 1 FROM cf_reply_tasks r JOIN cf_communications m ON m.id=r.communication_id JOIN cf_journey_steps prior ON prior.message_key=m.message_key WHERE prior.enrollment_id=? AND r.received_at>=? AND r.status<>'filed'))=?`,'JOURNEY_BRANCH_CHANGED','The reply branch changed before this action. Run due journeys to check it again.',row.id,row.enrolled_at,row.condition==='replied'?1:0))
 }
 if(row.trigger==='saved_list'){
  const members=await listMembers(c,row.list_id)
  guards.push(...members.guards,guard(`(WITH ${members.selection.ctes} SELECT EXISTS(SELECT 1 FROM members WHERE id=?))`,'LIST_CHANGED','The donor no longer belongs to this journey list.',...members.selection.params,row.donor_id))
 }
 if(row.trigger==='lybunt'||row.trigger==='sybunt'){
  const day=today((await settings(c)).timezone,new Date(c.now)),year=Number(day.slice(0,4))
  guards.push(guard(`COALESCE((SELECT SUM(amount_cents) FROM cf_monetary_contributions WHERE donor_id=? AND received_on BETWEEN ? AND ?),0)<=0 AND EXISTS(SELECT 1 FROM cf_monetary_contributions WHERE donor_id=? AND substr(received_on,1,4) ${row.trigger==='lybunt'?'=':'<'} ? GROUP BY substr(received_on,1,4) HAVING SUM(amount_cents)>0)`,'LIST_CHANGED','The donor no longer belongs to this annual cohort.',row.donor_id,year+'-01-01',day,row.donor_id,String(row.trigger==='lybunt'?year-1:year)))
 }
 return guards
}

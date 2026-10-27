import { annualLapses } from '../annual-lapses'
import { all, commit, event, guard, newId, one, sql, today, type Context, type Row } from '../db'
import { listMembers } from '../list-members'
import { settings } from '../settings'

export const journeyLive=`d.erased_at IS NULL AND d.constituent_status='active' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`
export const journeyConsent=`(SELECT status FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1)='granted'`
/** Twelve calendar months, clamped for leap-day anniversaries. */
export function previousYear(day:string){const year=Number(day.slice(0,4))-1,month=Number(day.slice(5,7)),last=new Date(Date.UTC(year,month,0)).getUTCDate();return `${year}-${day.slice(5,7)}-${String(Math.min(Number(day.slice(8)),last)).padStart(2,'0')}`}
export async function triggerMembers(c:Context,j:Row){
 const day=today((await settings(c)).timezone,new Date(c.now)),publishedDay=today((await settings(c)).timezone,new Date(j.published_at))
 if(j.trigger==='lybunt'||j.trigger==='sybunt')return (await annualLapses(c)).groups.find(g=>g.kind===j.trigger)!.rows.map(d=>d.donorId)
 if(j.trigger==='saved_list')return (await listMembers(c,j.list_id)).ids
 if(j.trigger==='event')return (await all(c,`SELECT DISTINCT donor_id FROM cf_event_registrations WHERE event_id=? AND donor_id IS NOT NULL AND checked_in_at>=? AND checked_in_at<=?`,j.event_id,j.published_at,c.now)).map(r=>r.donor_id)
 if(j.trigger==='recurring')return (await all(c,`SELECT DISTINCT s.donor_id FROM cf_subscriptions s JOIN cf_subscription_lifetimes l ON l.subscription_id=s.id WHERE s.status IN ('active','trialing') AND l.started_at>? AND l.started_at<=?`,j.published_at,c.now)).map(r=>r.donor_id)
 if(j.trigger==='gift_amount')return (await all(c,`SELECT DISTINCT donor_id FROM cf_gift_balances WHERE net_cents>? AND created_at>? AND created_at<=? AND received_on>=? AND received_on<=?`,j.amount_cents,j.published_at,c.now,publishedDay,day)).map(r=>r.donor_id)
 if(j.trigger==='lapse')return (await all(c,`SELECT donor_id FROM cf_gift_balances WHERE net_cents>0 AND received_on<=? GROUP BY donor_id HAVING MAX(received_on)<=?`,day,previousYear(day))).map(r=>r.donor_id)
 return (await all(c,`SELECT donor_id FROM cf_gift_balances WHERE net_cents>0 AND received_on<=? GROUP BY donor_id HAVING substr(MIN(received_on),6)=? AND MIN(received_on)<?`,day,day.slice(5),day)).map(r=>r.donor_id)
}
export async function enrollJourneys(c:Context){
 const journeys=await all(c,'SELECT * FROM cf_journeys WHERE stopped_at IS NULL ORDER BY published_at,id')
 for(const j of journeys){
  const ids=await triggerMembers(c,j)
  for(const donorId of ids){
   if(await one(c,'SELECT id FROM cf_journey_enrollments WHERE journey_id=? AND donor_id=?',j.id,donorId))continue
   const donor=await one(c,`SELECT d.id,d.version FROM cf_donors d WHERE d.id=? AND ${journeyLive} AND ${journeyConsent}`,donorId)
   if(!donor)continue
   const gifts=await all(c,"SELECT id FROM cf_gifts WHERE donor_id=? AND kind='gift' ORDER BY id",donorId),giftIds=JSON.stringify(gifts.map(g=>g.id))
   const gift=await one(c,`SELECT id FROM cf_gift_balances WHERE donor_id=? AND net_cents>0 ${j.trigger==='gift_amount'?'AND net_cents>? AND created_at>?':''} ORDER BY received_on DESC,created_at DESC,id DESC LIMIT 1`,donorId,...(j.trigger==='gift_amount'?[j.amount_cents,j.published_at]:[]))
   const enrollmentId=newId(),templates=await all(c,'SELECT * FROM cf_journey_templates WHERE journey_id=?',j.id)
   await commit(c,[guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE id=? AND version=? AND ${journeyLive} AND ${journeyConsent}) AND EXISTS(SELECT 1 FROM cf_journeys WHERE id=? AND stopped_at IS NULL)`,'JOURNEY_CHANGED','The journey recipient changed.',donorId,donor.version,j.id),
    sql("INSERT OR IGNORE INTO cf_journey_enrollments VALUES(?,?,?,?,?,?,'active',NULL)",enrollmentId,j.id,donorId,gift?.id??null,giftIds,c.now),
    ...templates.map(t=>sql(`INSERT OR IGNORE INTO cf_journey_steps(id,enrollment_id,donor_id,step,response_code,due_at,status,message_key) SELECT ?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ',?,?),'pending',? WHERE EXISTS(SELECT 1 FROM cf_journey_enrollments WHERE id=?)`,enrollmentId+':'+t.step,enrollmentId,donorId,t.step,t.code,c.now,'+'+t.delay_days+' days','journey:'+enrollmentId+':'+t.step,enrollmentId)),event(c,'journey.enroll','journey',j.id,donorId,{enrollmentId,trigger:j.trigger})])
  }
 }
}
export async function stopEnrollment(c:Context,id:string,reason:string){await commit(c,[sql("UPDATE cf_journey_enrollments SET status=?,stopped_at=? WHERE id=? AND status='active'",reason,c.now,id),sql("UPDATE cf_journey_steps SET status='cancelled',note=? WHERE enrollment_id=? AND status='pending'",reason,id)])}
export async function enrollmentReason(c:Context,e:Row,j:Row){
 const d=await one(c,'SELECT * FROM cf_donors WHERE id=?',e.donor_id)
 if(!d||d.erased_at)return 'erased'
 if(await one(c,'SELECT 1 FROM cf_donor_merges WHERE donor_id=? OR (into_id=? AND merged_at>=?)',d.id,d.id,e.enrolled_at))return 'merged'
 if(d.constituent_status!=='active')return d.constituent_status
 if(j.stopped_at)return 'stopped'
 if(!await one(c,`SELECT 1 FROM cf_donors d WHERE d.id=? AND ${journeyConsent}`,d.id))return 'unsubscribed'
 if(await one(c,"SELECT 1 FROM cf_gifts WHERE donor_id=? AND kind='gift' AND id NOT IN(SELECT value FROM json_each(?))",d.id,e.gift_ids))return 'gave'
 if(['lybunt','sybunt','saved_list','gift_amount','recurring'].includes(j.trigger)&&!(await triggerMembers(c,j)).includes(d.id))return ['lybunt','sybunt','saved_list'].includes(j.trigger)?'left list':'trigger no longer matches'
 return null
}

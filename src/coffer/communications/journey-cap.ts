import { addDays, one, today, type Context } from '../db'
import { settings } from '../settings'
import { preferenceIdentity } from './preference-store'

/** A durable reservation includes uncertain handoffs. Existing welcome messages
 * count too, including messages made before reservations were introduced. */
export async function journeyCap(c:Context,donorId:string,stepId:string){
 const day=today((await settings(c)).timezone,new Date(c.now)),days=(await one(c,'SELECT cap_days FROM cf_journey_policy WHERE id=1'))!.cap_days
 const since=addDays(day,1-days)
 // Convert each saved instant to the organization's day without assuming a UTC
 // boundary. The explicit slot is authoritative for every new submission.
 const offset=(await settings(c)).timezone
 const messages=await c.db.prepare(`SELECT source_id,created_at FROM cf_communications m WHERE m.source_kind='welcome' AND ${preferenceIdentity('m.donor_id')}=? AND m.source_id<>? AND m.status NOT IN ('rejected','suppressed')`).bind(donorId,stepId).all<{source_id:string;created_at:string}>()
 for(const message of messages.results??[]){const on=today(offset,new Date(message.created_at));if(on>=since&&on<=day)return {allowed:false}}
 const slotCondition=`NOT EXISTS(SELECT 1 FROM cf_journey_slots r WHERE ${preferenceIdentity('r.donor_id')}=? AND r.step_id<>? AND r.reserved_on BETWEEN ? AND ?)`
 const params=[donorId,stepId,since,day]
 return {allowed:!!await one(c,`SELECT 1 WHERE ${slotCondition}`,...params),condition:slotCondition,params}
}

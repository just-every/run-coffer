import { all, choice, commit, date, event, fail, guard, id, integer, newId, one, sql, text, today, type Context, type Row } from './db'
import { amount } from './money'
import { settings } from './settings'

export const DOCUMENTATION = ['not requested','requested','received','reviewed'] as const
const liveDonor = (donorId:string) => guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','DONOR_CHANGED','Open a live donor before recording planned giving.',donorId,donorId)

export async function plannedGivingCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(!command.startsWith('planned.')&&command!=='legacy.set')return undefined
 const donorId=id(p.donorId,'Donor'),day=today((await settings(c)).timezone,new Date(c.now))
 if(command==='planned.save'){
  const giftId=p.plannedGiftId ? id(p.plannedGiftId,'Intention') : newId(),version=p.plannedGiftId ? integer(p.version,'Version',1) : 0
  const label=text(p.label,'Intention name',200),vehicle=text(p.vehicle,'Planned gift vehicle',200),documentation=choice(p.documentation,DOCUMENTATION,'Documentation status'),recordedOn=date(p.recordedOn,'Recorded on')
  const hasEstimate=(p.estimatedValueCents!==undefined&&p.estimatedValueCents!=='')||(p.estimatedValue!==undefined&&p.estimatedValue!=='')
  const estimated=hasEstimate ? amount(p,'estimatedValue','Estimated value',{allowZero:true}) : null
  if(recordedOn>day)fail('INPUT','An intention cannot be recorded in the future.',400)
  await commit(c,[liveDonor(donorId),
   ...(version ? [guard('EXISTS(SELECT 1 FROM cf_planned_gifts WHERE id=? AND donor_id=? AND version=?)','VERSION','This intention changed. Refresh before saving.',giftId,donorId,version),
    guard('NOT EXISTS(SELECT 1 FROM cf_planned_distributions d JOIN cf_gifts g ON g.id=d.gift_id WHERE d.intention_id=? AND g.received_on<?)','DISTRIBUTION_DATE','An intention must precede its linked distributions.',giftId,recordedOn),
    sql('UPDATE cf_planned_gifts SET version=version+1,label=?,vehicle=?,estimated_cents=?,documentation=?,recorded_on=?,updated_at=? WHERE id=?',label,vehicle,estimated,documentation,recordedOn,c.now,giftId)] :
    [sql('INSERT INTO cf_planned_gifts VALUES(?,?,1,?,?,?,?,?,?,?)',giftId,donorId,label,vehicle,estimated,documentation,recordedOn,c.now,c.now)]),
   event(c,command,'plannedGift',giftId,donorId,{documentation,estimatedValueCents:estimated}),
  ])
  return {id:giftId,version:version+1,donorId}
 }
 if(command==='planned.realize'){
  const intentionId=id(p.plannedGiftId,'Intention'),giftId=id(p.giftId,'Received estate gift')
  await commit(c,[liveDonor(donorId),
   guard(`EXISTS(SELECT 1 FROM cf_planned_gifts p JOIN cf_gift_balances g ON g.donor_id=p.donor_id WHERE p.id=? AND p.donor_id=? AND g.id=? AND g.kind='gift' AND g.net_cents>0 AND g.received_on>=p.recorded_on AND NOT EXISTS(SELECT 1 FROM cf_gifts WHERE reverses=g.id))`,'ESTATE_GIFT','Choose an unreversed received gift on this donor, dated on or after the intention.',intentionId,donorId,giftId),
   guard('NOT EXISTS(SELECT 1 FROM cf_planned_distributions WHERE gift_id=?)','GIFT_LINKED','This gift is already linked to a planned intention.',giftId),
   sql('INSERT INTO cf_planned_distributions VALUES(?,?,?)',giftId,intentionId,c.now),
   event(c,command,'plannedGift',intentionId,donorId,{giftId}),
  ])
  return {id:intentionId,giftId,donorId}
 }
 if(command==='planned.unlink'){
  const giftId=id(p.giftId,'Distribution'),reason=choice(p.reason,['wrong intention','wrong gift','other correction'] as const,'Reason for unlinking')
  const link=await one(c,'SELECT d.* FROM cf_planned_distributions d JOIN cf_planned_gifts p ON p.id=d.intention_id WHERE d.gift_id=? AND p.donor_id=?',giftId,donorId)
  if(!link)fail('NOT_FOUND','That distribution is not linked to this donor.',404)
  await commit(c,[liveDonor(donorId),sql('DELETE FROM cf_planned_distributions WHERE gift_id=? AND intention_id=?',giftId,link.intention_id),event(c,command,'plannedGift',link.intention_id,donorId,{giftId,reason})])
  return {id:link.intention_id,donorId}
 }
 if(command==='legacy.set'){
  const member=choice(p.membership,['member','not a member'] as const,'Legacy society membership'),on=date(p.on,'Membership date')
  if(on>day)fail('INPUT','Record membership changes only after they happen.',400)
  const active=await all(c,'SELECT * FROM cf_legacy_memberships WHERE donor_id=? AND ended_on IS NULL',donorId)
  if(member==='member'){
   await commit(c,[liveDonor(donorId),guard('NOT EXISTS(SELECT 1 FROM cf_legacy_memberships WHERE donor_id=? AND ended_on IS NULL)','ALREADY_MEMBER','This donor is already a legacy society member.',donorId),sql('INSERT INTO cf_legacy_memberships VALUES(?,?,?,NULL)',newId(),donorId,on),event(c,command,'donor',donorId,donorId,{member:true,on})])
  }else{
   if(!active.length)fail('NOT_MEMBER','This donor is not an active member.')
   await commit(c,[liveDonor(donorId),guard('NOT EXISTS(SELECT 1 FROM cf_legacy_memberships WHERE donor_id=? AND ended_on IS NULL AND joined_on>?)','MEMBERSHIP_DATE','Membership cannot end before it began.',donorId,on),sql('UPDATE cf_legacy_memberships SET ended_on=? WHERE donor_id=? AND ended_on IS NULL',on,donorId),event(c,command,'donor',donorId,donorId,{member:false,on})])
  }
  return {donorId,member:member==='member'}
 }
 return undefined
}

export async function plannedGiving(c:{db:D1Database},donorId:string) {
 const [intentions,distributions,memberships,availableGifts]=await Promise.all([
  all(c,'SELECT * FROM cf_planned_gifts WHERE donor_id=? ORDER BY recorded_on DESC,created_at,id',donorId),
  all(c,`SELECT d.*,g.received_on,g.amount_cents,g.net_cents,g.reference FROM cf_planned_distributions d JOIN cf_planned_gifts p ON p.id=d.intention_id JOIN cf_gift_balances g ON g.id=d.gift_id WHERE p.donor_id=? ORDER BY g.received_on,d.gift_id`,donorId),
  all(c,'SELECT * FROM cf_legacy_memberships WHERE donor_id=? ORDER BY joined_on,id',donorId),
  all(c,"SELECT * FROM cf_gift_balances g WHERE donor_id=? AND kind='gift' AND net_cents>0 AND NOT EXISTS(SELECT 1 FROM cf_gifts WHERE reverses=g.id) ORDER BY received_on DESC,id",donorId),
 ])
 return {availableGifts,intentions:intentions.map(i=>({...i,realized_cents:distributions.filter(d=>d.intention_id===i.id).reduce((sum,d)=>sum+d.net_cents,0)})),distributions,memberships,legacyMember:memberships.some(m=>!m.ended_on)}
}

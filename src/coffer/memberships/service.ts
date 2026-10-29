import { requireRole } from '../auth'
import { addDays, all, commit, event, fail, guard, integer, newId, one, sql, text, today, type Context, type Row, type Stmt } from '../db'
import { amount } from '../money'
import { settings } from '../settings'
import { paymentWrite } from '../payments/write'
import type { GivingEnv } from '../giving/stripe'

export const membershipStaff=(c:Context)=>requireRole(c.actor,['owner','admin'],'manage memberships')
export async function membershipLevel(c:{db:D1Database},slug:string){
 const level=await one(c,`SELECT l.*,c.slug AS campaign_slug,c.name AS campaign_name FROM cf_membership_levels l JOIN cf_campaigns c ON c.id=l.campaign_id WHERE l.slug=? AND l.active=1 AND c.active=1`,slug)
 if(!level)fail('NOT_FOUND','This membership level is not available.',404)
 return level
}
export async function createMembershipLevel(c:Context,p:Row){
 membershipStaff(c)
 const id=newId(),name=text(p.name,'Level name',120),slug=text(p.slug,'Membership page address',80),campaignId=text(p.campaignId,'Campaign',100)
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))fail('INPUT','Use lowercase words and single hyphens for the page address.',400)
 const price=amount(p,'price','Membership price'),benefit=amount(p,'benefit','Benefit value',{allowZero:true}),term=integer(Number(p.termMonths),'Term in months',1,36),grace=integer(Number(p.graceDays),'Grace days',0,90),description=text(p.benefitDescription,'Benefits and disclosure',1000)
 if(price<100||price>10000000||benefit>price)fail('INPUT','Choose a term from one to 36 months and benefits no greater than the price.',400)
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND active=1)','CAMPAIGN','Choose a published campaign.',campaignId),guard('NOT EXISTS(SELECT 1 FROM cf_membership_levels WHERE slug=?)','LEVEL_EXISTS','Choose another membership page address.',slug),sql('INSERT INTO cf_membership_levels(id,name,slug,campaign_id,price_cents,term_months,benefit_cents,benefit_description,grace_days,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,name,slug,campaignId,price,term,benefit,description,grace,c.now),event(c,'membership.levelCreated','membershipLevel',id,null,{campaignId,priceCents:price,termMonths:term,benefitCents:benefit,graceDays:grace})])
 return {id,slug}
}
export async function selectedMembership(c:{db:D1Database},p:Row){
 const level=await one(c,'SELECT * FROM cf_membership_levels WHERE id=? AND active=1',text(p.membershipLevelId,'Membership level',100))
 if(!level||String(level.version)!==String(p.membershipLevelVersion))fail('LEVEL_CHANGED','Reload and review the current membership level.',409)
 return level
}
export async function retireMembershipLevel(c:Context,p:Row){
 membershipStaff(c)
 const id=text(p.id,'Level',100),version=integer(Number(p.version),'Level version',1)
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_membership_levels WHERE id=? AND version=? AND active=1)','LEVEL_CHANGED','This level changed. Reload before retiring it.',id,version),sql('UPDATE cf_membership_levels SET active=0,version=version+1 WHERE id=?',id),event(c,'membership.levelRetired','membershipLevel',id,null)])
 return {id}
}
export async function membershipCapture(db:D1Database,intentId:string,level:Row){
 const prior=await one({db},'SELECT * FROM cf_membership_intents WHERE intent_id=?',intentId)
 const autoRenew=level.auto_renew??1,renewal=level.renewal_membership_id??null
 if(prior&&(prior.level_id!==level.id||prior.level_version!==level.version||prior.auto_renew!==autoRenew||prior.renewal_membership_id!==renewal))fail('CHECKOUT_CHANGED','Reload before changing a membership level.',409)
 return [sql('INSERT OR IGNORE INTO cf_membership_intents(intent_id,level_id,level_version,price_cents,term_months,benefit_cents,benefit_description,grace_days,auto_renew,renewal_membership_id) VALUES(?,?,?,?,?,?,?,?,?,?)',intentId,level.id,level.version,level.price_cents,level.term_months,level.benefit_cents,level.benefit_description,level.grace_days,autoRenew,renewal),...(level.renewal_donor_id?[sql('UPDATE cf_giving_intents SET donor_id=? WHERE id=? AND donor_id IS NULL',level.renewal_donor_id,intentId)]:[])]
}
export async function holdMembershipPrice(c:{db:D1Database},subscription:string){
 if(await one(c,'SELECT 1 FROM cf_memberships WHERE subscription_id=? UNION ALL SELECT 1 FROM cf_membership_intents i JOIN cf_giving_intents g ON g.id=i.intent_id JOIN cf_subscriptions s ON s.customer_id=g.customer_id WHERE s.id=? AND i.auto_renew=1 AND (g.staff_channel IS NULL OR EXISTS(SELECT 1 FROM cf_portal_changes p WHERE p.id=i.intent_id AND p.subscription_id=s.id))',subscription,subscription))fail('MEMBERSHIP_TERMS','Membership price and term are fixed to the donor’s authorization. Cancel this plan and join the new level to change them.',409)
}
export function endOfTerm(start:string,months:number,day=Number(start.slice(-2))){
 const d=new Date(start+'T00:00:00Z')
 d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months)
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()
 d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10)
}
/** A paid invoice can grant one term; a subscription status never grants time.
 * Provider periods make late and out-of-order invoice delivery deterministic. */
export async function recordMembershipPayment(env:GivingEnv,intent:Row,sub:Row,invoice:Row,giftId:string){
 const c={db:env.DB},quote=await one(c,'SELECT * FROM cf_membership_intents WHERE intent_id=?',intent.id)
 if(!quote||!quote.auto_renew)return
 const r=sub.items?.data?.[0]?.price?.recurring,months=r?.interval==='year'?r.interval_count*12:r?.interval==='month'?r.interval_count:0
 if(invoice.amount_paid!==quote.price_cents||sub.items?.data?.length!==1||months!==quote.term_months||sub.items.data[0].price.unit_amount!==quote.price_cents)return
 const zone=(await settings(c)).timezone,period=invoice.lines?.data?.find((l:Row)=>l.period&&(!l.subscription||l.subscription===sub.id))?.period
 const start=period?.start??invoice.period_start??invoice.status_transitions.paid_at,end=period?.end??invoice.period_end
 if(!Number.isSafeInteger(start)||end!==undefined&&!Number.isSafeInteger(end))return
 const starts=today(zone,new Date(start*1000)),anchor=Number.isSafeInteger(sub.billing_cycle_anchor)?today(zone,new Date(sub.billing_cycle_anchor*1000)):starts
 const expected=endOfTerm(starts,quote.term_months,Number(anchor.slice(-2))),expires=end?today(zone,new Date(end*1000)):expected
 if(expires!==expected)return
 const membershipId='membership-'+intent.id
 await paymentWrite(env,[
  sql('INSERT OR IGNORE INTO cf_memberships(id,donor_id,intent_id,subscription_id,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_memberships WHERE intent_id=? AND subscription_id<>?)',membershipId,intent.donor_id,intent.id,sub.id,new Date().toISOString(),intent.donor_id,intent.id,sub.id),
  sql(`INSERT OR IGNORE INTO cf_membership_payments(gift_id,membership_id,starts_on,expires_on) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM cf_memberships m JOIN cf_gifts g ON g.id=? AND g.donor_id=m.donor_id WHERE m.id=? AND m.subscription_id=?)`,giftId,membershipId,starts,expires,giftId,membershipId,sub.id),
 ])
}
export async function membershipState(c:Context){
 membershipStaff(c)
 const day=today((await settings(c)).timezone,new Date(c.now))
 const levels=await all(c,'SELECT l.*,c.name AS campaign_name FROM cf_membership_levels l JOIN cf_campaigns c ON c.id=l.campaign_id ORDER BY lower(l.name),l.id')
 const rows=await all(c,`SELECT m.*,q.level_id,q.price_cents,q.term_months,q.benefit_cents,q.benefit_description,q.grace_days,l.name AS level_name,d.name AS donor_name,
 s.status AS subscription_status,s.cancel_at_period_end,COALESCE(p.collection_paused,0) AS collection_paused,
 (s.amount_cents<>q.price_cents OR (p.interval IS NOT NULL AND CASE p.interval WHEN 'year' THEN p.interval_count*12 WHEN 'month' THEN p.interval_count ELSE 0 END<>q.term_months)) AS terms_changed,
 EXISTS(SELECT 1 FROM cf_portal_changes ch WHERE ch.subscription_id=m.subscription_id AND ch.state IN ('pending','uncertain')) AS uncertain,
 (SELECT MAX(mp.expires_on) FROM cf_membership_payments mp JOIN cf_gift_balances b ON b.id=mp.gift_id JOIN cf_gifts g ON g.id=mp.gift_id WHERE mp.membership_id=m.id AND b.net_cents>=q.price_cents AND g.received_on<=?) AS expires_on
 FROM cf_memberships m JOIN cf_membership_intents q ON q.intent_id=m.intent_id JOIN cf_membership_levels l ON l.id=q.level_id
 JOIN cf_donors d ON d.id=m.donor_id LEFT JOIN cf_subscriptions s ON s.id=m.subscription_id LEFT JOIN cf_portal_subscription_settings p ON p.subscription_id=s.id
 WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) ORDER BY lower(d.name),m.id`,day)
 for(const row of rows){
  row.grace_ends_on=row.expires_on?addDays(row.expires_on,row.grace_days):null
  row.state=row.uncertain||row.terms_changed?'review':!row.expires_on?'lapsed':day<row.expires_on?'active':day<row.grace_ends_on?'grace':'lapsed'
  row.auto_renew=Boolean(!row.cancel_at_period_end&&!row.collection_paused&&['active','trialing','past_due'].includes(row.subscription_status)&&!row.uncertain&&!row.terms_changed)
 }
 const counts=levels.map(l=>{
  const people=new Map<string,Row>()
  for(const row of rows.filter(r=>r.level_id===l.id)){
   const old=people.get(row.donor_id),rank=['active','grace','review','lapsed']
   if(!old||rank.indexOf(row.state)<rank.indexOf(old.state))people.set(row.donor_id,row)
  }
  return {levelId:l.id,name:l.name,...Object.fromEntries(['active','grace','lapsed','review'].map(s=>[s,[...people.values()].filter(r=>r.state===s).length]))}
 })
 const reminders=await all(c,`SELECT r.id,r.membership_id,r.expires_on,r.prepared_at,COALESCE(n.status,r.status) AS status,n.message_id FROM cf_membership_reminders r LEFT JOIN cf_membership_notices n ON n.reminder_id=r.id JOIN cf_memberships m ON m.id=r.membership_id JOIN cf_donors d ON d.id=m.donor_id WHERE d.erased_at IS NULL ORDER BY r.prepared_at,r.id`)
 await commit(c,[])
 return {asOf:day,levels,memberships:rows,counts,reminders}
}
export async function prepareMembershipReminders(c:Context){
 const state=await membershipState(c),statements:Stmt[]=[]
 for(const m of state.memberships){
  if(!m.expires_on||m.state==='review'||state.asOf<addDays(m.expires_on,-30))continue
  statements.push(sql('INSERT OR IGNORE INTO cf_membership_reminders(id,membership_id,expires_on,prepared_at) VALUES(?,?,?,?)',newId(),m.id,m.expires_on,c.now))
 }
 await commit(c,[...statements,event(c,'membership.remindersPrepared','membership', 'review',null,{prepared:statements.length,submitted:0})])
 return membershipState(c)
}
/** A one-time checkout grants a fixed term only after its exact payment clears.
 * Renewals append earned time to the donor's authenticated existing membership. */
export async function recordFixedMembership(env:GivingEnv,intent:Row,giftId:string,paidAt:number){
 const c={db:env.DB},quote=await one(c,'SELECT * FROM cf_membership_intents WHERE intent_id=? AND auto_renew=0',intent.id)
 if(!quote)return
 const gift=await one(c,'SELECT g.*,b.net_cents FROM cf_gifts g JOIN cf_gift_balances b ON b.id=g.id WHERE g.id=? AND g.donor_id=?',giftId,intent.donor_id)
 if(!gift||gift.net_cents!==quote.price_cents||gift.amount_cents!==quote.price_cents)return
 const id=quote.renewal_membership_id??'membership-'+intent.id,zone=(await settings(c)).timezone,paidOn=today(zone,new Date(paidAt*1000))
 const prior=quote.renewal_membership_id?await one(c,`SELECT m.id,(SELECT MAX(p.expires_on) FROM cf_membership_payments p JOIN cf_gift_balances b ON b.id=p.gift_id WHERE p.membership_id=m.id AND b.net_cents>=q.price_cents) AS expires_on FROM cf_memberships m JOIN cf_membership_intents q ON q.intent_id=m.intent_id WHERE m.id=? AND m.donor_id=? AND m.subscription_id IS NULL AND q.level_id=?`,id,intent.donor_id,quote.level_id):null
 if(quote.renewal_membership_id&&!prior)return
 const starts=prior?.expires_on&&prior.expires_on>paidOn?prior.expires_on:paidOn
 await paymentWrite(env,[
  ...(!prior?[sql('INSERT OR IGNORE INTO cf_memberships(id,donor_id,intent_id,subscription_id,created_at) SELECT ?,?,?,NULL,? WHERE EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL)',id,intent.donor_id,intent.id,new Date().toISOString(),intent.donor_id)]:[]),
  sql('INSERT OR IGNORE INTO cf_membership_payments SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM cf_memberships WHERE id=? AND donor_id=? AND subscription_id IS NULL)',giftId,id,starts,endOfTerm(starts,quote.term_months),id,intent.donor_id),
 ])
}

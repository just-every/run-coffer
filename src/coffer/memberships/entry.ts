import { commit, event, fail, guard, one, sql, text, type Context, type Row } from '../db'
import { membershipCapture, membershipStaff, selectedMembership, endOfTerm } from './service'

/** Entry attaches an already received, fully classified payment. It never
 * charges a card or changes the ordinary ledger and receipt workflow. */
export async function enterMembership(c:Context,p:Row){
 membershipStaff(c)
 const level=await selectedMembership(c,p),giftId=text(p.giftId,'Received membership payment',100),requestId=text(p.requestId,'Entry request',100)
 if(!/^[a-f0-9-]{36}$/.test(requestId)||p.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm the exact level and received payment.',400)
 const gift=await one(c,`SELECT g.*,b.net_cents,d.name,d.email,d.version AS donor_version,c.fund AS campaign_fund FROM cf_gifts g JOIN cf_gift_balances b ON b.id=g.id JOIN cf_donors d ON d.id=g.donor_id JOIN cf_campaigns c ON c.id=? WHERE g.id=? AND g.kind='gift' AND d.erased_at IS NULL AND d.constituent_status='active' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`,level.campaign_id,giftId)
 if(!gift||gift.net_cents!==level.price_cents||gift.amount_cents!==level.price_cents||gift.goods_cents!==level.benefit_cents||gift.goods==='unknown'||level.benefit_cents>0&&gift.goods_description!==level.benefit_description||gift.fund!==gift.campaign_fund||!await one(c,'SELECT 1 FROM cf_campaign_gifts WHERE gift_id=? AND campaign_id=?',giftId,level.campaign_id))fail('PAYMENT_MISMATCH','Choose a full-price gift for this campaign with the level’s exact disclosed benefits and no reversal.',409)
 const renewal=p.renewMembershipId?text(p.renewMembershipId,'Membership to renew',100):null
 const existing=await one(c,'SELECT * FROM cf_membership_payments WHERE gift_id=?',giftId)
 if(existing){
  const intent=await one(c,'SELECT i.* FROM cf_membership_intents i WHERE intent_id=?',requestId)
  if(intent&&intent.level_id===level.id&&intent.auto_renew===0&&(intent.renewal_membership_id??null)===renewal){await commit(c,[]);return {id:existing.membership_id,giftId}}
  fail('PAYMENT_USED','This payment already earned membership time.',409)
 }
 if(await one(c,'SELECT 1 FROM cf_giving_intents WHERE id=?',requestId))fail('REQUEST_CHANGED','This request ID already belongs to another instruction.',409)
 const prior=renewal?await renewalMembership(c,renewal,gift.donor_id,level):null
 const starts=prior?.expires_on&&prior.expires_on>gift.received_on?prior.expires_on:gift.received_on,id=renewal??'membership-'+requestId
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_membership_levels WHERE id=? AND version=? AND active=1)','LEVEL_CHANGED','This membership level changed.',level.id,level.version),guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL)','DONOR_CHANGED','The donor changed.',gift.donor_id,gift.donor_version),guard('EXISTS(SELECT 1 FROM cf_gift_balances WHERE id=? AND net_cents=?) AND NOT EXISTS(SELECT 1 FROM cf_membership_payments WHERE gift_id=?)','PAYMENT_CHANGED','The payment changed or already earned a term.',giftId,level.price_cents,giftId),
  ...(prior?[guard('EXISTS(SELECT 1 FROM cf_memberships WHERE id=? AND donor_id=? AND subscription_id IS NULL)','MEMBERSHIP_CHANGED','Membership ownership changed.',id,gift.donor_id)]:[]),
  sql("INSERT INTO cf_giving_intents(id,campaign_id,name,email,amount_cents,frequency,donor_id,created_at,email_consent,requested_amount_cents,billing_frequency) VALUES(?,?,?,?,?,'once',?,?,0,?,'once')",requestId,level.campaign_id,gift.name,gift.email??'',level.price_cents,gift.donor_id,c.now,level.price_cents),
  ...await membershipCapture(c.db,requestId,{...level,auto_renew:0,renewal_membership_id:renewal}),
  ...(!prior?[sql('INSERT INTO cf_memberships(id,donor_id,intent_id,subscription_id,created_at) VALUES(?,?,?,NULL,?)',id,gift.donor_id,requestId,c.now)]:[]),
  sql('INSERT INTO cf_membership_payments VALUES(?,?,?,?)',giftId,id,starts,endOfTerm(starts,level.term_months)),event(c,'membership.entered','membership',id,gift.donor_id,{giftId,levelId:level.id,startsOn:starts,expiresOn:endOfTerm(starts,level.term_months)})])
 return {id,giftId}
}
export async function renewalMembership(c:{db:D1Database},id:string,donorId:string,level:Row){
 const m=await one(c,`SELECT m.*,q.level_id,(SELECT MAX(p.expires_on) FROM cf_membership_payments p JOIN cf_gift_balances b ON b.id=p.gift_id WHERE p.membership_id=m.id AND b.net_cents>=q.price_cents) AS expires_on FROM cf_memberships m JOIN cf_membership_intents q ON q.intent_id=m.intent_id WHERE m.id=? AND m.donor_id=? AND m.subscription_id IS NULL AND q.level_id=?`,id,donorId,level.id)
 if(!m)fail('MEMBERSHIP_CHANGED','Choose your non-renewing membership at this same level.',409)
 return m
}

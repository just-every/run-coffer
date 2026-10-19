import { amount } from './money'
import { commit, event, fail, guard, id, integer, newId, one, sql, text, type Context, type Row, type Stmt } from './db'

/** Reductions consume latest unpaid installments; they never edit a gift. */
export async function adjustPledge(c: Context, command: string, p: Row, history: Row[]) {
 const pledgeId=id(p.pledgeId,'Pledge'), version=integer(Number(p.version),'Pledge version',1)
 const pledge=history.find(row=>row.id===pledgeId)
 if(!pledge) fail('NOT_FOUND','That pledge does not exist.',404)
 const reason=text(p.reason,'Reason',1000), kind=command==='pledge.writeOff'?'write_off':'reduction'
 const cents=kind==='write_off'?pledge.remaining_cents:amount(p,'amount','Reduction')
 if(cents<1||cents>pledge.remaining_cents) fail('PLEDGE_BALANCE','Reduce only the unpaid pledge balance.')
 let left=cents
 const changes:Stmt[]=[]
 for(const i of [...pledge.installments].reverse()){
  const n=Math.min(left,Math.max(0,i.remaining_cents));if(!n)continue
  changes.push(sql('INSERT INTO cf_pledge_adjustments(id,pledge_id,installment_id,amount_cents,kind,reason,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)',newId(),pledgeId,i.id,n,kind,reason,c.now,c.actor.name));left-=n
 }
 if(left && !pledge.installments.length) changes.push(sql('INSERT INTO cf_pledge_adjustments(id,pledge_id,amount_cents,kind,reason,created_at,created_by) VALUES(?,?,?,?,?,?,?)',newId(),pledgeId,left,kind,reason,c.now,c.actor.name))
 else if(left) fail('PLEDGE_BALANCE','The installment balances changed. Refresh before reducing.')
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_pledges p JOIN cf_donors d ON d.id=p.donor_id WHERE p.id=? AND p.version=? AND d.erased_at IS NULL)','PLEDGE_CHANGED','The pledge changed. Refresh before saving.',pledgeId,version),...changes,
  sql('UPDATE cf_pledges SET version=version+1 WHERE id=?',pledgeId),event(c,command,'pledge',pledgeId,pledge.donor_id,{amountCents:cents})])
 return {id:pledgeId,reducedCents:cents}
}

export async function linkPledgePlan(c:Context,p:Row){
 const pledgeId=id(p.pledgeId,'Pledge'),subscriptionId=id(p.subscriptionId,'Recurring plan'),version=integer(Number(p.version),'Pledge version',1)
 const pledge=await one(c,'SELECT * FROM cf_pledges WHERE id=?',pledgeId)
 if(!pledge)fail('NOT_FOUND','That pledge does not exist.',404)
 await commit(c,[guard(`EXISTS(SELECT 1 FROM cf_pledges p JOIN cf_donors d ON d.id=p.donor_id AND d.erased_at IS NULL
  JOIN cf_subscriptions s ON s.donor_id=p.donor_id JOIN cf_campaigns cm ON cm.id=s.campaign_id AND cm.fund=p.fund
  WHERE p.id=? AND p.version=? AND s.id=? AND s.status IN ('active','trialing','past_due')
  AND EXISTS(SELECT 1 FROM cf_pledge_installments i WHERE i.pledge_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM cf_pledge_plans l WHERE l.pledge_id=p.id OR l.subscription_id=s.id))`,
  'PLEDGE_PLAN','Choose an unlinked current plan for this donor and fund, and refresh a changed pledge.',pledgeId,version,subscriptionId),
  sql('INSERT INTO cf_pledge_plans(pledge_id,subscription_id,created_at,created_by) VALUES(?,?,?,?)',pledgeId,subscriptionId,c.now,c.actor.name),
  sql('UPDATE cf_pledges SET version=version+1 WHERE id=?',pledgeId),event(c,'pledge.linkPlan','pledge',pledgeId,pledge.donor_id,{subscriptionId})])
 return {id:pledgeId,subscriptionId}
}

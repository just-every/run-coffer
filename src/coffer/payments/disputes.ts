import { one, sql, type Row } from '../db'
import type { GivingEnv } from '../giving/stripe'
import { stripeId } from './stripe-data'
import { syncCharge } from './charges'
import { paymentWrite } from './write'

export async function recordDispute(env: GivingEnv, dispute: Row) {
 const chargeId=stripeId(dispute.charge),charge=await syncCharge(env,chargeId)
 if(!charge)return
 const prior=await one({db:env.DB},'SELECT * FROM cf_payment_disputes WHERE id=?',dispute.id)
 const detail=dispute.evidence_details??{},due=Number.isSafeInteger(detail.due_by)&&detail.due_by>0?new Date(detail.due_by*1000).toISOString():null
 const now=new Date().toISOString(),status=typeof dispute.status==='string'?dispute.status:'unknown'
 await paymentWrite(env,[sql(`INSERT INTO cf_payment_disputes(id,gift_id,charge_id,status,evidence_due_at,has_evidence,past_due,updated_at) VALUES(?,?,?,?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET status=excluded.status,evidence_due_at=excluded.evidence_due_at,has_evidence=excluded.has_evidence,past_due=excluded.past_due,updated_at=excluded.updated_at`,dispute.id,charge.gift_id,chargeId,status,due,typeof detail.has_evidence==='boolean'?Number(detail.has_evidence):null,typeof detail.past_due==='boolean'?Number(detail.past_due):null,now),
 ...(prior?.status!==status?[sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) SELECT ?,'stripe','Stripe','agent','payments.dispute','dispute',?,g.donor_id,? FROM cf_gifts g WHERE g.id=?`,now,dispute.id,JSON.stringify({status,evidenceDueAt:due}),charge.gift_id)]:[])])
}

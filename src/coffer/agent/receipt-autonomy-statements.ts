import { manager } from '../auth'
import { automationContext, automationRecords, claimAutomation } from '../automation-grants'
import { all, commit, event, fail, guard, id, integer, one, type Context, type Row } from '../db'
import { deliveryCommand } from '../letter-delivery'

/** Accepted-but-undelivered is not permission to submit a second email.
 * Bounces, unknown submissions and unapproved statements stay with a person. */
export async function receiptStatementRecovery(c:Context) {
 const scope=automationRecords(c,'a.donor_id')
 const rows=await all(c,`SELECT a.id,a.batch_id,a.donor_id,a.recipient_name,a.delivery_status,a.route,a.void_reason,b.version,b.status,b.statement_year,
 EXISTS(SELECT 1 FROM cf_approvals p WHERE p.subject_kind='acknowledgements' AND p.subject_id=b.id AND p.content_hash=b.content_hash AND p.approved_by_role IN ('owner','admin','member')) AS approved
 FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id JOIN cf_donors d ON d.id=a.donor_id
 WHERE b.kind='statement' AND b.status<>'discarded' AND d.erased_at IS NULL AND a.delivered_at IS NULL AND a.printed_at IS NULL AND ${scope.sql} ORDER BY b.prepared_at,a.position LIMIT 500`,...scope.params)
 return rows.map(r=>({...r,recoverable:!!r.approved&&['approved','exported'].includes(r.status)&&r.route==='pending'&&!r.void_reason,
 reason:r.void_reason?'Statement needs correction':!r.approved?'Statement needs human approval':r.route==='pending'?'Approved statement awaiting dispatch':['submitted','sending','uncertain'].includes(r.delivery_status)?'Check provider delivery; do not resend an accepted or uncertain message':'Delivery failed: correct the address or arrange mailing'}))
}
/** The explicit admin action sends only already approved, never-submitted
 * documents through the native sender. It cannot confer standing year-end authority. */
export async function recoverReceiptStatement(original:Context,p:Row) {
 if(!manager(original.actor))fail('FORBIDDEN','Only an owner or admin recovers approved statements.',403)
 if(!original.env)fail('MAIL_UNAVAILABLE','Receipt sending is unavailable.',503)
 const batchId=id(p.batchId,'Batch'),version=integer(Number(p.version),'Version',1)
 const builtin=await automationContext(original.env,'receipts',original.now)
 if(!builtin)fail('GRANT_DISABLED','Receipt automation is stopped.',403)
 const approved=await one(original,`SELECT b.id FROM cf_ack_batches b JOIN cf_approvals p ON p.subject_id=b.id AND p.subject_kind='acknowledgements' AND p.content_hash=b.content_hash WHERE b.id=? AND b.kind='statement' AND b.status IN ('approved','exported') AND p.approved_by_role IN ('owner','admin','member')`,batchId)
 if(!approved)fail('NOT_APPROVED','A person must approve the exact year-end statement before recovery.')
 const scope=automationRecords(builtin,'a.donor_id')
 const c:Context={...original,authority:{sql:`(${original.authority.sql}) AND (${builtin.authority.sql}) AND EXISTS(SELECT 1 FROM cf_ack_batches b JOIN cf_approvals p ON p.subject_id=b.id AND p.subject_kind='acknowledgements' AND p.content_hash=b.content_hash WHERE b.id=? AND b.kind='statement' AND b.status IN ('approved','exported') AND p.approved_by_role IN ('owner','admin','member')) AND NOT EXISTS(SELECT 1 FROM cf_acks a WHERE a.batch_id=? AND NOT (${scope.sql}))`,params:[...original.authority.params,...builtin.authority.params,batchId,batchId,...scope.params]}}
 const pending=await one(c,"SELECT count(*) AS n FROM cf_acks WHERE batch_id=? AND route='pending' AND void_reason IS NULL",batchId)
 if(!pending?.n)fail('NOTHING_DUE','No approved, never-submitted statement is waiting for dispatch.')
 await commit(c,[guard("EXISTS(SELECT 1 FROM cf_ack_batches WHERE id=? AND version=?)",'VERSION','Statement changed. Refresh.',batchId,version)])
 await claimAutomation(builtin,'receipts.prepare',Math.min(8,pending.n))
 await commit(c,[event(c,'agent.receipts.statementRecovery','acknowledgements',batchId,null,{grantId:'automation:receipts',grantVersion:builtin.automation.version})])
 return deliveryCommand(c,'ack.send',{batchId,version})
}

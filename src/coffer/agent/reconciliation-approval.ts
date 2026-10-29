import { manager } from '../auth'
import { all, commit, fail, guard, one, sql, event, type Context, type Row } from '../db'

export const approvalFingerprint = (issue: Row, action: string) => action === 'undo' ? issue.activity_id : issue.fingerprint
const approvalSql = `EXISTS(SELECT 1 FROM cf_reconciliation_approvals a JOIN oa_operators o ON o.id=a.approved_by
 JOIN cf_agent_issues i ON i.id=a.issue_id WHERE a.issue_id=? AND a.action=? AND a.fingerprint=?
 AND o.status='active' AND o.version=a.approver_version AND o.role IN ('owner','admin')
 AND ((a.action='apply' AND i.state='open' AND i.fingerprint=a.fingerprint)
 OR (a.action='undo' AND i.state='applied' AND i.activity_id=a.fingerprint)))`

export async function currentFinanceApprovals(c: Context, issueIds: string[]) {
 return all(c, `SELECT a.issue_id,a.approved_by,a.approved_at FROM cf_reconciliation_approvals a
 JOIN oa_operators o ON o.id=a.approved_by JOIN cf_agent_issues i ON i.id=a.issue_id
 WHERE a.issue_id IN (SELECT value FROM json_each(?)) AND o.status='active'
 AND o.version=a.approver_version AND o.role IN ('owner','admin')
 AND ((a.action='apply' AND i.state='open' AND i.fingerprint=a.fingerprint)
 OR (a.action='undo' AND i.state='applied' AND i.activity_id=a.fingerprint))`, JSON.stringify(issueIds))
}

/** Every nested native write must retain current approval, including gift sync. */
export async function financeApprovedContext(c: Context, issue: Row, action: string): Promise<Context> {
 const params = [issue.id, action, approvalFingerprint(issue, action)]
 await commit(c, [guard(approvalSql, 'FINANCE_APPROVAL', 'The exact correction needs a current finance-lead approval before it can run.', ...params)])
 return { ...c, authority: { sql: `(${c.authority.sql}) AND (${approvalSql})`, params: [...c.authority.params, ...params] } }
}

export async function recordFinanceApproval(c: Context, issue: Row, action: string) {
 if (!manager(c.actor)) fail('FORBIDDEN', 'Only a current owner or admin acting as finance lead can approve a correction.', 403)
 const operator = await one(c, 'SELECT version FROM oa_operators WHERE id=?', c.actor.id)
 if (!operator) fail('FORBIDDEN', 'Sign in with a current owner or admin account.', 403)
 const fingerprint = approvalFingerprint(issue, action)
 await commit(c, [guard('EXISTS(SELECT 1 FROM cf_agent_issues WHERE id=? AND state=? AND fingerprint=? AND COALESCE(activity_id,\'\')=?)', 'ISSUE_CHANGED', 'This correction changed. Review it again.', issue.id, issue.state, issue.fingerprint, issue.activity_id ?? ''),
  sql(`INSERT INTO cf_reconciliation_approvals VALUES(?,?,?,?,?,?) ON CONFLICT(issue_id,action) DO UPDATE SET fingerprint=excluded.fingerprint,approved_by=excluded.approved_by,approver_version=excluded.approver_version,approved_at=excluded.approved_at`, issue.id, action, fingerprint, c.actor.id, operator.version, c.now),
  event(c, 'reconciliation.approved', 'agent', issue.id, null, { action, fingerprint, financeLead: true, approverVersion: operator.version })])
 return { id: issue.id, action, fingerprint, approvedBy: c.actor.id }
}

-- Approval records retain exact correction provenance, never sign-in authority.
CREATE TABLE cf_reconciliation_approvals (
 issue_id TEXT NOT NULL REFERENCES cf_agent_issues(id),
 action TEXT NOT NULL CHECK(action IN ('apply','undo')),
 fingerprint TEXT NOT NULL,
 approved_by TEXT NOT NULL,
 approver_version INTEGER NOT NULL,
 approved_at TEXT NOT NULL,
 PRIMARY KEY(issue_id,action)
);

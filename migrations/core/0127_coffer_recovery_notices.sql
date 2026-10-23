-- A never-configured policy preserves GIVE-006's existing single notice.
-- Any explicit configuration, including off, takes over that send boundary.
CREATE TABLE cf_recovery_notice_policy (
 id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 major_cents INTEGER NOT NULL DEFAULT 100000 CHECK(major_cents>0),
 approved_by TEXT,approver_version INTEGER,approved_at TEXT
);
INSERT INTO cf_recovery_notice_policy(id) VALUES(1);
CREATE TABLE cf_recovery_permissions (
 donor_id TEXT PRIMARY KEY REFERENCES cf_donors(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>0),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 channel TEXT NOT NULL CHECK(channel IN ('email','mail','phone')),
 interval_days INTEGER NOT NULL CHECK(interval_days BETWEEN 1 AND 365),
 max_notices INTEGER NOT NULL CHECK(max_notices BETWEEN 1 AND 12),
 source_on TEXT NOT NULL,evidence TEXT NOT NULL,recorded_by TEXT NOT NULL,recorded_at TEXT NOT NULL
);
CREATE TABLE cf_recovery_steps (
 id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL,
 subscription_id TEXT NOT NULL REFERENCES cf_subscriptions(id) ON DELETE CASCADE,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('failure','expiry')),
 ordinal INTEGER NOT NULL CHECK(ordinal>0),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 state TEXT NOT NULL CHECK(state IN ('prepared','held','awaiting_approval','sending','sent','uncertain','completed','closed','stopped')),
 reason TEXT,channel TEXT NOT NULL,amount_cents INTEGER NOT NULL,baseline_cents INTEGER NOT NULL,
 due_on TEXT NOT NULL,created_at TEXT NOT NULL,case_started_at TEXT NOT NULL,
 subject TEXT NOT NULL,body TEXT NOT NULL,content_hash TEXT NOT NULL,
 policy_version INTEGER NOT NULL,permission_version INTEGER NOT NULL,consent_id INTEGER,
 recipient_email TEXT,donor_version INTEGER NOT NULL,major_review INTEGER NOT NULL,
 sent_at TEXT,recovered_at TEXT,claimed_at TEXT,claim_id TEXT,
 approved_by TEXT,approver_version INTEGER,approved_at TEXT,
 evidence TEXT NOT NULL CHECK(json_valid(evidence)),completion_evidence TEXT,
 UNIQUE(invoice_id,ordinal)
);
CREATE INDEX cf_recovery_steps_donor ON cf_recovery_steps(donor_id,claimed_at,sent_at);
CREATE TABLE cf_recovery_closures (
 invoice_id TEXT PRIMARY KEY,closed_at TEXT NOT NULL,reason TEXT NOT NULL,closed_by TEXT NOT NULL
);
-- Donor-specific contact permission never transfers automatically on a merge.
CREATE TRIGGER cf_recovery_notice_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_recovery_steps WHERE donor_id=NEW.id;
 DELETE FROM cf_recovery_permissions WHERE donor_id=NEW.id;
END;
CREATE TRIGGER cf_recovery_notice_reassignment AFTER UPDATE OF donor_id ON cf_subscriptions
WHEN OLD.donor_id<>NEW.donor_id
BEGIN
 UPDATE cf_recovery_steps SET state='closed',reason='Plan moved to another donor; new permission required',version=version+1
 WHERE subscription_id=NEW.id AND state IN ('prepared','held','awaiting_approval');
END;

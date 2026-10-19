CREATE TABLE cf_grants (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 program TEXT NOT NULL,
 requested_cents INTEGER NOT NULL CHECK(requested_cents>0),
 loi_due_on TEXT NOT NULL,
 proposal_due_on TEXT NOT NULL,
 report_due_on TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','loi_submitted','proposal_submitted','declined','withdrawn','awarded')),
 status_on TEXT,
 status_evidence TEXT,
 loi_submitted_on TEXT,
 proposal_submitted_on TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 pledge_id TEXT UNIQUE REFERENCES cf_pledges(id),
 awarded_on TEXT,
 award_evidence TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX cf_grants_donor ON cf_grants(donor_id);
CREATE TABLE cf_grant_documents (
 id TEXT PRIMARY KEY,
 grant_id TEXT NOT NULL REFERENCES cf_grants(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 file_name TEXT NOT NULL,
 media_type TEXT NOT NULL CHECK(media_type IN ('application/pdf','text/plain')),
 content_base64 TEXT NOT NULL,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL
);
CREATE TABLE cf_grant_tasks (
 id TEXT PRIMARY KEY,
 grant_id TEXT NOT NULL REFERENCES cf_grants(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 due_on TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
 version INTEGER NOT NULL DEFAULT 1,
 completed_on TEXT,
 completed_by TEXT,
 notes TEXT,
 UNIQUE(grant_id,due_on,title)
);
CREATE TRIGGER cf_grant_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
BEGIN
 DELETE FROM cf_grants WHERE donor_id=NEW.id;
END;

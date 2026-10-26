-- Auction source custody is separate from charitable contributions. A purchase
-- never enters cf_gifts; a partly deductible payment retains its entire price.
CREATE TABLE cf_auction_jobs (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES cf_fundraising_events(id),
 source TEXT NOT NULL, source_hash TEXT NOT NULL, source_csv TEXT,
 received_on TEXT NOT NULL, campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id),
 fund TEXT NOT NULL, appeal TEXT NOT NULL REFERENCES cf_appeal_codes(code),
 state TEXT NOT NULL CHECK(state IN ('preview','applied','undoing','undone','redacted')),
 version INTEGER NOT NULL DEFAULT 1, fingerprint TEXT NOT NULL,
 created_at TEXT NOT NULL, created_by TEXT NOT NULL, applied_at TEXT, undone_at TEXT
);
CREATE UNIQUE INDEX cf_auction_same_source ON cf_auction_jobs(event_id,source,source_hash) WHERE state<>'undone';
CREATE TABLE cf_auction_rows (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES cf_auction_jobs(id),
 position INTEGER NOT NULL, source_row INTEGER NOT NULL, lot TEXT NOT NULL, item TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('lot','fund_a_need','donated_item')),
 bidder_key TEXT NOT NULL, bidder_name TEXT, bidder_email TEXT,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), fair_value_cents INTEGER CHECK(fair_value_cents>=0),
 paid INTEGER NOT NULL CHECK(paid IN (0,1)), quantity TEXT NOT NULL DEFAULT '1',
 stated_value_cents INTEGER NOT NULL DEFAULT 0 CHECK(stated_value_cents>=0), property_goods TEXT NOT NULL DEFAULT 'unknown' CHECK(property_goods IN ('unknown','none')),
 donor_id TEXT REFERENCES cf_donors(id), donor_version INTEGER, planned_donor_id TEXT,
 decision TEXT NOT NULL CHECK(decision IN ('unreviewed','match','create')),
 candidates TEXT NOT NULL CHECK(json_valid(candidates)), match_reason TEXT,
 status TEXT NOT NULL CHECK(status IN ('preview','held','gift','purchase','open','property','undone')),
 gift_id TEXT REFERENCES cf_gifts(id) ON DELETE SET NULL, property_id TEXT REFERENCES cf_in_kind_gifts(id) ON DELETE SET NULL,
 version INTEGER NOT NULL DEFAULT 1, applied_version INTEGER, received_on TEXT,
 reviewed_by TEXT, reviewed_at TEXT, gift_snapshot TEXT, property_snapshot TEXT, UNIQUE(job_id,position)
);
CREATE INDEX cf_auction_row_donor ON cf_auction_rows(donor_id);
CREATE INDEX cf_auction_row_job ON cf_auction_rows(job_id,position);
CREATE TABLE cf_auction_claims (
 event_id TEXT NOT NULL REFERENCES cf_fundraising_events(id), source TEXT NOT NULL,
 lot_key TEXT NOT NULL, row_id TEXT NOT NULL UNIQUE REFERENCES cf_auction_rows(id),
 PRIMARY KEY(event_id,source,lot_key)
);
CREATE TABLE cf_auction_donors (
 job_id TEXT NOT NULL REFERENCES cf_auction_jobs(id), donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), contacts_snapshot TEXT NOT NULL CHECK(json_valid(contacts_snapshot)), PRIMARY KEY(job_id,donor_id)
);
-- Property remains immutable. The only deletion exception is an untouched
-- original owned by the auction transaction which is presently being undone.
DROP TRIGGER cf_in_kind_no_delete;
CREATE TRIGGER cf_in_kind_no_delete BEFORE DELETE ON cf_in_kind_gifts
WHEN NOT EXISTS(SELECT 1 FROM cf_auction_rows r JOIN cf_auction_jobs j ON j.id=r.job_id
 WHERE r.property_id=OLD.id AND j.state='undoing' AND OLD.version=1 AND OLD.property_version=1
 AND OLD.disposed_on IS NULL AND NOT EXISTS(SELECT 1 FROM cf_in_kind_acknowledgments WHERE in_kind_id=OLD.id)
 AND NOT EXISTS(SELECT 1 FROM cf_in_kind_revisions WHERE in_kind_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'COFFER_IN_KIND_IMMUTABLE'); END;

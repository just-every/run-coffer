-- Uploaded sources share the private donor-review lifecycle without Stripe objects.
ALTER TABLE cf_payment_donor_matches ADD COLUMN provider TEXT NOT NULL DEFAULT 'stripe';
CREATE TABLE cf_platform_batches (
 id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider='benevity'),
 fingerprint TEXT NOT NULL, file_hash TEXT NOT NULL, source_key TEXT,
 version INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL CHECK(state IN ('held','review','recorded','erased')),
 source_csv TEXT, mapping TEXT NOT NULL, controls TEXT NOT NULL, issues TEXT NOT NULL,
 payout_id TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX cf_platform_disbursement ON cf_platform_batches(source_key) WHERE source_key IS NOT NULL;
CREATE TABLE cf_platform_sources (
 source_id TEXT PRIMARY KEY REFERENCES cf_payment_donor_matches(charge_id),
 batch_id TEXT NOT NULL REFERENCES cf_platform_batches(id),
 facts_hash TEXT NOT NULL, gift_id TEXT REFERENCES cf_gifts(id),
 row_number INTEGER NOT NULL, evidence TEXT
);
CREATE INDEX cf_platform_source_batch ON cf_platform_sources(batch_id);

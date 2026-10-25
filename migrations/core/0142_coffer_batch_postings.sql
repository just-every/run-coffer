-- A submitted offline deposit retains the same claim and approval custody as a payout.
CREATE TABLE cf_batch_postings (
 batch_id TEXT PRIMARY KEY REFERENCES cf_gift_batches(id), state TEXT NOT NULL,
 external_id TEXT, destination TEXT NOT NULL, posted_at TEXT, proposal_id TEXT,
 payload_hash TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL
);

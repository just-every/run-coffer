-- Permanent local preparation receipts; no automatic expiry or provider claims.
CREATE TABLE cf_mcp_preparations (
 principal TEXT NOT NULL,
 key_hash TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 grant_id TEXT NOT NULL,
 tool TEXT NOT NULL CHECK(tool IN ('ack.prepare','appeal.prepare')),
 result_id TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(json_valid(outcome)),
 donor_ids TEXT NOT NULL CHECK(json_valid(donor_ids)),
 created_at TEXT NOT NULL,
 unavailable INTEGER NOT NULL DEFAULT 0 CHECK(unavailable IN (0,1)),
 PRIMARY KEY(principal,key_hash)
);

-- Erasure keeps the key tombstone to prevent another effect, without retaining
-- the frozen aggregate or its donor references in this private replay cache.
CREATE TRIGGER cf_mcp_preparation_erasure BEFORE DELETE ON cf_donors BEGIN
 UPDATE cf_mcp_preparations SET unavailable=1,outcome='{}',donor_ids='[]'
 WHERE EXISTS(SELECT 1 FROM json_each(donor_ids) WHERE value=OLD.id);
END;
CREATE TRIGGER cf_mcp_preparation_erased_update AFTER UPDATE OF erased_at ON cf_donors
WHEN NEW.erased_at IS NOT NULL BEGIN
 UPDATE cf_mcp_preparations SET unavailable=1,outcome='{}',donor_ids='[]'
 WHERE EXISTS(SELECT 1 FROM json_each(donor_ids) WHERE value=OLD.id);
END;

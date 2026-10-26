-- Public integration credentials are distinct from agent preparation keys.
ALTER TABLE cf_pledges ADD COLUMN api_review_required INTEGER NOT NULL DEFAULT 0 CHECK(api_review_required IN (0,1));

CREATE TABLE cf_api_keys (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 label TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('read-only','gift-entry','full')),
 created_by TEXT NOT NULL REFERENCES oa_operators(id),
 creator_version INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER,
 revoked_by TEXT REFERENCES oa_operators(id),
 CHECK(expires_at>created_at)
);
CREATE INDEX cf_api_keys_creator ON cf_api_keys(created_by);
-- One bounded row per principal; atomic updates serialize competing requests.
CREATE TABLE cf_api_rate_windows (
 principal TEXT PRIMARY KEY,
 minute INTEGER NOT NULL,
 attempts INTEGER NOT NULL
);
-- Identifier-only durable receipts. No token, request, response body or donor
-- contact data. No expiry: a delayed retry must not create a second gift.
CREATE TABLE cf_api_idempotency (
 principal TEXT NOT NULL,
 key_hash TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 result_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(principal,key_hash)
);

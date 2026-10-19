-- An absent row means the published default policy (version 1). Keeping the
-- table empty initially also lets a fresh installation restore a saved policy.
CREATE TABLE cf_engagement_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 version INTEGER NOT NULL CHECK(version>=2),
 recency INTEGER NOT NULL CHECK(recency BETWEEN 0 AND 100),
 frequency INTEGER NOT NULL CHECK(frequency BETWEEN 0 AND 100),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 100),
 conversations INTEGER NOT NULL CHECK(conversations BETWEEN 0 AND 100),
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 CHECK(recency+frequency+amount+conversations=100)
);

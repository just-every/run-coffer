CREATE TABLE cf_sending_domain (
 id INTEGER PRIMARY KEY CHECK(id=1),
 version INTEGER NOT NULL CHECK(version>0),
 provider TEXT NOT NULL CHECK(provider='sendgrid'),
 mail_from TEXT NOT NULL,
 domain TEXT NOT NULL,
 configuration_hash TEXT NOT NULL,
 authentication_id INTEGER NOT NULL CHECK(authentication_id>0),
 records TEXT NOT NULL CHECK(json_valid(records)),
 status TEXT NOT NULL CHECK(status IN ('pending','verified')),
 checked_at TEXT,
 verified_at TEXT,
 configured_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK(status!='verified' OR (checked_at IS NOT NULL AND verified_at IS NOT NULL))
);

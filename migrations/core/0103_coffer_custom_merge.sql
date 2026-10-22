ALTER TABLE cf_settings ADD COLUMN greeting TEXT NOT NULL DEFAULT 'Friend';
CREATE TABLE cf_custom_fields (
 key TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('constituent','gift','interaction')),
 type TEXT NOT NULL CHECK(type IN ('text','number','currency','date','year','checkbox')),
 entry TEXT NOT NULL CHECK(entry IN ('free-form','pick-one','pick-many')), choices TEXT NOT NULL DEFAULT '[]',
 version INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE cf_custom_values (
 field_key TEXT NOT NULL REFERENCES cf_custom_fields(key), record_id TEXT NOT NULL, donor_id TEXT NOT NULL,
 value TEXT NOT NULL, version INTEGER NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(field_key,record_id)
);
CREATE TABLE cf_custom_value_history (
 field_key TEXT NOT NULL, record_id TEXT NOT NULL, donor_id TEXT NOT NULL, version INTEGER NOT NULL,
 value TEXT NOT NULL, source TEXT NOT NULL, recorded_at TEXT NOT NULL, actor_id TEXT NOT NULL,
 PRIMARY KEY(field_key,record_id,version)
);

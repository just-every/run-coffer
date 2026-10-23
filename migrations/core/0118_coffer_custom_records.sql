CREATE TABLE cf_custom_fields_next (
 key TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('constituent','gift','pledge','opportunity','interaction','note')),
 type TEXT NOT NULL CHECK(type IN ('text','number','currency','date','year','checkbox')),
 entry TEXT NOT NULL CHECK(entry IN ('free-form','pick-one','pick-many')), choices TEXT NOT NULL DEFAULT '[]',
 version INTEGER NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO cf_custom_fields_next SELECT * FROM cf_custom_fields;
CREATE TABLE cf_custom_values_next (
 field_key TEXT NOT NULL REFERENCES cf_custom_fields_next(key), record_id TEXT NOT NULL, donor_id TEXT NOT NULL,
 value TEXT NOT NULL, version INTEGER NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(field_key,record_id)
);
INSERT INTO cf_custom_values_next SELECT * FROM cf_custom_values;
DROP TABLE cf_custom_values;
DROP TABLE cf_custom_fields;
ALTER TABLE cf_custom_fields_next RENAME TO cf_custom_fields;
ALTER TABLE cf_custom_values_next RENAME TO cf_custom_values;
CREATE TABLE cf_tag_categories(name TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE cf_tag_definitions(name TEXT PRIMARY KEY,category TEXT REFERENCES cf_tag_categories(name),version INTEGER NOT NULL DEFAULT 1);
INSERT OR IGNORE INTO cf_tag_definitions(name) SELECT tag FROM cf_donor_tags UNION SELECT tag FROM cf_donor_rule_tags;
ALTER TABLE cf_batch_entries ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';

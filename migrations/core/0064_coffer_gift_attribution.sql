-- GIFT-003: appeals are defined records a gift references by code, and a gift's
-- channel is one of five kinds. Free-text appeals already held become defined appeals.
CREATE TABLE cf_appeal_codes (
 code TEXT PRIMARY KEY COLLATE NOCASE CHECK(length(trim(code)) BETWEEN 1 AND 200 AND code=trim(code)),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 origin TEXT NOT NULL CHECK(origin IN ('staff','import')),
 created_at TEXT NOT NULL
);
INSERT INTO cf_appeal_codes(code,name,origin,created_at)
 SELECT trim(appeal),trim(appeal),'import',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM cf_gift_appeals WHERE length(trim(appeal))>0 GROUP BY trim(appeal) COLLATE NOCASE;
UPDATE cf_gift_appeals SET appeal=(SELECT code FROM cf_appeal_codes WHERE code=trim(cf_gift_appeals.appeal));
-- Every door that names a gift's appeal (entry, online, CRM move-in, Stripe import) lands on a defined appeal.
CREATE TRIGGER cf_gift_appeal_defined BEFORE INSERT ON cf_gift_appeals
BEGIN
 SELECT RAISE(ABORT,'appeal code must be trimmed and non-empty') WHERE NEW.appeal IS NULL OR length(trim(NEW.appeal))=0 OR NEW.appeal<>trim(NEW.appeal);
 INSERT INTO cf_appeal_codes(code,name,origin,created_at) SELECT NEW.appeal,NEW.appeal,'import',strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM cf_appeal_codes WHERE code=NEW.appeal);
END;
CREATE TRIGGER cf_gift_appeal_redefined BEFORE UPDATE OF appeal ON cf_gift_appeals
BEGIN
 SELECT RAISE(ABORT,'appeal code must be trimmed and non-empty') WHERE NEW.appeal IS NULL OR length(trim(NEW.appeal))=0 OR NEW.appeal<>trim(NEW.appeal);
 INSERT INTO cf_appeal_codes(code,name,origin,created_at) SELECT NEW.appeal,NEW.appeal,'import',strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM cf_appeal_codes WHERE code=NEW.appeal);
END;
CREATE TABLE cf_gift_channels (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('form','event','mail','email','text'))
);
ALTER TABLE cf_giving_intents ADD COLUMN appeal TEXT;

-- Property and donor-stated internal values never enter cf_gifts or cash totals.
CREATE TABLE cf_in_kind_gifts (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 description TEXT NOT NULL,
 quantity TEXT NOT NULL,
 stated_value_cents INTEGER NOT NULL CHECK(stated_value_cents>=0),
 received_on TEXT NOT NULL,
 original_received_on TEXT NOT NULL,
 goods TEXT NOT NULL CHECK(goods IN ('unknown','none','provided','intangible religious benefits')),
 goods_description TEXT,
 goods_cents INTEGER NOT NULL DEFAULT 0 CHECK(goods_cents>=0),
 form_8283 TEXT NOT NULL DEFAULT 'unknown' CHECK(form_8283 IN ('unknown','section_b','not_section_b')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 property_version INTEGER NOT NULL DEFAULT 1 CHECK(property_version>0),
 disposed_on TEXT,
 disposal_method TEXT CHECK(disposal_method IN ('sold','exchanged','consumed','distributed','otherwise disposed')),
 disposal_exception TEXT CHECK(disposal_exception IN ('none','donor-certified-500','charitable-use')),
 disposal_evidence TEXT,
 became_aware_on TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX cf_in_kind_donor ON cf_in_kind_gifts(donor_id);
CREATE TABLE cf_in_kind_acknowledgments (
 id TEXT PRIMARY KEY,
 in_kind_id TEXT NOT NULL REFERENCES cf_in_kind_gifts(id) ON DELETE CASCADE,
 property_version INTEGER NOT NULL CHECK(property_version>0),
 acknowledged_on TEXT NOT NULL,
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(in_kind_id,property_version)
);
CREATE INDEX cf_in_kind_ack_property ON cf_in_kind_acknowledgments(in_kind_id);

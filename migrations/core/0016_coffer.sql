-- Coffer: donors and households, consent history, immutable gift ledger lines
-- in integer cents, pledges, acknowledgement letters, consent-checked appeals,
-- frozen approvals, an audit trail and agent preparation keys.

CREATE TABLE cf_settings (
 id INTEGER PRIMARY KEY CHECK(id = 1),
 version INTEGER NOT NULL CHECK(version > 0),
 organisation TEXT NOT NULL,
 ein TEXT NOT NULL,
 timezone TEXT NOT NULL,
 threshold_cents INTEGER NOT NULL CHECK(threshold_cents >= 0),
 target_days INTEGER NOT NULL CHECK(target_days BETWEEN 1 AND 365),
 letter_subject TEXT NOT NULL,
 letter_template TEXT NOT NULL,
 none_statement TEXT NOT NULL,
 goods_statement TEXT NOT NULL,
 reviewed_at TEXT,
 reviewed_by TEXT
);
INSERT INTO cf_settings VALUES (1, 1, '', '', 'America/New_York', 25000, 14,
 'Thank you for your gift to {{organization}}',
 '{{date}}

Dear {{donor_name}},

Thank you for your gift of {{amount}} to {{organization}}, received on {{gift_date}} for {{fund}}.

{{goods_statement}}

{{organization}} is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. Our EIN is {{ein}}. Please keep this letter for your records.

With gratitude,
{{organization}}',
 'No goods or services were provided in exchange for this contribution.',
 'In exchange for this contribution you received {{goods_description}}, with an estimated fair market value of {{goods_value}}. The amount of your contribution that may be deductible is limited to the excess of your contribution over that value: {{deductible_amount}}.',
 NULL, NULL);

CREATE TABLE cf_households (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX cf_household_name ON cf_households(lower(name));

CREATE TABLE cf_donors (
 id TEXT PRIMARY KEY,
 version INTEGER NOT NULL CHECK(version > 0),
 name TEXT NOT NULL,
 email TEXT,
 phone TEXT,
 address_line1 TEXT,
 address_line2 TEXT,
 city TEXT,
 region TEXT,
 postal_code TEXT,
 country TEXT,
 household_id TEXT REFERENCES cf_households(id),
 source TEXT NOT NULL CHECK(source IN ('manual','stripe')),
 source_ref TEXT,
 created_at TEXT NOT NULL,
 erased_at TEXT
);
CREATE UNIQUE INDEX cf_donor_email ON cf_donors(email) WHERE email IS NOT NULL;
CREATE INDEX cf_donor_name ON cf_donors(lower(name));
CREATE INDEX cf_donor_household ON cf_donors(household_id);

CREATE TABLE cf_pledges (
 id TEXT PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 pledged_on TEXT NOT NULL,
 due_by TEXT,
 fund TEXT NOT NULL,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL
);
CREATE INDEX cf_pledge_donor ON cf_pledges(donor_id);

-- A gift is an immutable ledger line. A refund or correction is a negative
-- reversal line; amounts, dates and references never change. Only the
-- goods-or-services fact of an imported gift may move once from unknown, and
-- erasure may clear the free-text note and move the line to the anonymous
-- placeholder that replaces an erased donor.
CREATE TABLE cf_gifts (
 id TEXT PRIMARY KEY,
 version INTEGER NOT NULL CHECK(version > 0),
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 kind TEXT NOT NULL CHECK(kind IN ('gift','reversal')),
 reverses TEXT UNIQUE REFERENCES cf_gifts(id),
 received_on TEXT NOT NULL,
 amount_cents INTEGER NOT NULL,
 method TEXT NOT NULL,
 reference TEXT,
 fund TEXT NOT NULL,
 pledge_id TEXT REFERENCES cf_pledges(id),
 goods TEXT NOT NULL CHECK(goods IN ('none','provided','unknown')),
 goods_cents INTEGER NOT NULL CHECK(goods_cents >= 0),
 goods_description TEXT,
 note TEXT,
 source TEXT NOT NULL CHECK(source IN ('manual','stripe')),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 CHECK((kind = 'gift' AND amount_cents > 0 AND reverses IS NULL) OR (kind = 'reversal' AND amount_cents < 0 AND reverses IS NOT NULL)),
 CHECK(goods_cents <= abs(amount_cents)),
 CHECK(goods = 'provided' OR goods_cents = 0)
);
CREATE INDEX cf_gift_donor ON cf_gifts(donor_id, received_on);
CREATE INDEX cf_gift_received ON cf_gifts(received_on);
CREATE UNIQUE INDEX cf_gift_reference ON cf_gifts(source, reference) WHERE reference IS NOT NULL AND kind = 'gift';
CREATE TRIGGER cf_gift_immutable BEFORE UPDATE ON cf_gifts
WHEN NEW.id IS NOT OLD.id OR (NEW.donor_id IS NOT OLD.donor_id AND NOT EXISTS(SELECT 1 FROM cf_donors WHERE id = NEW.donor_id AND erased_at IS NOT NULL)) OR NEW.kind IS NOT OLD.kind OR NEW.reverses IS NOT OLD.reverses
 OR NEW.received_on IS NOT OLD.received_on OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.method IS NOT OLD.method
 OR NEW.reference IS NOT OLD.reference OR NEW.fund IS NOT OLD.fund OR NEW.pledge_id IS NOT OLD.pledge_id
 OR NEW.source IS NOT OLD.source OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
 OR (NEW.note IS NOT OLD.note AND NEW.note IS NOT NULL)
 OR ((NEW.goods IS NOT OLD.goods OR NEW.goods_cents IS NOT OLD.goods_cents OR NEW.goods_description IS NOT OLD.goods_description) AND OLD.goods <> 'unknown')
BEGIN SELECT RAISE(ABORT, 'COFFER_GIFT_IMMUTABLE'); END;

-- Consent is an append-only history per donor and channel; the newest row is
-- the current answer. Rows are removed only when their donor is erased.
CREATE TABLE cf_consents (
 id INTEGER PRIMARY KEY,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 channel TEXT NOT NULL CHECK(channel IN ('email','mail')),
 status TEXT NOT NULL CHECK(status IN ('granted','withdrawn')),
 method TEXT NOT NULL,
 evidence TEXT NOT NULL,
 captured_on TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL
);
CREATE INDEX cf_consent_current ON cf_consents(donor_id, channel, id);
CREATE TRIGGER cf_consent_append_only BEFORE UPDATE ON cf_consents
BEGIN SELECT RAISE(ABORT, 'COFFER_CONSENT_APPEND_ONLY'); END;
CREATE TRIGGER cf_consent_erasure_only BEFORE DELETE ON cf_consents
WHEN NOT EXISTS(SELECT 1 FROM cf_donors WHERE id = OLD.donor_id AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'COFFER_CONSENT_APPEND_ONLY'); END;

-- Acknowledgement letters are frozen when prepared. A batch is approved by a
-- person against its content hash, exported for the charity's own mail and
-- then recorded as sent. A gift sits in at most one live letter.
CREATE TABLE cf_ack_batches (
 id TEXT PRIMARY KEY,
 version INTEGER NOT NULL CHECK(version > 0),
 status TEXT NOT NULL CHECK(status IN ('prepared','approved','exported','sent','discarded')),
 content_hash TEXT NOT NULL,
 letters INTEGER NOT NULL CHECK(letters > 0),
 total_cents INTEGER NOT NULL,
 settings_version INTEGER NOT NULL,
 prepared_by_id TEXT NOT NULL,
 prepared_by_name TEXT NOT NULL,
 prepared_by_role TEXT NOT NULL,
 prepared_at TEXT NOT NULL,
 export_hash TEXT,
 exported_at TEXT,
 exported_by TEXT,
 sent_on TEXT,
 sent_method TEXT,
 sent_recorded_by TEXT,
 discarded_at TEXT
);
CREATE TABLE cf_acks (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES cf_ack_batches(id),
 position INTEGER NOT NULL,
 gift_id TEXT NOT NULL REFERENCES cf_gifts(id),
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 live INTEGER NOT NULL CHECK(live IN (0,1)),
 recipient_name TEXT NOT NULL,
 recipient_email TEXT,
 address TEXT,
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 amount_cents INTEGER NOT NULL,
 received_on TEXT NOT NULL,
 UNIQUE(batch_id, position)
);
CREATE UNIQUE INDEX cf_ack_live_gift ON cf_acks(gift_id) WHERE live = 1;
CREATE INDEX cf_ack_donor ON cf_acks(donor_id);

-- An appeal's audience is frozen with the exact consent row that allowed each
-- recipient; approval and export refuse if any of those answers has changed.
CREATE TABLE cf_appeals (
 id TEXT PRIMARY KEY,
 version INTEGER NOT NULL CHECK(version > 0),
 name TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('email','mail')),
 segment TEXT NOT NULL CHECK(json_valid(segment)),
 excluded TEXT NOT NULL CHECK(json_valid(excluded)),
 status TEXT NOT NULL CHECK(status IN ('prepared','approved','exported','sent','discarded')),
 content_hash TEXT NOT NULL,
 recipients INTEGER NOT NULL CHECK(recipients > 0),
 prepared_by_id TEXT NOT NULL,
 prepared_by_name TEXT NOT NULL,
 prepared_by_role TEXT NOT NULL,
 prepared_at TEXT NOT NULL,
 export_hash TEXT,
 exported_at TEXT,
 exported_by TEXT,
 sent_on TEXT,
 sent_recorded_by TEXT,
 discarded_at TEXT
);
CREATE TABLE cf_appeal_recipients (
 appeal_id TEXT NOT NULL REFERENCES cf_appeals(id),
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 consent_id INTEGER NOT NULL,
 name TEXT NOT NULL,
 email TEXT,
 address TEXT,
 PRIMARY KEY(appeal_id, donor_id)
);
CREATE INDEX cf_appeal_recipient_donor ON cf_appeal_recipients(donor_id);

CREATE TABLE cf_approvals (
 id TEXT PRIMARY KEY,
 subject_kind TEXT NOT NULL CHECK(subject_kind IN ('acknowledgements','appeal')),
 subject_id TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 prepared_by_id TEXT NOT NULL,
 prepared_by_name TEXT NOT NULL,
 prepared_by_role TEXT NOT NULL,
 approved_by_id TEXT NOT NULL,
 approved_by_name TEXT NOT NULL,
 approved_by_role TEXT NOT NULL,
 approved_at TEXT NOT NULL,
 UNIQUE(subject_kind, subject_id)
);
CREATE TRIGGER cf_approval_update BEFORE UPDATE ON cf_approvals BEGIN SELECT RAISE(ABORT, 'COFFER_APPROVAL_FROZEN'); END;
CREATE TRIGGER cf_approval_delete BEFORE DELETE ON cf_approvals BEGIN SELECT RAISE(ABORT, 'COFFER_APPROVAL_FROZEN'); END;

-- Audit trail. Details carry identifiers and amounts, never donor personal data.
CREATE TABLE cf_events (
 id INTEGER PRIMARY KEY,
 at TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 actor_name TEXT NOT NULL,
 actor_role TEXT NOT NULL,
 action TEXT NOT NULL,
 subject_kind TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 donor_id TEXT,
 detail TEXT NOT NULL CHECK(json_valid(detail))
);
CREATE INDEX cf_event_donor ON cf_events(donor_id, id);
CREATE INDEX cf_event_subject ON cf_events(subject_kind, subject_id, id);

-- One-way hashes of erased donors' emails and Stripe customer IDs, so a later
-- move-in never brings an erased person back.
CREATE TABLE cf_erasures (
 hash TEXT PRIMARY KEY,
 erased_at TEXT NOT NULL
);

-- Numeric native revision / opaque import ownership bridge for the move-in kit.
CREATE TABLE cf_import_revisions (
 kind TEXT NOT NULL CHECK(kind IN ('donor','gift')),
 id TEXT NOT NULL,
 import_revision TEXT NOT NULL,
 native_revision INTEGER NOT NULL,
 PRIMARY KEY(kind, id)
);

CREATE TABLE cf_agent_keys (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 label TEXT NOT NULL,
 created_by TEXT NOT NULL,
 creator_version INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER,
 created_at INTEGER NOT NULL
);

CREATE TABLE cf_assert (ok INTEGER NOT NULL CHECK(ok = 1));

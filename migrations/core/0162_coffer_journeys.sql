CREATE TABLE cf_journeys (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger TEXT NOT NULL,
 amount_cents INTEGER, list_id TEXT, event_id TEXT, owner_id TEXT NOT NULL,
 published_at TEXT NOT NULL, published_by TEXT NOT NULL, stopped_at TEXT
);
CREATE TABLE cf_journey_templates (
 journey_id TEXT NOT NULL REFERENCES cf_journeys(id), step TEXT NOT NULL,
 code TEXT NOT NULL REFERENCES cf_journey_step_publications(code),
 kind TEXT NOT NULL CHECK(kind IN ('email','task','wait')),
 is_ask INTEGER NOT NULL CHECK(is_ask IN (0,1)),
 condition TEXT NOT NULL CHECK(condition IN ('always','replied','not_replied')),
 delay_days INTEGER NOT NULL, PRIMARY KEY(journey_id,step)
);
CREATE TABLE cf_journey_enrollments (
 id TEXT PRIMARY KEY, journey_id TEXT NOT NULL REFERENCES cf_journeys(id),
 donor_id TEXT NOT NULL REFERENCES cf_donors(id), gift_id TEXT, gift_ids TEXT NOT NULL,
 enrolled_at TEXT NOT NULL, status TEXT NOT NULL, stopped_at TEXT,
 UNIQUE(journey_id,donor_id)
);
CREATE TABLE cf_journey_steps (
 id TEXT PRIMARY KEY, enrollment_id TEXT NOT NULL REFERENCES cf_journey_enrollments(id) ON DELETE CASCADE,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id), step TEXT NOT NULL,
 response_code TEXT NOT NULL REFERENCES cf_journey_step_publications(code),
 due_at TEXT NOT NULL, status TEXT NOT NULL, note TEXT, claimed_at TEXT,
 message_key TEXT NOT NULL UNIQUE, checked_at TEXT, merge_blanks TEXT NOT NULL DEFAULT '[]',
 UNIQUE(enrollment_id,step)
);
CREATE INDEX cf_journey_due ON cf_journey_steps(status,due_at);
CREATE TABLE cf_journey_policy (id INTEGER PRIMARY KEY CHECK(id=1), cap_days INTEGER NOT NULL CHECK(cap_days BETWEEN 1 AND 365));
INSERT INTO cf_journey_policy VALUES(1,1);
CREATE TABLE cf_journey_slots (
 step_id TEXT PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id), reserved_on TEXT NOT NULL
);
CREATE TRIGGER cf_journeys_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM cf_journey_steps WHERE donor_id=NEW.id;
 DELETE FROM cf_journey_enrollments WHERE donor_id=NEW.id;
 DELETE FROM cf_journey_slots WHERE donor_id=NEW.id;
END;
CREATE TRIGGER cf_journeys_status AFTER UPDATE OF constituent_status ON cf_donors
WHEN NEW.constituent_status<>'active' BEGIN
 UPDATE cf_journey_enrollments SET status=NEW.constituent_status,stopped_at=NEW.status_changed_at WHERE donor_id=NEW.id AND status='active';
 UPDATE cf_journey_steps SET status='cancelled',note='Constituent status changed before submission.' WHERE donor_id=NEW.id AND status='pending';
END;

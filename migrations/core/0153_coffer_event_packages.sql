ALTER TABLE cf_event_ticket_types ADD COLUMN kind TEXT NOT NULL DEFAULT 'single' CHECK(kind IN ('single','table','sponsorship'));
ALTER TABLE cf_event_ticket_types ADD COLUMN seats INTEGER NOT NULL DEFAULT 1 CHECK(seats BETWEEN 0 AND 100);

CREATE TABLE cf_event_questions (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES cf_fundraising_events(id),
 field_key TEXT NOT NULL REFERENCES cf_custom_fields(key), label TEXT NOT NULL,
 required INTEGER NOT NULL CHECK(required IN (0,1)), created_at TEXT NOT NULL,
 UNIQUE(event_id,field_key)
);
CREATE TABLE cf_event_orders (
 intent_id TEXT PRIMARY KEY REFERENCES cf_giving_intents(id), event_id TEXT NOT NULL REFERENCES cf_fundraising_events(id),
 ticket_type_id TEXT NOT NULL REFERENCES cf_event_ticket_types(id), ticket_name TEXT NOT NULL,
 kind TEXT NOT NULL, seats INTEGER NOT NULL, price_cents INTEGER NOT NULL,
 benefit_cents INTEGER NOT NULL, benefit_description TEXT NOT NULL,
 questions_json TEXT NOT NULL, input_hash TEXT, paid_at TEXT, created_at TEXT NOT NULL
);
INSERT INTO cf_event_orders
 SELECT r.intent_id,r.event_id,r.ticket_type_id,t.name,'single',1,r.price_cents,r.benefit_cents,
 r.benefit_description,'[]',NULL,CASE WHEN r.donor_id IS NOT NULL THEN r.created_at ELSE NULL END,r.created_at
 FROM cf_event_registrations r JOIN cf_event_ticket_types t ON t.id=r.ticket_type_id;

CREATE TABLE cf_event_registrations_next (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES cf_fundraising_events(id),
 ticket_type_id TEXT NOT NULL REFERENCES cf_event_ticket_types(id), donor_id TEXT REFERENCES cf_donors(id),
 intent_id TEXT NOT NULL REFERENCES cf_giving_intents(id), attendee_name TEXT NOT NULL,
 price_cents INTEGER NOT NULL, benefit_cents INTEGER NOT NULL, benefit_description TEXT NOT NULL,
 checked_in_at TEXT, checked_in_by TEXT, created_at TEXT NOT NULL,
 seat_number INTEGER NOT NULL, attendee_email TEXT, dietary_notes TEXT,
 answers_json TEXT NOT NULL DEFAULT '{}', answers_applied_at TEXT, is_buyer INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1, UNIQUE(intent_id,seat_number)
);
INSERT INTO cf_event_registrations_next
 SELECT id,event_id,ticket_type_id,donor_id,intent_id,attendee_name,price_cents,benefit_cents,
 benefit_description,checked_in_at,checked_in_by,created_at,1,NULL,NULL,'{}',NULL,1,1
 FROM cf_event_registrations;
DROP TABLE cf_event_registrations;
ALTER TABLE cf_event_registrations_next RENAME TO cf_event_registrations;
CREATE INDEX cf_event_guest_list ON cf_event_registrations(event_id,donor_id);
CREATE TRIGGER cf_event_registrations_score_insert AFTER INSERT ON cf_event_registrations BEGIN UPDATE cf_score_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER cf_event_registrations_score_update AFTER UPDATE ON cf_event_registrations BEGIN UPDATE cf_score_clock SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER cf_event_registrations_score_delete AFTER DELETE ON cf_event_registrations BEGIN UPDATE cf_score_clock SET revision=revision+1 WHERE id=1; END;

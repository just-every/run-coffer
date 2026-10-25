CREATE TABLE cf_fundraising_events (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id),
 appeal_id TEXT NOT NULL REFERENCES cf_appeal_codes(code), slug TEXT NOT NULL UNIQUE,
 starts_on TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE cf_event_ticket_types (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES cf_fundraising_events(id), name TEXT NOT NULL,
 price_cents INTEGER NOT NULL CHECK(price_cents>0), benefit_cents INTEGER NOT NULL CHECK(benefit_cents>=0),
 benefit_description TEXT NOT NULL
);
CREATE TABLE cf_event_registrations (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES cf_fundraising_events(id),
 ticket_type_id TEXT NOT NULL REFERENCES cf_event_ticket_types(id),
 donor_id TEXT REFERENCES cf_donors(id), intent_id TEXT NOT NULL UNIQUE REFERENCES cf_giving_intents(id),
 attendee_name TEXT NOT NULL, price_cents INTEGER NOT NULL, benefit_cents INTEGER NOT NULL,
 benefit_description TEXT NOT NULL, checked_in_at TEXT, checked_in_by TEXT, created_at TEXT NOT NULL
);
CREATE INDEX cf_event_guest_list ON cf_event_registrations(event_id,donor_id);

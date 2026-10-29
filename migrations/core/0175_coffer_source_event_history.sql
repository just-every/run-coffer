CREATE TABLE cf_source_events (
 id TEXT PRIMARY KEY,source TEXT NOT NULL,source_id TEXT NOT NULL,
 name TEXT NOT NULL,starts_on TEXT NOT NULL,imported_at TEXT NOT NULL,
 UNIQUE(source,source_id)
);
-- Historical seats never create a checkout intent or a current payment claim.
CREATE TABLE cf_source_event_guests (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES cf_source_events(id),
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 attendee_donor_id TEXT REFERENCES cf_donors(id),
 gift_id TEXT REFERENCES cf_gifts(id),
 source_id TEXT NOT NULL,registration_id TEXT NOT NULL,ticket_name TEXT NOT NULL,
 attendee_name TEXT NOT NULL,attendee_email TEXT,
 source_attended INTEGER CHECK(source_attended IS NULL OR source_attended IN (0,1)),
 source_status TEXT NOT NULL,imported_at TEXT NOT NULL
);

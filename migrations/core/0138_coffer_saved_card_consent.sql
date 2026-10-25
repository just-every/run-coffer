CREATE TABLE cf_saved_card_consents (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 donor_id TEXT NOT NULL REFERENCES cf_donors(id) ON DELETE CASCADE,
 customer_id TEXT NOT NULL,
 payment_method_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('granted','withdrawn')),
 recorded_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL
);
CREATE INDEX cf_saved_card_consent_current ON cf_saved_card_consents(donor_id,customer_id,payment_method_id,id DESC);

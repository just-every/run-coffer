-- Approval is evidence fetched from Twilio, never an operator assertion.
CREATE TABLE cf_sms_registration (
 id INTEGER PRIMARY KEY CHECK(id=1),
 version INTEGER NOT NULL CHECK(version>=1),
 account_sid TEXT NOT NULL,
 messaging_service_sid TEXT NOT NULL,
 campaign_sid TEXT NOT NULL,
 sender TEXT NOT NULL,
 campaign_status TEXT NOT NULL,
 sender_registered INTEGER NOT NULL CHECK(sender_registered IN (0,1)),
 approved INTEGER NOT NULL CHECK(approved IN (0,1)),
 checked_at TEXT NOT NULL,
 provider_updated_at TEXT,
 connection_sealed TEXT,
 CHECK(approved=0 OR (campaign_status='VERIFIED' AND sender_registered=1))
);

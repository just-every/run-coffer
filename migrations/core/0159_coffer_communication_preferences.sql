CREATE TABLE cf_communication_preferences (
 donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 channel TEXT NOT NULL CHECK(channel IN ('email','mail','sms','phone')),
 version INTEGER NOT NULL CHECK(version>0),
 topics TEXT NOT NULL CHECK(json_valid(topics)),
 frequency TEXT NOT NULL CHECK(frequency IN ('unlimited','monthly','quarterly')),
 source TEXT NOT NULL CHECK(source IN ('person','portal','constant-contact','mango','mailchimp')),
 recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL,
 PRIMARY KEY(donor_id,channel,version)
);
CREATE TRIGGER cf_communication_preferences_immutable BEFORE UPDATE ON cf_communication_preferences
BEGIN SELECT RAISE(ABORT,'COFFER_PREFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER cf_communication_preferences_delete BEFORE DELETE ON cf_communication_preferences
WHEN NOT EXISTS(SELECT 1 FROM cf_donors WHERE id=OLD.donor_id AND erased_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'COFFER_PREFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER cf_communication_preferences_erasure AFTER UPDATE OF erased_at ON cf_donors
WHEN NEW.erased_at IS NOT NULL BEGIN
 DELETE FROM cf_communication_preferences WHERE donor_id=NEW.id;
END;

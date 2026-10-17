-- The giving page asks for appeal consent separately from the transactional receipt.
ALTER TABLE cf_giving_intents ADD COLUMN email_consent INTEGER NOT NULL DEFAULT 0 CHECK(email_consent IN (0,1));

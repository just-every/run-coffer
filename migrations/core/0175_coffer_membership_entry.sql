-- Preserve every earned term and held submission while opening fixed-term entry.
CREATE TABLE cf_membership_levels_migration AS SELECT * FROM cf_membership_levels;
CREATE TABLE cf_membership_intents_migration AS SELECT * FROM cf_membership_intents;
CREATE TABLE cf_memberships_migration AS SELECT * FROM cf_memberships;
CREATE TABLE cf_membership_payments_migration AS SELECT * FROM cf_membership_payments;
CREATE TABLE cf_membership_reminders_migration AS SELECT * FROM cf_membership_reminders;
CREATE TABLE cf_membership_notices_migration AS SELECT * FROM cf_membership_notices;
DROP TABLE cf_membership_notices;
DROP TABLE cf_membership_reminders;
DROP TABLE cf_membership_payments;
DROP TABLE cf_memberships;
DROP TABLE cf_membership_intents;
DROP TABLE cf_membership_levels;
CREATE TABLE cf_membership_levels (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
 campaign_id TEXT NOT NULL REFERENCES cf_campaigns(id), price_cents INTEGER NOT NULL CHECK(price_cents>=100),
 term_months INTEGER NOT NULL CHECK(term_months BETWEEN 1 AND 36), benefit_cents INTEGER NOT NULL CHECK(benefit_cents>=0 AND benefit_cents<=price_cents),
 benefit_description TEXT NOT NULL, grace_days INTEGER NOT NULL CHECK(grace_days BETWEEN 0 AND 90),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE cf_membership_intents (
 intent_id TEXT PRIMARY KEY REFERENCES cf_giving_intents(id), level_id TEXT NOT NULL REFERENCES cf_membership_levels(id),
 level_version INTEGER NOT NULL, price_cents INTEGER NOT NULL, term_months INTEGER NOT NULL,
 benefit_cents INTEGER NOT NULL, benefit_description TEXT NOT NULL, grace_days INTEGER NOT NULL,
 auto_renew INTEGER NOT NULL DEFAULT 1 CHECK(auto_renew IN (0,1)), renewal_membership_id TEXT
);
CREATE TABLE cf_memberships (
 id TEXT PRIMARY KEY, donor_id TEXT NOT NULL REFERENCES cf_donors(id),
 intent_id TEXT NOT NULL UNIQUE REFERENCES cf_membership_intents(intent_id),
 subscription_id TEXT UNIQUE REFERENCES cf_subscriptions(id), created_at TEXT NOT NULL
);
CREATE INDEX cf_memberships_donor ON cf_memberships(donor_id);
CREATE TABLE cf_membership_payments (
 gift_id TEXT PRIMARY KEY REFERENCES cf_gifts(id), membership_id TEXT NOT NULL REFERENCES cf_memberships(id),
 starts_on TEXT NOT NULL, expires_on TEXT NOT NULL CHECK(expires_on>starts_on)
);
CREATE TABLE cf_membership_reminders (
 id TEXT PRIMARY KEY, membership_id TEXT NOT NULL REFERENCES cf_memberships(id) ON DELETE CASCADE,
 expires_on TEXT NOT NULL, prepared_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'held' CHECK(status='held'),
 UNIQUE(membership_id,expires_on)
);
CREATE TABLE cf_membership_notices (
 reminder_id TEXT PRIMARY KEY REFERENCES cf_membership_reminders(id) ON DELETE CASCADE,
 content_hash TEXT NOT NULL, claimed_at TEXT NOT NULL, actor_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','accepted','uncertain')),
 message_id TEXT
);

INSERT INTO cf_membership_levels SELECT * FROM cf_membership_levels_migration;
INSERT INTO cf_membership_intents(intent_id,level_id,level_version,price_cents,term_months,benefit_cents,benefit_description,grace_days) SELECT * FROM cf_membership_intents_migration;
INSERT INTO cf_memberships SELECT * FROM cf_memberships_migration;
INSERT INTO cf_membership_payments SELECT * FROM cf_membership_payments_migration;
INSERT INTO cf_membership_reminders SELECT * FROM cf_membership_reminders_migration;
INSERT INTO cf_membership_notices SELECT * FROM cf_membership_notices_migration;
DROP TABLE cf_membership_notices_migration;
DROP TABLE cf_membership_reminders_migration;
DROP TABLE cf_membership_payments_migration;
DROP TABLE cf_memberships_migration;
DROP TABLE cf_membership_intents_migration;
DROP TABLE cf_membership_levels_migration;

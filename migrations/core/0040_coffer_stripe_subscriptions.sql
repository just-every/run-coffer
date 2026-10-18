-- Imported monthly plans have no fundraising target and never publish a page.
-- None of the campaign child references use ON DELETE CASCADE.
PRAGMA defer_foreign_keys = on;
DROP TRIGGER cf_allocation_insert;
CREATE TABLE cf_campaigns_next (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 description TEXT NOT NULL, fund TEXT NOT NULL, goal_cents INTEGER CHECK(goal_cents > 0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL,
 CHECK(goal_cents IS NOT NULL OR active=0)
);
INSERT INTO cf_campaigns_next SELECT * FROM cf_campaigns;
DROP TABLE cf_campaigns;
ALTER TABLE cf_campaigns_next RENAME TO cf_campaigns;
CREATE TRIGGER cf_allocation_insert BEFORE INSERT ON cf_gift_allocations
WHEN NOT EXISTS(SELECT 1 FROM cf_gifts g WHERE g.id=NEW.gift_id AND g.kind='gift' AND g.pledge_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_pledge_allocations WHERE gift_id=g.id)
 AND NOT EXISTS(SELECT 1 FROM cf_gifts WHERE reverses=g.id)
 AND NEW.amount_cents+COALESCE((SELECT SUM(amount_cents) FROM cf_gift_allocations WHERE gift_id=g.id),0)<=g.amount_cents)
 OR (NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_campaigns WHERE id=NEW.campaign_id AND fund=NEW.fund))
 OR EXISTS(SELECT 1 FROM cf_gift_allocations a WHERE a.gift_id=NEW.gift_id AND
  ((a.campaign_id IS NULL)<>(NEW.campaign_id IS NULL) OR (NEW.campaign_id IS NULL AND a.fund=NEW.fund) OR a.campaign_id=NEW.campaign_id))
BEGIN SELECT RAISE(ABORT,'COFFER_ALLOCATION_INVALID'); END;

-- These two native tables have no version counter: their adapter compares all
-- native columns and uses this bridge solely for import ownership.
CREATE TABLE cf_import_revisions_next (
 kind TEXT NOT NULL CHECK(kind IN ('donor','gift','campaign','subscription')),
 id TEXT NOT NULL, import_revision TEXT NOT NULL, native_revision INTEGER NOT NULL,
 PRIMARY KEY(kind,id)
);
INSERT INTO cf_import_revisions_next SELECT * FROM cf_import_revisions;
DROP TABLE cf_import_revisions;
ALTER TABLE cf_import_revisions_next RENAME TO cf_import_revisions;

-- Recreating a referenced parent leaves SQLite's deferred DROP counter set,
-- even after all references resolve. Check the final graph before clearing it.
INSERT INTO cf_assert(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;
DELETE FROM cf_assert;
PRAGMA defer_foreign_keys = off;

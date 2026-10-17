-- Allocations preserve the payment identity, tax receipt and contribution
-- ledger. Fund/campaign reporting expands only the allocation dimensions.
CREATE TABLE cf_gift_allocations (
 id TEXT PRIMARY KEY,
 gift_id TEXT NOT NULL REFERENCES cf_gifts(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position>0 AND position<=50),
 fund TEXT NOT NULL CHECK(length(trim(fund)) BETWEEN 1 AND 100),
 campaign_id TEXT REFERENCES cf_campaigns(id),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents>0),
 UNIQUE(gift_id,position)
);
CREATE INDEX cf_allocation_campaign ON cf_gift_allocations(campaign_id,gift_id);
CREATE TRIGGER cf_allocation_insert BEFORE INSERT ON cf_gift_allocations
WHEN NOT EXISTS(SELECT 1 FROM cf_gifts g WHERE g.id=NEW.gift_id AND g.kind='gift' AND g.pledge_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_pledge_allocations WHERE gift_id=g.id)
 AND NOT EXISTS(SELECT 1 FROM cf_gifts WHERE reverses=g.id)
 AND NEW.amount_cents+COALESCE((SELECT SUM(amount_cents) FROM cf_gift_allocations WHERE gift_id=g.id),0)<=g.amount_cents)
 OR (NEW.campaign_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_campaigns WHERE id=NEW.campaign_id AND fund=NEW.fund))
 OR EXISTS(SELECT 1 FROM cf_gift_allocations a WHERE a.gift_id=NEW.gift_id AND
  ((a.campaign_id IS NULL)<>(NEW.campaign_id IS NULL) OR (NEW.campaign_id IS NULL AND a.fund=NEW.fund) OR a.campaign_id=NEW.campaign_id))
BEGIN SELECT RAISE(ABORT,'COFFER_ALLOCATION_INVALID'); END;
CREATE TRIGGER cf_allocation_immutable BEFORE UPDATE ON cf_gift_allocations
BEGIN SELECT RAISE(ABORT,'COFFER_ALLOCATION_IMMUTABLE'); END;
-- Parent deletion is reserved for authorized import undo / archive replacement.
-- Its FK cascade runs after the gift disappears, so cannot leave a partial gift.
CREATE TRIGGER cf_allocation_no_delete BEFORE DELETE ON cf_gift_allocations
WHEN EXISTS(SELECT 1 FROM cf_gifts WHERE id=OLD.gift_id)
BEGIN SELECT RAISE(ABORT,'COFFER_ALLOCATION_IMMUTABLE'); END;
CREATE TRIGGER cf_pledge_no_split BEFORE INSERT ON cf_pledge_allocations
WHEN EXISTS(SELECT 1 FROM cf_gift_allocations WHERE gift_id=NEW.gift_id)
BEGIN SELECT RAISE(ABORT,'COFFER_PLEDGE_SPLIT'); END;

CREATE VIEW cf_fund_ledger AS
WITH RECURSIVE
parts AS (
 SELECT a.id AS allocation_id,a.gift_id,a.position,a.fund,a.campaign_id,a.amount_cents,
  COALESCE(SUM(a.amount_cents) OVER(PARTITION BY a.gift_id ORDER BY a.position ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS start_cents
 FROM cf_gift_allocations a
 UNION ALL
 SELECT NULL,g.id,1,g.fund,cg.campaign_id,g.amount_cents,0 FROM cf_gifts g
 LEFT JOIN cf_campaign_gifts cg ON cg.gift_id=g.id
 WHERE g.kind='gift' AND NOT EXISTS(SELECT 1 FROM cf_gift_allocations WHERE gift_id=g.id)
),
adjustments AS (
 SELECT p.id,p.gift_id,g.amount_cents+SUM(p.contribution_cents) OVER(PARTITION BY p.gift_id ORDER BY p.created_at,p.id ROWS UNBOUNDED PRECEDING) AS after_cents
 FROM cf_payment_entries p JOIN cf_gifts g ON g.id=p.gift_id WHERE p.contribution_cents<>0
),
entries AS (
 SELECT l.*,COALESCE(a.gift_id,l.reverses,l.id) AS gift_id,
  COALESCE(a.after_cents,l.amount_cents) AS after_cents,
  CASE WHEN a.id IS NULL THEN 0 ELSE a.after_cents-l.amount_cents END AS before_cents
 FROM cf_contribution_ledger l LEFT JOIN adjustments a ON a.id=l.id
),
boundaries AS (
 SELECT e.id,p.allocation_id,p.position,g.amount_cents AS denominator,
  CAST(CASE b.value WHEN 0 THEN p.start_cents ELSE p.start_cents+p.amount_cents END AS TEXT) AS digits,
  CASE t.value WHEN 0 THEN e.before_cents ELSE e.after_cents END AS cents,
  CASE WHEN b.value=t.value THEN 1 ELSE -1 END AS direction
 FROM entries e JOIN parts p ON p.gift_id=e.gift_id JOIN cf_gifts g ON g.id=e.gift_id
 CROSS JOIN json_each('[0,1]') b CROSS JOIN json_each('[0,1]') t
 WHERE p.allocation_id IS NOT NULL AND e.source='stripe-adjustment'
),
-- Long division by decimal digits keeps every intermediate an integer. Direct
-- cents * allocation multiplication can overflow SQLite's 64-bit integers.
division(id,allocation_id,position,denominator,digits,cents,direction,step,quotient,remainder) AS (
 SELECT id,allocation_id,position,denominator,digits,cents,direction,1,0,0 FROM boundaries
 UNION ALL
 SELECT id,allocation_id,position,denominator,digits,cents,direction,step+1,
  10*quotient+CAST(substr(digits,step,1) AS INTEGER)*(abs(cents)/denominator)
   +(10*remainder+CAST(substr(digits,step,1) AS INTEGER)*(abs(cents)%denominator))/denominator,
  (10*remainder+CAST(substr(digits,step,1) AS INTEGER)*(abs(cents)%denominator))%denominator
 FROM division WHERE step<=length(digits)
),
amounts AS (
 SELECT id,allocation_id,position,SUM(direction*CASE WHEN cents<0 THEN -quotient ELSE quotient END) AS amount_cents
 FROM division WHERE step>length(digits) GROUP BY id,allocation_id,position
)
SELECT e.id,e.gift_id,p.allocation_id,p.position,e.version,e.donor_id,e.kind,e.reverses,e.received_on,
 CASE WHEN p.allocation_id IS NULL THEN e.amount_cents WHEN e.source='stripe-adjustment' THEN a.amount_cents WHEN e.kind='reversal' THEN -p.amount_cents ELSE p.amount_cents END AS amount_cents,
 e.method,e.reference,CASE WHEN p.allocation_id IS NULL THEN e.fund ELSE p.fund END AS fund,
 p.campaign_id,e.pledge_id,e.source,e.created_at,e.created_by
FROM entries e JOIN parts p ON p.gift_id=e.gift_id LEFT JOIN amounts a ON a.id=e.id AND a.position=p.position;

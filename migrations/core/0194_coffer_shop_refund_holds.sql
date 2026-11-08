-- A signed refund can precede the provider read. Keep the hold independently
-- of a refresh result, and invalidate documents without rewriting money.
ALTER TABLE cf_shop_orders ADD COLUMN refund_pending INTEGER NOT NULL DEFAULT 0 CHECK(refund_pending IN (0,1));
UPDATE cf_shop_orders SET refund_pending=1 WHERE state<>'erased' AND NOT EXISTS(SELECT 1 FROM cf_payment_entries p WHERE p.id='shop-refund-'||cf_shop_orders.id)
 AND (state='refund-held' OR EXISTS(SELECT 1 FROM cf_shop_events e WHERE e.order_key=cf_shop_orders.id AND e.topic='refunds'||'/'||'create'));
CREATE TRIGGER cf_shop_receipt_hold AFTER UPDATE OF refund_pending,conflicted ON cf_shop_orders
WHEN NEW.gift_id IS NOT NULL AND (NEW.refund_pending=1 OR NEW.conflicted=1)
BEGIN
 UPDATE cf_acks SET void_reason=COALESCE(void_reason,'Shop refund or source conflict awaiting review')
 WHERE gift_id=NEW.gift_id OR EXISTS(SELECT 1 FROM json_each(statement_gifts) j WHERE json_extract(j.value,'$.id')=NEW.gift_id);
END;
CREATE TRIGGER cf_shop_receipt_prepare BEFORE INSERT ON cf_acks
WHEN EXISTS(SELECT 1 FROM cf_shop_orders s WHERE (s.refund_pending=1 OR s.conflicted=1) AND
 (s.gift_id=NEW.gift_id OR EXISTS(SELECT 1 FROM json_each(NEW.statement_gifts) j WHERE json_extract(j.value,'$.id')=s.gift_id)))
BEGIN SELECT RAISE(ABORT,'COFFER_SHOP_MONEY_HELD'); END;
UPDATE cf_acks SET void_reason=COALESCE(void_reason,'Shop refund or source conflict awaiting review')
WHERE EXISTS(SELECT 1 FROM cf_shop_orders s WHERE (s.refund_pending=1 OR s.conflicted=1) AND
 (s.gift_id=cf_acks.gift_id OR EXISTS(SELECT 1 FROM json_each(cf_acks.statement_gifts) j WHERE json_extract(j.value,'$.id')=s.gift_id)));

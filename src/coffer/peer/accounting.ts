import { sql, type Stmt } from '../db'

/** Run in recordGift's transaction, after the original gift and campaign link.
 * The attribution row is a durable replay marker: removing a soft credit must
 * never cause a later Stripe delivery to recreate it. Saved native intentions,
 * rather than provider metadata, select the fundraiser. */
export function peerCreditStatements(giftId: string, intentId: string, now: string): Stmt[] {
 const source = `FROM cf_gifts g JOIN cf_campaign_gifts cg ON cg.gift_id=g.id
  JOIN cf_giving_intents i ON i.id=? AND i.campaign_id=cg.campaign_id
  JOIN cf_peer_intents pi ON pi.intent_id=i.id
  JOIN cf_peer_pages p ON p.id=pi.page_id AND p.campaign_id=i.campaign_id
  WHERE g.id=? AND g.kind='gift' AND g.source='stripe' AND g.donor_id=i.donor_id
   AND NOT EXISTS(SELECT 1 FROM cf_peer_gifts WHERE gift_id=g.id)`
 return [
  sql(`INSERT OR IGNORE INTO cf_soft_credits(id,gift_id,donor_id,amount_cents,created_at,created_by)
   SELECT 'peer-credit:'||g.id,g.id,p.donor_id,g.amount_cents,?,'Peer fundraiser' ${source}
   AND p.donor_id<>g.donor_id
   AND EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=p.donor_id AND d.erased_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))
   AND EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=g.donor_id AND d.erased_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`, now, intentId, giftId),
  sql(`INSERT OR IGNORE INTO cf_peer_gifts(gift_id,page_id) SELECT g.id,p.id ${source}`, intentId, giftId),
 ]
}

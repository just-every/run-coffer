import { sql, type Row } from './db'

/** Include this write in the transaction recording the paid or closed-batch gift. */
export function enqueueAutomaticReceipt(giftId: string, source: 'online' | 'offline', now: string) {
 return sql(`INSERT OR IGNORE INTO cf_automatic_receipts(gift_id,source,settings_version,template_revision,gift_version,donor_version,created_at)
 SELECT g.id,?,s.version,(SELECT COALESCE(SUM(version),0) FROM cf_letter_templates),g.version,d.version,?
 FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id CROSS JOIN cf_settings s
 WHERE g.id=? AND s.id=1 AND s.reviewed_at IS NOT NULL AND CASE WHEN ?='online' THEN s.online_receipts='automatic' ELSE s.offline_receipts=1 END`,source,now,giftId,source)
}

export const automaticReceiptEnabled = (job: Row) => job.source === 'online' ? "s.online_receipts='automatic'" : 's.offline_receipts=1'

/** Standing approval remains tied to the person and revision that granted it. */
export const automaticReceiptAuthority = `EXISTS(SELECT 1 FROM cf_settings s JOIN oa_operators o ON o.id=s.receipt_authorizer_id
 WHERE s.id=1 AND o.version=s.receipt_authorizer_version AND o.status='active' AND o.role IN ('owner','admin'))`

/** Re-read money, erasure, contact identity and thank-you custody at the claim. */
export const automaticGiftCurrent = `EXISTS(SELECT 1 FROM cf_automatic_receipts q JOIN cf_gift_balances g ON g.id=q.gift_id JOIN cf_donors d ON d.id=g.donor_id
 WHERE q.gift_id=? AND g.kind='gift' AND g.version=q.gift_version AND d.version=q.donor_version AND d.erased_at IS NULL AND d.constituent_status<>'inactive'
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
 AND g.goods<>'unknown' AND g.net_cents=g.amount_cents AND g.net_cents>g.goods_cents
 AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id)
 AND NOT EXISTS(SELECT 1 FROM cf_prior_acknowledgements p WHERE p.gift_id=g.id)
 AND NOT EXISTS(SELECT 1 FROM cf_gift_acknowledgments k WHERE k.gift_id=g.id AND (k.status<>'not acknowledged' OR k.outcome_unknown=1)))`

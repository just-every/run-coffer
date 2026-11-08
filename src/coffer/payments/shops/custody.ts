import { sql, type Stmt } from '../../db'
/** Candidate custody starts before approval. Remove all private order and event
 * evidence atomically while keeping opaque replay identities and money. */
export function shopErasure(donorId:string,emails:string[]=[]):Stmt[]{
 const affected=`SELECT charge_id FROM cf_payment_donor_matches WHERE provider='shopify' AND
 (donor_id=? OR EXISTS(SELECT 1 FROM json_each(candidates) WHERE json_extract(value,'$.id')=?)
 OR lower(email) IN (SELECT lower(email) FROM cf_donors WHERE id=? UNION SELECT lower(value) FROM cf_contact_points WHERE donor_id=? AND kind='email' UNION SELECT lower(value) FROM json_each(?)))`
 const args=[donorId,donorId,donorId,donorId,JSON.stringify(emails)]
 return [sql(`INSERT OR IGNORE INTO cf_shop_erased_identities(hash) SELECT identity_hash FROM cf_shop_orders WHERE identity_hash IS NOT NULL AND id IN (${affected})`,...args),
 sql(`UPDATE cf_shop_events SET payload=NULL WHERE order_key IN (${affected})`,...args),
 sql(`UPDATE cf_shop_orders SET state='erased',source=NULL,facts='{}',review=NULL,evidence=NULL,fingerprint=NULL,issues='[]',approved_by=NULL,approved_at=NULL,version=version+1 WHERE id IN (${affected})`,...args)]
}

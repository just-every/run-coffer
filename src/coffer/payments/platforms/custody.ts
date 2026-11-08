import { sql, type Stmt } from '../../db'

/** Retain anonymous source tombstones and money; remove complete private files.
 * Candidate membership counts as custody before any donor selection. This runs
 * before native erasure clears contacts, aliases and gift ownership. */
export function platformErasure(donorId:string,emails:string[]=[]):Stmt[]{
 const affected=`SELECT charge_id FROM cf_payment_donor_matches WHERE provider='benevity' AND
 (donor_id=? OR EXISTS(SELECT 1 FROM json_each(candidates) WHERE json_extract(value,'$.id')=?)
 OR lower(email) IN (SELECT lower(email) FROM cf_donors WHERE id=? UNION SELECT lower(value) FROM cf_contact_points WHERE donor_id=? AND kind='email'
 UNION SELECT lower(value) FROM json_each(?)))`
 const batches=`SELECT batch_id FROM cf_platform_sources WHERE source_id IN (${affected})`
 const args=[donorId,donorId,donorId,donorId,JSON.stringify(emails)]
 return [sql(`INSERT OR IGNORE INTO cf_platform_erased_donors(identity_hash) SELECT identity_hash FROM cf_platform_sources WHERE source_id IN (${affected}) AND identity_hash IS NOT NULL`,...args),
  sql(`UPDATE cf_platform_sources SET evidence=NULL WHERE batch_id IN (${batches})`,...args),
  sql(`UPDATE cf_platform_batches SET source_csv=NULL,mapping='{}',issues='[]',state='erased',version=version+1,approved_by=NULL,approved_at=NULL WHERE state<>'erased' AND id IN (${batches})`,...args),
  sql(`UPDATE cf_payment_donor_matches SET state='erased',email=NULL,customer_id=NULL,facts='{}',candidates='[]',donor_id=NULL,donor_version=NULL,approved_by=NULL,approved_actor_version=NULL,approved_at=NULL,version=version+1 WHERE charge_id IN (${affected})`,...args)]
}

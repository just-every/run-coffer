import { sql, type Stmt } from '../../db'

/** Retain anonymous source tombstones and money; remove complete private files.
 * Queue candidate membership also counts as affected custody, before assignment. */
export function platformErasure(donorId:string):Stmt[]{
 const affected=`SELECT charge_id FROM cf_payment_donor_matches WHERE provider='benevity' AND
 (donor_id=? OR EXISTS(SELECT 1 FROM json_each(candidates) WHERE json_extract(value,'$.id')=?)
 OR lower(email) IN (SELECT lower(email) FROM cf_donors WHERE id=? UNION SELECT lower(value) FROM cf_contact_points WHERE donor_id=? AND kind='email'))`
 const batches=`SELECT batch_id FROM cf_platform_sources WHERE source_id IN (${affected})`
 const args=[donorId,donorId,donorId,donorId]
 return [sql(`UPDATE cf_platform_sources SET evidence=NULL WHERE batch_id IN (${batches})`,...args),
  sql(`UPDATE cf_platform_batches SET source_csv=NULL,state='erased',version=version+1,approved_by=NULL,approved_at=NULL WHERE id IN (${batches})`,...args)]
}

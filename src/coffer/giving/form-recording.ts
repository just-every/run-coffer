import { sql, type Stmt } from '../db'

/** Run after the gift insert in the payment transaction. Identity comes from
 * the persisted intent and gift, and all answers come from the frozen capture.
 * New installments may attach gift answers again, but never overwrite a
 * constituent value (including staff clears). Gift IDs fence paid replays. */
export function givingFormGiftStatements(intentId: string, giftId: string, donorId: string, now: string): Stmt[] {
 const live = `EXISTS(SELECT 1 FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id
  JOIN cf_giving_intents i ON i.id=? AND i.donor_id=d.id
  WHERE g.id=? AND d.id=? AND d.erased_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))
  AND NOT EXISTS(SELECT 1 FROM cf_giving_form_redactions WHERE intent_id=?)`
 const pending = `SELECT f.*,i.campaign_id FROM cf_giving_form_gifts f JOIN cf_giving_form_intents i USING(intent_id)
  WHERE f.gift_id=? AND f.values_applied=0 AND (${live})`
 const params = [giftId,intentId,giftId,donorId,intentId]
 const answers = `SELECT json_extract(a.value,'$.key') AS field_key,json_extract(a.value,'$.value') AS answer,
   q.value AS question,p.form_version,p.campaign_id
  FROM (${pending}) p,json_each(p.snapshot,'$.answers') a,json_each(p.snapshot,'$.form.questions') q
  WHERE json_extract(a.value,'$.key')=json_extract(q.value,'$.key')`
 const candidates = `SELECT a.*,CASE f.kind WHEN 'constituent' THEN ? ELSE ? END AS record_id
  FROM (${answers}) a JOIN cf_custom_fields f ON f.key=a.field_key
  AND f.kind=json_extract(a.question,'$.kind') AND f.type=json_extract(a.question,'$.type') AND f.entry=json_extract(a.question,'$.entry')`
 const source = `'Giving form '||campaign_id||' version '||form_version`
 return [
  sql(`INSERT OR IGNORE INTO cf_giving_form_gifts(gift_id,intent_id,form_version,snapshot,recorded_at)
   SELECT ?,intent_id,form_version,snapshot,? FROM cf_giving_form_intents WHERE intent_id=? AND (${live})`,giftId,now,intentId,intentId,giftId,donorId,intentId),
  sql(`INSERT OR IGNORE INTO cf_custom_values(field_key,record_id,donor_id,value,version,source,updated_at)
   SELECT field_key,record_id,?,answer,1,${source},? FROM (${candidates})`,donorId,now,donorId,giftId,...params),
  sql(`INSERT OR IGNORE INTO cf_custom_value_history(field_key,record_id,donor_id,version,value,source,recorded_at,actor_id)
   SELECT v.field_key,v.record_id,v.donor_id,v.version,v.value,v.source,v.updated_at,'giving-form'
   FROM (${candidates}) a JOIN cf_custom_values v ON v.field_key=a.field_key AND v.record_id=a.record_id
   WHERE v.source=${source} AND v.updated_at=? AND v.value=a.answer AND v.version=1`,donorId,giftId,...params,now),
  sql(`UPDATE cf_donors SET version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM (${candidates}) a
   JOIN cf_custom_values v ON v.field_key=a.field_key AND v.record_id=a.record_id
   WHERE v.source=${source} AND v.updated_at=?)`,donorId,donorId,giftId,...params,now),
  sql(`UPDATE cf_giving_form_gifts SET values_applied=1 WHERE gift_id=? AND (${live})`,giftId,intentId,giftId,donorId,intentId),
 ]
}

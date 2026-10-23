import type { Row } from '../db'

/** Verified SendGrid events for an explicit donor-requested copy are separate
 * attempts. They never overwrite the original approved document's delivery.
 * Called only after the shared receipt webhook verifier has filtered fields. */
export async function portalCopyEvents(db:D1Database,incoming:Row[],signed:boolean){
 if(!signed||!incoming.length)return
 const payload=JSON.stringify(incoming),now=new Date().toISOString()
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO cf_portal_copy_events(id,copy_id,event,occurred_at,recorded_at,signature_verified)
   SELECT json_extract(j.value,'$.id'),c.id,json_extract(j.value,'$.state'),json_extract(j.value,'$.occurred'),?,1
   FROM json_each(?) j JOIN cf_portal_copies c ON c.id=json_extract(j.value,'$.attempt') AND c.letter_id=json_extract(j.value,'$.letterId')
   JOIN cf_donors d ON d.id=c.donor_id AND d.erased_at IS NULL WHERE c.state IN ('sending','submitted','uncertain')`).bind(now,payload),
  db.prepare(`UPDATE cf_portal_copies AS c SET delivery_status=CASE
   WHEN EXISTS(SELECT 1 FROM cf_portal_copy_events e WHERE e.copy_id=c.id AND e.event='complained') THEN 'complained'
   WHEN EXISTS(SELECT 1 FROM cf_portal_copy_events e WHERE e.copy_id=c.id AND e.event='bounced') THEN 'bounced'
   WHEN EXISTS(SELECT 1 FROM cf_portal_copy_events e WHERE e.copy_id=c.id AND e.event='delivered') THEN 'delivered' ELSE delivery_status END,
   delivered_at=COALESCE(delivered_at,(SELECT min(occurred_at) FROM cf_portal_copy_events e WHERE e.copy_id=c.id AND e.event='delivered'))
   WHERE id IN (SELECT json_extract(value,'$.attempt') FROM json_each(?))`).bind(payload),
  db.prepare(`INSERT OR IGNORE INTO cf_receipt_address_tasks(id,letter_id,created_at)
   SELECT 'receipt-address:'||c.letter_id,c.letter_id,min(e.recorded_at) FROM cf_portal_copies c
   JOIN cf_portal_copy_events e ON e.copy_id=c.id AND e.event IN ('bounced','complained')
   JOIN cf_donors d ON d.id=c.donor_id AND d.erased_at IS NULL
   WHERE c.id IN (SELECT json_extract(value,'$.attempt') FROM json_each(?)) GROUP BY c.letter_id`).bind(payload),
 ])
}

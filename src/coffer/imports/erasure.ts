import { developmentReportErasureStatements } from '../agent/development-report-custody'
import { retireD1ImportCustody, upgradeD1ImportErasureIndex, type D1Database, type D1Sql } from '../../modules/import-kit/src/d1/index.ts'
import { guard } from '../../modules/import-kit/src/d1/database.ts'
import { authorize, destination, importContext } from './context.ts'
import { erasureHash } from './snapshots.ts'
import { reject, type EraseIntegration, type ImportActor, type ImportAuthority, type SnapshotObject } from './types.ts'

const sql = (text: string, ...params: any[]): D1Sql => ({ sql: text, params })
export const ERASED = 'Erased donor'

/** Native erasure for one donor. The donor row is deleted; its gifts, pledges,
 * letters, appeal places and audit rows move to a new anonymous placeholder, so
 * the charity's ledger keeps its amounts and dates. Contact details, consent
 * evidence, letter text, appeal addresses and gift notes are removed. One-way
 * hashes of the email and donor ID stop a later move-in reviving the person. */
export function donorErasureStatements(donor: { id: string; email: string | null; emails?: string[] }, placeholderId: string, now: string, afterPlaceholder: D1Sql[] = []): D1Sql[] {
  const donorId = donor.id
  const referencingMoveInJobs="SELECT id FROM cf_move_in_jobs WHERE EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(report,'$.previewNativeDonors'),json_extract(report,'$.neonNativeDonors'),json_extract(report,'$.spreadsheetNativeDonors'),'[]')) WHERE value=?)"
  return [
    sql(`DELETE FROM cf_move_in_parts WHERE job_id IN (${referencingMoveInJobs})`,donorId),
    sql(`DELETE FROM cf_move_in_issues WHERE job_id IN (${referencingMoveInJobs})`,donorId),
    sql(`UPDATE cf_move_in_jobs SET report='{}',accepted_reason=NULL,check_report=NULL,redacted=1 WHERE id IN (${referencingMoveInJobs})`,donorId),
    ...developmentReportErasureStatements(donorId),
    sql('DELETE FROM cf_recurring_source_references WHERE donor_id=?',donorId),
    sql('DELETE FROM cf_platform_gifts WHERE gift_id IN(SELECT id FROM cf_gifts WHERE donor_id=?)',donorId),
    sql('DELETE FROM cf_hygiene_proposals WHERE donor_id=? OR related_donor_id=? OR evidence_id IN (SELECT id FROM cf_hygiene_evidence WHERE donor_id=?)',donorId,donorId,donorId),
    sql('DELETE FROM cf_hygiene_evidence WHERE donor_id=?',donorId),
    ...[donorId, donor.email,...(donor.emails??[])].filter(Boolean).map(value => sql('INSERT OR IGNORE INTO cf_erasures(hash,erased_at) VALUES(?,?)', erasureHash(value!), now)),
    sql('INSERT INTO cf_donors(id,version,name,source,source_ref,created_at,erased_at) SELECT ?,1,?,source,NULL,?,? FROM cf_donors WHERE id=?', placeholderId, ERASED, now, now, donorId),
    ...afterPlaceholder,
    sql('UPDATE cf_communications SET name_fields=NULL,recipient_contact_id=NULL,recipient_contact_version=NULL WHERE donor_id=?',donorId),
    // A household snapshot can name a person whose donor ID is not the
    // statement's addressee. Erasure redacts that whole historical piece.
    sql(`UPDATE cf_acks SET household_snapshot=NULL,statement_gifts=NULL,recipient_name=?,recipient_email=NULL,address=NULL,subject='[erased]',body='[erased]',delivery_note=NULL
      WHERE EXISTS(SELECT 1 FROM json_each(cf_acks.household_snapshot,'$.members') m WHERE json_extract(m.value,'$.id')=?)
       OR EXISTS(SELECT 1 FROM json_each(cf_acks.statement_gifts) g WHERE json_extract(g.value,'$.donor_id')=?)`, ERASED, donorId, donorId),
    // Merge journals may hold this household even when the erased member was
    // not one of the merged pair. No retained snapshot may revive their name.
    sql(`UPDATE cf_donor_merge_journal SET status='erased',erased_at=? WHERE id IN
      (SELECT merge_id FROM cf_donor_merge_rows WHERE table_name='cf_households' AND
       (json_extract(value,'$.id')=(SELECT household_id FROM cf_donors WHERE id=?) OR json_extract(value,'$.head_donor_id')=?))`, now, donorId, donorId),
    sql("DELETE FROM cf_donor_merge_rows WHERE merge_id IN (SELECT id FROM cf_donor_merge_journal WHERE status='erased')"),
    sql(`DELETE FROM cf_move_in_issues WHERE job_id IN (SELECT job_id FROM cf_move_in_records WHERE kind='household' AND native_id IN (SELECT id FROM cf_households WHERE id=(SELECT household_id FROM cf_donors WHERE id=?) OR head_donor_id=?))`, donorId, donorId),
    sql(`DELETE FROM cf_move_in_parts WHERE job_id IN (SELECT job_id FROM cf_move_in_records WHERE donor_id=? OR related_id=? OR (kind='household' AND native_id=(SELECT household_id FROM cf_donors WHERE id=?)))`,donorId,donorId,donorId),
    sql(`UPDATE cf_move_in_jobs SET report='{}',accepted_reason=NULL,redacted=1,check_report=NULL WHERE id IN
      (SELECT job_id FROM cf_move_in_records WHERE kind='household' AND native_id IN (SELECT id FROM cf_households WHERE id=(SELECT household_id FROM cf_donors WHERE id=?) OR head_donor_id=?))
      OR EXISTS(SELECT 1 FROM json_each(cf_move_in_jobs.report,'$.householdCheckpoints') p JOIN cf_households h ON h.id=p.key WHERE h.id=(SELECT household_id FROM cf_donors WHERE id=?) OR h.head_donor_id=?)`, donorId, donorId, donorId, donorId),
    sql(`UPDATE cf_move_in_records SET snapshot=NULL WHERE kind='household' AND native_id IN
      (SELECT id FROM cf_households WHERE id=(SELECT household_id FROM cf_donors WHERE id=?) OR head_donor_id=?)`, donorId, donorId),
    // Replace the whole label: substring removal would retain surnames or
    // partial aliases. The opaque placeholder suffix keeps the name unique.
    sql(`UPDATE cf_households SET version=version+1,head_donor_id=CASE WHEN head_donor_id=? THEN NULL ELSE head_donor_id END,
      head_source=CASE WHEN head_donor_id=? THEN NULL ELSE head_source END,head_imported_at=CASE WHEN head_donor_id=? THEN NULL ELSE head_imported_at END,
      addressee_override=NULL,formal_override=NULL,informal_override=NULL,overrides_review=0,name='Household '||id||' · '||?
      WHERE id=(SELECT household_id FROM cf_donors WHERE id=?) OR head_donor_id=?`,donorId,donorId,donorId,placeholderId,donorId,donorId),
    sql("UPDATE cf_donors SET version=version+1,name=?,prefix=NULL,first_name=NULL,middle_name=NULL,last_name=NULL,suffix=NULL,nickname=NULL,email=NULL,phone=NULL,address_line1=NULL,address_line2=NULL,city=NULL,region=NULL,postal_code=NULL,country=NULL,household_id=NULL,source_ref=NULL,erased_at=? WHERE id=?", ERASED, now, donorId),
    sql('DELETE FROM cf_consents WHERE donor_id=?', donorId),
    sql('UPDATE cf_gifts SET version=version+1,note=NULL,donor_id=? WHERE donor_id=?', placeholderId, donorId),
    sql('UPDATE cf_pledge_adjustments SET reason=NULL WHERE pledge_id IN (SELECT id FROM cf_pledges WHERE donor_id=?)', donorId),
    sql('DELETE FROM cf_pledge_plans WHERE pledge_id IN (SELECT id FROM cf_pledges WHERE donor_id=?)', donorId),
    sql('UPDATE cf_pledges SET donor_id=? WHERE donor_id=?', placeholderId, donorId),
    sql("UPDATE cf_acks SET donor_id=?,recipient_name=?,recipient_email=NULL,address=NULL,statement_gifts=NULL,delivery_note=NULL,subject='[erased]',body='[erased]' WHERE donor_id=?", placeholderId, ERASED, donorId),
    sql('UPDATE cf_appeal_recipients SET donor_id=?,name=?,email=NULL,address=NULL,name_fields=NULL,email_contact_id=NULL,email_contact_version=NULL,merge_fields=NULL,merge_blanks=NULL,rendered_subject=NULL,rendered_body=NULL WHERE donor_id=?', placeholderId, ERASED, donorId),
    sql('UPDATE cf_events SET donor_id=? WHERE donor_id=?', placeholderId, donorId),
    sql("DELETE FROM cf_import_revisions WHERE (kind='donor' AND id=?) OR (kind='gift' AND id IN (SELECT id FROM cf_gifts WHERE donor_id=?)) OR (kind='subscription' AND id IN (SELECT id FROM cf_subscriptions WHERE donor_id=?))", donorId, placeholderId, placeholderId),
    sql('DELETE FROM cf_donors WHERE id=?', donorId),
  ]
}

/** Owner only. One D1 batch: native erasure, import custody retirement for
 * every Stripe object naming this donor, withdrawal of the original pages that
 * hold them, portability's restore checkpoint and the erasure journal row. */
export async function erase(db: D1Database, actor: ImportActor, donorId: string, authority: ImportAuthority, integration: EraseIntegration) {
  await authorize(db, actor, authority)
  if (actor.role !== 'owner') reject('FORBIDDEN', 'Only the owner can erase a donor.', 403)
  if (!Array.isArray(integration?.nativeStatements) || !Array.isArray(integration.checkpoint) || !integration.checkpoint.length)
    reject('IMPORT_ERASURE_FENCE', 'Native cleanup SQL and a portability redaction checkpoint are required.')
  const donor = await db.prepare('SELECT id,email,source_ref,erased_at,version FROM cf_donors WHERE id=?').bind(donorId).first<{ id: string; email: string | null; source_ref: string | null; erased_at: string | null; version:number }>()
  if (!donor) reject('NOT_FOUND', 'That donor does not exist.', 404)
  if (donor.erased_at) reject('ALREADY_ERASED', 'This donor has already been erased.')
  const context = importContext(db, actor, authority)
  const predicate = context.authorization.predicate
  // The handler's owner decision is repeated inside the atomic batch.
  context.authorization.predicate = (action, target) => {
    const grant = predicate(action, target)
    return { sql: `(${grant.sql}) AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active')`, params: [...grant.params ?? [], actor.id] }
  }
  const households = await db.prepare('SELECT id,version FROM cf_households WHERE id=(SELECT household_id FROM cf_donors WHERE id=?) OR head_donor_id=?').bind(donorId,donorId).all<{id:string;version:number}>()
  const householdStatements = [
    ...households.results.map(h=>guard(sql('EXISTS(SELECT 1 FROM cf_households WHERE id=? AND version=?)',h.id,h.version))),
    sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
      SELECT ?,?,?,?,'household.erase','household',id,NULL,json_object('oldHead',head_donor_id,'newHead',CASE WHEN head_donor_id=? THEN NULL ELSE head_donor_id END,'overridesSet',json('[]'),'overridesCleared',json('["addressee","formal","informal"]'),'membershipChanged',json('true'))
      FROM cf_households WHERE id=(SELECT household_id FROM cf_donors WHERE id=?) OR head_donor_id=?`,new Date().toISOString(),actor.id,actor.name,actor.role,donorId,donorId,donorId),
  ]
  const fence = guard(sql('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL)', donorId, donor.version))
  if (!await db.prepare('SELECT 1 FROM ik_jobs WHERE destination=? LIMIT 1').bind(destination).first()) {
    // Nothing was ever imported: there is no kit custody to rewrite. The same
    // portability checkpoint still refuses an older archive.
    const receiptId = crypto.randomUUID(), grant = context.authorization.predicate('erase', destination)
    const statements = [guard(grant), fence, ...householdStatements, ...integration.nativeStatements, ...integration.checkpoint,
      sql('INSERT INTO ik_d1_erasure_journal VALUES(?,?,?,?,?,?,?)', receiptId, destination, new Date().toISOString(), 1, 0, 0, JSON.stringify([{ store: 'cf_donors', rows: 1 }]))]
    await db.batch(statements.map(s => db.prepare(s.sql).bind(...s.params ?? [])))
    return { receiptId, recordsErased: 1 }
  }
  // A previous erasure may invalidate the retained index. Upgrade through the
  // kit's authorized public operation before selecting the next alias.
  let index = await upgradeD1ImportErasureIndex(context)
  while (!index.complete) index = await upgradeD1ImportErasureIndex(context)
  // Stripe objects name a donor by customer id or email: the customer record
  // itself, and every charge that points at the customer or carries the email.
  const linked = await db.prepare('SELECT customer_id FROM cf_subscriptions WHERE donor_id=? UNION SELECT customer_id FROM cf_giving_customers WHERE donor_id=?').bind(donorId, donorId).all<{customer_id:string}>()
  const aliases = await db.prepare("SELECT email FROM cf_donor_aliases WHERE donor_id=? UNION SELECT value AS email FROM cf_contact_points WHERE donor_id=? AND kind='email' UNION SELECT json_extract(snapshot,'$.value') AS email FROM cf_contact_history WHERE donor_id=? AND json_extract(snapshot,'$.kind')='email'").bind(donorId,donorId,donorId).all<{email:string}>()
  const ids = new Set([donor.source_ref, ...linked.results.map(r => r.customer_id)].filter(Boolean) as string[]), emails = new Set([donor.email,...aliases.results.map(a=>a.email)].filter(Boolean).map(e=>e!.toLowerCase()))
  const names = (p: SnapshotObject) => {
    const billing = (p.billing_details ?? {}) as SnapshotObject
    return ids.has(String(p.id)) || ids.has(String(p.customer)) || [p.email, billing.email, p.receipt_email].some(x => typeof x === 'string' && emails.has(x.trim().toLowerCase()))
  }
  const text = new TextDecoder()
  context.originalErasurePolicy = 'withdraw-affected-artifacts'
  return retireD1ImportCustody({
    target: { kind: 'donor', id: donorId },
    related: {
      source: record => names(record.payload as SnapshotObject),
      original: bytes => { const raw = text.decode(bytes).toLowerCase(); return [...ids].some(id => raw.includes(id.toLowerCase())) || [...emails].some(email=>raw.includes(email)) },
    },
  }, [fence, ...householdStatements, ...integration.nativeStatements], context, integration.checkpoint)
}

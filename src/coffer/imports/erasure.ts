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
export function donorErasureStatements(donor: { id: string; email: string | null; emails?: string[] }, placeholderId: string, now: string): D1Sql[] {
  const donorId = donor.id
  return [
    ...[donorId, donor.email,...(donor.emails??[])].filter(Boolean).map(value => sql('INSERT OR IGNORE INTO cf_erasures(hash,erased_at) VALUES(?,?)', erasureHash(value!), now)),
    sql('INSERT INTO cf_donors(id,version,name,source,source_ref,created_at,erased_at) SELECT ?,1,?,source,NULL,?,? FROM cf_donors WHERE id=?', placeholderId, ERASED, now, now, donorId),
    sql("UPDATE cf_donors SET version=version+1,name=?,email=NULL,phone=NULL,address_line1=NULL,address_line2=NULL,city=NULL,region=NULL,postal_code=NULL,country=NULL,household_id=NULL,source_ref=NULL,erased_at=? WHERE id=?", ERASED, now, donorId),
    sql('DELETE FROM cf_consents WHERE donor_id=?', donorId),
    sql('UPDATE cf_gifts SET version=version+1,note=NULL,donor_id=? WHERE donor_id=?', placeholderId, donorId),
    sql('UPDATE cf_pledge_adjustments SET reason=NULL WHERE pledge_id IN (SELECT id FROM cf_pledges WHERE donor_id=?)', donorId),
    sql('DELETE FROM cf_pledge_plans WHERE pledge_id IN (SELECT id FROM cf_pledges WHERE donor_id=?)', donorId),
    sql('UPDATE cf_pledges SET donor_id=? WHERE donor_id=?', placeholderId, donorId),
    sql("UPDATE cf_acks SET donor_id=?,recipient_name=?,recipient_email=NULL,address=NULL,statement_gifts=NULL,delivery_note=NULL,subject='[erased]',body='[erased]' WHERE donor_id=?", placeholderId, ERASED, donorId),
    sql('UPDATE cf_appeal_recipients SET donor_id=?,name=?,email=NULL,address=NULL WHERE donor_id=?', placeholderId, ERASED, donorId),
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
  const donor = await db.prepare('SELECT id,email,source_ref,erased_at FROM cf_donors WHERE id=?').bind(donorId).first<{ id: string; email: string | null; source_ref: string | null; erased_at: string | null }>()
  if (!donor) reject('NOT_FOUND', 'That donor does not exist.', 404)
  if (donor.erased_at) reject('ALREADY_ERASED', 'This donor has already been erased.')
  const context = importContext(db, actor, authority)
  const predicate = context.authorization.predicate
  // The handler's owner decision is repeated inside the atomic batch.
  context.authorization.predicate = (action, target) => {
    const grant = predicate(action, target)
    return { sql: `(${grant.sql}) AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active')`, params: [...grant.params ?? [], actor.id] }
  }
  const fence = guard(sql('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL)', donorId))
  if (!await db.prepare('SELECT 1 FROM ik_jobs WHERE destination=? LIMIT 1').bind(destination).first()) {
    // Nothing was ever imported: there is no kit custody to rewrite. The same
    // portability checkpoint still refuses an older archive.
    const receiptId = crypto.randomUUID(), grant = context.authorization.predicate('erase', destination)
    const statements = [guard(grant), fence, ...integration.nativeStatements, ...integration.checkpoint,
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
  const aliases = await db.prepare('SELECT email FROM cf_donor_aliases WHERE donor_id=?').bind(donorId).all<{email:string}>()
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
  }, [fence, ...integration.nativeStatements], context, integration.checkpoint)
}

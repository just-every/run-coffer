import type { D1Database, D1ImportContext, D1Sql } from '../../modules/import-kit/src/d1/index.ts'
import { ledgerTargets } from './targets.ts'
import { reject, type ImportActor, type ImportAuthority } from './types.ts'

export const destination = 'coffer:donor-ledger'
export const namespace = 'stripe:customers-charges'
export const mappingVersion = 'stripe-customers-charges-v1'
// Custody survives archive restore, where operator IDs are deliberately replaced.
export const principalId = 'role:owner'

export function importPredicate(actor: ImportActor, authority: ImportAuthority): D1Sql {
  if (!actor?.id || !['owner', 'admin'].includes(actor.role))
    reject('FORBIDDEN', 'An active owner or admin must perform this import action.', 403)
  if (!authority || typeof authority.sql !== 'string' || !authority.sql.trim() || !Array.isArray(authority.params))
    reject('IMPORT_AUTHORITY', 'A current-session authorization predicate is required.', 403)
  return {
    sql: `(${authority.sql}) AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role=? AND role IN ('owner','admin') AND status='active')`,
    params: [...authority.params, actor.id, actor.role],
  }
}

export function importContext(db: D1Database, actor: ImportActor, authority: ImportAuthority): D1ImportContext {
  importPredicate(actor, authority)
  return {
    destination, namespace, mappingVersion,
    // Each request publishes what its D1 budget allows; Continue resumes the rest.
    batchSize: 100,
    storage: { database: db, targets: ledgerTargets },
    authorization: { principalId, predicate: () => importPredicate(actor, authority) },
  }
}

export async function authorize(db: D1Database, actor: ImportActor, authority: ImportAuthority) {
  const predicate = importPredicate(actor, authority)
  const row = await db.prepare(`SELECT CASE WHEN (${predicate.sql}) THEN 1 ELSE 0 END AS allowed`)
    .bind(...predicate.params!).first<{ allowed: number }>()
  if (row?.allowed !== 1) reject('FORBIDDEN', 'The current session cannot perform this import action.', 403)
}

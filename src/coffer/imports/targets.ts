import { type D1Sql, type D1TargetAdapter, type Json, type TargetRow } from '../../modules/import-kit/src/d1/index.ts'
import { guard } from '../../modules/import-kit/src/d1/database.ts'
import { destination } from './context.ts'
import { reject } from './types.ts'

const sql = (text: string, ...params: any[]): D1Sql => ({ sql: text, params })
type Kind = 'donor' | 'gift'
// Native columns and the value keys the kit sees, in a fixed order.
const COLUMNS: Record<Kind, [string, string][]> = {
  donor: [['id', 'id'], ['version', 'version'], ['name', 'name'], ['email', 'email'], ['phone', 'phone'], ['address_line1', 'addressLine1'], ['address_line2', 'addressLine2'], ['city', 'city'], ['region', 'region'], ['postal_code', 'postalCode'], ['country', 'country'], ['household_id', 'householdId'], ['source', 'source'], ['source_ref', 'sourceRef'], ['created_at', 'createdAt'], ['erased_at', 'erasedAt']],
  gift: [['id', 'id'], ['version', 'version'], ['donor_id', 'donorId'], ['kind', 'kind'], ['reverses', 'reverses'], ['received_on', 'receivedOn'], ['amount_cents', 'amountCents'], ['method', 'method'], ['reference', 'reference'], ['fund', 'fund'], ['pledge_id', 'pledgeId'], ['goods', 'goods'], ['goods_cents', 'goodsCents'], ['goods_description', 'goodsDescription'], ['note', 'note'], ['source', 'source'], ['created_at', 'createdAt'], ['created_by', 'createdBy']],
}
const TABLE: Record<Kind, string> = { donor: 'cf_donors', gift: 'cf_gifts' }
// The bridge translates the kit's opaque revision into the native version.
const revision = `CASE WHEN m.native_revision=t.version THEN m.import_revision ELSE 'native:'||t.version END`
const from = (kind: Kind) => `${TABLE[kind]} t LEFT JOIN cf_import_revisions m ON m.kind='${kind}' AND m.id=t.id`
const select = (kind: Kind) => `SELECT ${COLUMNS[kind].map(([c]) => `t.${c}`).join(',')},${revision} AS kit_revision FROM ${from(kind)}`

function scope(target: string, kind?: string): Kind {
  if (target !== destination || (kind !== undefined && kind !== 'donor' && kind !== 'gift')) reject('IMPORT_SCOPE', 'Unsupported import destination or record kind.')
  return kind as Kind
}
function decode(kind: Kind, row: Record<string, any>): TargetRow {
  const value: Record<string, Json> = {}
  for (const [column, key] of COLUMNS[kind]) value[key] = row[column] ?? null
  return { destination, targetKind: kind, targetId: row.id, revision: row.kit_revision, value }
}
function values(kind: Kind, row: TargetRow): any[] {
  const value = row.value as Record<string, Json>
  if (!value || value.id !== row.targetId || !Number.isSafeInteger(value.version) || (value.version as number) < 1)
    reject('IMPORT_TARGET', 'An imported record must carry its native ID and numeric version.')
  return COLUMNS[kind].map(([, key]) => value[key] ?? null)
}

export const ledgerTargets: D1TargetAdapter = {
  async read(db, target, kind, id) {
    const k = scope(target, kind)
    const row = await db.prepare(`${select(k)} WHERE t.id=?`).bind(id).first<Record<string, any>>()
    return row ? decode(k, row) : undefined
  },
  matches(row, target, kind, id) {
    const k = scope(target, kind)
    if (!row) return sql(`NOT EXISTS(SELECT 1 FROM ${TABLE[k]} WHERE id=?) AND NOT EXISTS(SELECT 1 FROM cf_import_revisions WHERE kind='${k}' AND id=?)`, id, id)
    // Every native column, null-safe, plus the translated revision.
    return sql(`EXISTS(SELECT 1 FROM ${from(k)} WHERE t.id=? AND ${revision}=? AND ${COLUMNS[k].map(([c]) => `t.${c} IS ?`).join(' AND ')})`, id, row.revision, ...values(k, row))
  },
  write(row) {
    const k = scope(row.destination, row.targetKind), v = values(k, row), columns = COLUMNS[k].map(([c]) => c)
    const statements: D1Sql[] = []
    if (k === 'donor' && (row.value as Record<string, Json>).email)
      statements.push(guard(sql(`NOT EXISTS(SELECT 1 FROM cf_donors WHERE id<>? AND email=?)`, row.targetId, (row.value as Record<string, Json>).email)))
    if (k === 'gift')
      statements.push(guard(sql(`EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL)`, (row.value as Record<string, Json>).donorId)))
    statements.push(
      sql(`INSERT INTO ${TABLE[k]}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).map(c => `${c}=excluded.${c}`).join(',')}`, ...v),
      sql(`INSERT INTO cf_import_revisions(kind,id,import_revision,native_revision) VALUES('${k}',?,?,?) ON CONFLICT(kind,id) DO UPDATE SET import_revision=excluded.import_revision,native_revision=excluded.native_revision`, row.targetId, row.revision, v[1]))
    return statements
  },
  remove(target, kind, id) {
    const k = scope(target, kind)
    // Undo leaves anything a person has since built on the record in place.
    const inUse = k === 'gift'
      ? `NOT EXISTS(SELECT 1 FROM cf_acks WHERE gift_id=?) AND NOT EXISTS(SELECT 1 FROM cf_gifts WHERE reverses=?)`
      : `NOT EXISTS(SELECT 1 FROM cf_gifts WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_consents WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_pledges WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_acks WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_appeal_recipients WHERE donor_id=?)`
    return [guard(sql(inUse, ...Array(k === 'gift' ? 2 : 5).fill(id))), sql(`DELETE FROM cf_import_revisions WHERE kind='${k}' AND id=?`, id), sql(`DELETE FROM ${TABLE[k]} WHERE id=?`, id)]
  },
  async list(db, target) {
    scope(target)
    const rows: TargetRow[] = []
    for (const k of ['donor', 'gift'] as const) rows.push(...(await db.prepare(`${select(k)} ORDER BY t.id`).all<Record<string, any>>()).results.map(r => decode(k, r)))
    return rows
  },
  matchesCount(count, target) {
    scope(target)
    return sql(`(SELECT COUNT(*) FROM cf_donors)+(SELECT COUNT(*) FROM cf_gifts)=?`, count)
  },
}

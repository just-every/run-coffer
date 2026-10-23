import { type D1Sql, type D1TargetAdapter, type Json, type TargetRow } from '../../modules/import-kit/src/d1/index.ts'
import { guard } from '../../modules/import-kit/src/d1/database.ts'
import { destination } from './context.ts'
import { reject } from './types.ts'

const sql = (text: string, ...params: any[]): D1Sql => ({ sql: text, params })
type Kind = 'donor' | 'gift' | 'campaign' | 'subscription'
// Native columns and the value keys the kit sees, in a fixed order.
const COLUMNS: Record<Kind, [string, string][]> = {
  donor: [['id', 'id'], ['version', 'version'], ['name', 'name'], ['email', 'email'], ['phone', 'phone'], ['address_line1', 'addressLine1'], ['address_line2', 'addressLine2'], ['city', 'city'], ['region', 'region'], ['postal_code', 'postalCode'], ['country', 'country'], ['household_id', 'householdId'], ['source', 'source'], ['source_ref', 'sourceRef'], ['created_at', 'createdAt'], ['erased_at', 'erasedAt']],
  gift: [['id', 'id'], ['version', 'version'], ['donor_id', 'donorId'], ['kind', 'kind'], ['reverses', 'reverses'], ['received_on', 'receivedOn'], ['amount_cents', 'amountCents'], ['method', 'method'], ['reference', 'reference'], ['fund', 'fund'], ['pledge_id', 'pledgeId'], ['goods', 'goods'], ['goods_cents', 'goodsCents'], ['goods_description', 'goodsDescription'], ['note', 'note'], ['source', 'source'], ['created_at', 'createdAt'], ['created_by', 'createdBy']],
  campaign: [['id', 'id'], ['slug', 'slug'], ['name', 'name'], ['description', 'description'], ['fund', 'fund'], ['goal_cents', 'goalCents'], ['active', 'active'], ['created_at', 'createdAt']],
  subscription: [['id', 'id'], ['donor_id', 'donorId'], ['campaign_id', 'campaignId'], ['customer_id', 'customerId'], ['amount_cents', 'amountCents'], ['status', 'status'], ['cancel_at_period_end', 'cancelAtPeriodEnd'], ['failed_attempts', 'failedAttempts'], ['recovered', 'recovered'], ['next_attempt_at', 'nextAttemptAt'], ['updated_at', 'updatedAt']],
}
const TABLE: Record<Kind, string> = { donor: 'cf_donors', gift: 'cf_gifts', campaign: 'cf_campaigns', subscription: 'cf_subscriptions' }
// The bridge translates the kit's opaque revision into the native version.
// Campaigns and subscriptions have no version counter: exact native values,
// including subscription updated_at, fence every edit instead.
const revision = (kind: Kind) => kind === 'donor' || kind === 'gift'
  ? `CASE WHEN m.native_revision=t.version THEN m.import_revision ELSE 'native:'||t.version END`
  : `CASE WHEN m.native_revision=1 THEN m.import_revision ELSE 'native:unowned' END`
const from = (kind: Kind) => `${TABLE[kind]} t LEFT JOIN cf_import_revisions m ON m.kind='${kind}' AND m.id=t.id`
const select = (kind: Kind) => `SELECT ${COLUMNS[kind].map(([c]) => `t.${c}`).join(',')},${revision(kind)} AS kit_revision${kind === 'gift' ? `,(SELECT appeal FROM cf_gift_appeals WHERE gift_id=t.id) AS appeal,(SELECT json_object('grossCents',gross_cents,'refundedCents',refunded_cents,'netCents',net_cents,'status',status) FROM cf_import_refunds WHERE gift_id=t.id) AS refund_facts` : ''} FROM ${from(kind)}`

function scope(target: string, kind?: string): Kind {
  if (target !== destination || (kind !== undefined && !Object.hasOwn(TABLE, kind))) reject('IMPORT_SCOPE', 'Unsupported import destination or record kind.')
  return kind as Kind
}
function decode(kind: Kind, row: Record<string, any>): TargetRow {
  const value: Record<string, Json> = {}
  for (const [column, key] of COLUMNS[kind]) value[key] = row[column] ?? null
  if (kind === 'gift' && row.refund_facts) Object.assign(value, JSON.parse(row.refund_facts))
  if (kind === 'gift' && row.appeal) value.appeal = row.appeal
  return { destination, targetKind: kind, targetId: row.id, revision: row.kit_revision, value }
}
function values(kind: Kind, row: TargetRow): any[] {
  const value = row.value as Record<string, Json>
  if (!value || value.id !== row.targetId)
    reject('IMPORT_TARGET', 'An imported record must carry its native ID.')
  if ((kind === 'donor' || kind === 'gift') && (!Number.isSafeInteger(value.version) || (value.version as number) < 1))
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
    const facts = row.value as Record<string, Json>
    const refundMatch = k !== 'gift' ? '' : facts.grossCents === undefined ? ' AND NOT EXISTS(SELECT 1 FROM cf_import_refunds WHERE gift_id=t.id)' : ' AND EXISTS(SELECT 1 FROM cf_import_refunds WHERE gift_id=t.id AND gross_cents IS ? AND refunded_cents IS ? AND net_cents IS ? AND status IS ?)'
    return sql(`EXISTS(SELECT 1 FROM ${from(k)} WHERE t.id=? AND ${revision(k)}=? AND ${COLUMNS[k].map(([c]) => `t.${c} IS ?`).join(' AND ')}${refundMatch})`, id, row.revision, ...values(k, row), ...(k === 'gift' && facts.grossCents !== undefined ? [facts.grossCents, facts.refundedCents, facts.netCents, facts.status] : []))
  },
  write(row) {
    const k = scope(row.destination, row.targetKind), v = values(k, row), columns = COLUMNS[k].map(([c]) => c)
    const statements: D1Sql[] = []
    if (k === 'donor' && (row.value as Record<string, Json>).email)
      statements.push(guard(sql(`NOT EXISTS(SELECT 1 FROM cf_donors WHERE id<>? AND email=?)`, row.targetId, (row.value as Record<string, Json>).email)))
    if (k === 'gift' || k === 'subscription')
      statements.push(guard(sql(`EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL)`, (row.value as Record<string, Json>).donorId)))
    if (k === 'subscription')
      statements.push(guard(sql('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=?)', (row.value as Record<string, Json>).campaignId)))
    statements.push(
      sql(`INSERT INTO ${TABLE[k]}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).map(c => `${c}=excluded.${c}`).join(',')}`, ...v),
      sql(`INSERT INTO cf_import_revisions(kind,id,import_revision,native_revision) VALUES('${k}',?,?,?) ON CONFLICT(kind,id) DO UPDATE SET import_revision=excluded.import_revision,native_revision=excluded.native_revision`, row.targetId, row.revision, k === 'donor' || k === 'gift' ? v[1] : 1))
    if (k === 'gift' && (row.value as Record<string, Json>).grossCents !== undefined) {
      const facts = row.value as Record<string, Json>
      statements.push(sql('INSERT INTO cf_import_refunds(gift_id,gross_cents,refunded_cents,net_cents,status) VALUES(?,?,?,?,?)', row.targetId, facts.grossCents, facts.refundedCents, facts.netCents, facts.status))
    }
    if (k === 'subscription') {
      const source = row.value as Record<string, Json>
      statements.push(sql('UPDATE cf_subscription_lifetimes SET started_at=?,start_known=1 WHERE subscription_id=?',source.updatedAt,row.targetId),
        sql('UPDATE cf_subscription_history SET observed_at=? WHERE subscription_id=?',new Date().toISOString(),row.targetId))
    }
    if (k === 'gift' && (row.value as Record<string, Json>).appeal) statements.push(sql('INSERT INTO cf_gift_appeals(gift_id,appeal) VALUES(?,?) ON CONFLICT(gift_id) DO UPDATE SET appeal=excluded.appeal', row.targetId, (row.value as Record<string, Json>).appeal))
    return statements
  },
  remove(target, kind, id) {
    const k = scope(target, kind)
    // Undo leaves anything a person has since built on the record in place.
    const inUse = k === 'gift'
      ? `NOT EXISTS(SELECT 1 FROM cf_acks WHERE gift_id=?) AND NOT EXISTS(SELECT 1 FROM cf_gifts WHERE reverses=?) AND NOT EXISTS(SELECT 1 FROM cf_soft_credits WHERE gift_id=?) AND NOT EXISTS(SELECT 1 FROM cf_gift_tributes WHERE gift_id=?) AND NOT EXISTS(SELECT 1 FROM cf_employer_matches WHERE gift_id=? OR received_gift_id=?) AND NOT EXISTS(SELECT 1 FROM cf_pledge_allocations WHERE gift_id=?) AND NOT EXISTS(SELECT 1 FROM cf_gift_allocations WHERE gift_id=?) AND NOT EXISTS(SELECT 1 FROM cf_campaign_gifts WHERE gift_id=?) AND NOT EXISTS(SELECT 1 FROM cf_subscription_gifts WHERE gift_id=?) AND NOT EXISTS(SELECT 1 FROM cf_prospects WHERE gift_id=?) AND NOT EXISTS(SELECT 1 FROM cf_gift_recognition WHERE gift_id=?) AND NOT EXISTS(SELECT 1 FROM cf_record_documents WHERE gift_id=?)`
      : k === 'subscription'
      ? `NOT EXISTS(SELECT 1 FROM cf_subscription_gifts WHERE subscription_id=?) AND NOT EXISTS(SELECT 1 FROM cf_agent_recovery WHERE subscription_id=?)`
      : k === 'campaign'
      ? `NOT EXISTS(SELECT 1 FROM cf_subscriptions WHERE campaign_id=?) AND NOT EXISTS(SELECT 1 FROM cf_giving_intents WHERE campaign_id=?) AND NOT EXISTS(SELECT 1 FROM cf_campaign_gifts WHERE campaign_id=?) AND NOT EXISTS(SELECT 1 FROM cf_gift_allocations WHERE campaign_id=?) AND NOT EXISTS(SELECT 1 FROM cf_communications WHERE campaign_id=?) AND NOT EXISTS(SELECT 1 FROM cf_prospects WHERE campaign_id=?)`
      : `NOT EXISTS(SELECT 1 FROM cf_gifts WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_consents WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_pledges WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_acks WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_appeal_recipients WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_relationships WHERE donor_id=? OR related_donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_interactions WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=? OR into_id=?) AND NOT EXISTS(SELECT 1 FROM cf_donor_notes WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_move_in_records WHERE donor_id=? OR related_id=?) AND NOT EXISTS(SELECT 1 FROM cf_prospects WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_call_tasks WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_subscriptions WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_planned_gifts WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_legacy_memberships WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_portfolio_members WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_grants WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_in_kind_gifts WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_volunteering WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_research_results WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_donor_recognition WHERE donor_id=?) AND NOT EXISTS(SELECT 1 FROM cf_record_documents WHERE donor_id=?)`
    return [guard(sql(inUse, ...Array(k === 'gift' ? 13 : k === 'subscription' ? 2 : k === 'campaign' ? 6 : 25).fill(id))),
      ...(k === 'donor' ? [sql('DELETE FROM cf_contact_history WHERE donor_id=?', id), sql('DELETE FROM cf_contact_points WHERE donor_id=?', id)] : []),
      sql(`DELETE FROM cf_import_revisions WHERE kind='${k}' AND id=?`, id), sql(`DELETE FROM ${TABLE[k]} WHERE id=?`, id)]
  },
  async list(db, target) {
    scope(target)
    const rows: TargetRow[] = []
    for (const k of ['donor', 'gift', 'campaign', 'subscription'] as const) rows.push(...(await db.prepare(`${select(k)} ORDER BY t.id`).all<Record<string, any>>()).results.map(r => decode(k, r)))
    return rows
  },
  matchesCount(count, target) {
    scope(target)
    return sql(`(SELECT COUNT(*) FROM cf_donors)+(SELECT COUNT(*) FROM cf_gifts)+(SELECT COUNT(*) FROM cf_campaigns)+(SELECT COUNT(*) FROM cf_subscriptions)=?`, count)
  },
}

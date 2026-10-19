import type { SourceRecord } from '../../modules/import-kit/src/d1/index.ts'
import type { NativeIndex } from './snapshots.ts'
import { donorId } from './snapshots.ts'
import { reject } from './types.ts'

/** Collect every occurrence before refusing a saved upload, including skipped objects. */
export function rejectDuplicateIds(records: SourceRecord[], native: NativeIndex, liveRead: boolean) {
  const groups = new Map<string, SourceRecord[]>()
  for (const record of records) {
    const key = `${record.kind}:${record.sourceId}`
    groups.set(key, [...groups.get(key) ?? [], record])
  }
  const duplicates = [...groups.values()].flatMap(rows => {
    const first = rows[0]
    const imported = first.kind === 'customer' ? native.donorIds.has(donorId(first.sourceId))
      : first.kind === 'charge' ? native.charges.has(first.sourceId)
      : first.kind === 'subscription' ? native.subscriptions.subscriptions.has(first.sourceId) : false
    if (rows.length < 2 && (liveRead || !imported)) return []
    return rows.map(row => ({ kind: row.kind, sourceId: row.sourceId, ...row.location,
      reason: rows.length > 1 && imported && !liveRead ? 'Repeated in this upload and already imported.' : rows.length > 1 ? 'Repeated in this upload.' : 'Already imported.' }))
  })
  if (duplicates.length) reject('IMPORT_DUPLICATE_ID', `Fix every duplicate before importing: ${duplicates.map(d => `${d.sourceId} in ${d.artifact} row ${d.row} (${d.reason})`).join('; ')}`, 409, duplicates)
}

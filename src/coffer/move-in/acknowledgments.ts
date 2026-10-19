import { normalizeLabel } from './source-columns'
import type { SourceRow } from './source-rows'
import type { ParsedAcknowledgment } from './types'

const statuses: Record<string, ParsedAcknowledgment['status']> = {
 acknowledged: 'acknowledged', yes: 'acknowledged', y: 'acknowledged', true: 'acknowledged', '1': 'acknowledged',
 notacknowledged: 'not acknowledged', no: 'not acknowledged', n: 'not acknowledged', false: 'not acknowledged', '0': 'not acknowledged',
 donotacknowledge: 'do not acknowledge',
}

/** Source facts only: a date alone cannot establish status, and a status never supplies a date or method. */
export function acknowledgment(r: SourceRow): ParsedAcknowledgment | undefined {
 const raw = r.get('acknowledgmentStatus'), date = r.get('acknowledgmentDate')
 const method = r.get('acknowledgmentMethod') || null, reason = r.get('acknowledgmentReason') || null
 if (!raw && !date && !method && !reason) return undefined
 const status = statuses[normalizeLabel(raw)]
 if (!status) r.error('ACKNOWLEDGMENT_STATUS', raw
  ? `Acknowledgment status “${raw}” needs review. Export acknowledged, not acknowledged, or do not acknowledge.`
  : 'Acknowledgment details have no status. Export acknowledged, not acknowledged, or do not acknowledge; a date or method alone cannot establish it.', 'acknowledgmentStatus')
 const acknowledgedOn = date ? r.date('acknowledgmentDate') || null : null
 return status ? { status, acknowledgedOn, method, reason } : undefined
}

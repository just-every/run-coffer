import { normalizeLabel } from './source-columns'
import type { SourceRow } from './source-rows'
import type { ParsedAcknowledgment } from './types'

const statuses: Record<string, ParsedAcknowledgment['status']> = {
 acknowledged: 'acknowledged', yes: 'acknowledged', y: 'acknowledged', true: 'acknowledged', '1': 'acknowledged',
 notacknowledged: 'not acknowledged', no: 'not acknowledged', n: 'not acknowledged', false: 'not acknowledged', '0': 'not acknowledged',
 donotacknowledge: 'do not acknowledge',
}

/** MOVE-001..003: each incumbent's facts establish status, with opt-out taking precedence. */
export function acknowledgment(r: SourceRow): ParsedAcknowledgment | undefined {
 const raw = r.get('acknowledgmentStatus'), date = r.get('acknowledgmentDate')
 const method = r.get('acknowledgmentMethod') || null, reason = r.get('acknowledgmentReason') || null
 const template = r.get('acknowledgmentTemplate'), reference = r.get('acknowledgmentReference'), optOut = r.get('acknowledgmentOptOut')
 if (!raw && !date && !method && !reason && !template && !reference && !optOut) return undefined
 const source = r.result.source
 const key = normalizeLabel(raw)
 let status = source === 'lgl' && key === 'donotacknowledgevialgl' ? 'do not acknowledge' as const : Object.hasOwn(statuses,key) ? statuses[key] : undefined
 if (raw && !status) r.error('ACKNOWLEDGMENT_STATUS', `Acknowledgment status “${raw}” needs review. Export acknowledged, not acknowledged, or do not acknowledge.`, 'acknowledgmentStatus')
 const flag = normalizeLabel(optOut)
 if (optOut && !['yes','y','true','1','no','n','false','0'].includes(flag)) r.error('ACKNOWLEDGMENT_STATUS', `Do Not Acknowledge value “${optOut}” needs review. Export a yes/no flag.`, 'acknowledgmentOptOut')
 const acknowledgedOn = date ? r.date('acknowledgmentDate') || null : null
 if (status === 'do not acknowledge' || ['yes','y','true','1'].includes(flag)) status = 'do not acknowledge'
 else if ((source === 'lgl' && template) || (source === 're-nxt' && (acknowledgedOn || reference))) status = 'acknowledged'
 else status ||= 'not acknowledged'
 const sourceReference = template && reference ? `Template: ${template}\nReference: ${reference}` : template || reference || null
 return { status, acknowledgedOn, method: method || (template && status === 'acknowledged' ? 'letter' : null), reason, sourceReference }
}

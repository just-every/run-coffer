import { normalizeLabel } from './source-columns'
import type { SourceRow } from './source-rows'
import type { ParsedAcknowledgment } from './types'

const statuses: Record<string, ParsedAcknowledgment['status']> = {
 acknowledged: 'acknowledged', yes: 'acknowledged', y: 'acknowledged', true: 'acknowledged', '1': 'acknowledged',
 notacknowledged: 'not acknowledged', no: 'not acknowledged', n: 'not acknowledged', false: 'not acknowledged', '0': 'not acknowledged',
 donotacknowledge: 'do not acknowledge',
}

const methods: Record<string,string> = { email:'email',personalemail:'email',letter:'letter',mail:'letter',phone:'phone call',call:'phone call',phonecall:'phone call',telephone:'phone call',inperson:'in person',meeting:'in person',handwrittennote:'handwritten note',handwritten:'handwritten note',other:'other' }

/** MOVE-001..003: each incumbent's facts establish status, with opt-out taking precedence. */
export function acknowledgment(r: SourceRow, softCredit = false): ParsedAcknowledgment | undefined {
 const field = (name: string) => softCredit ? `soft${name[0].toUpperCase()}${name.slice(1)}` : name
 const get = (name: string) => r.get(field(name))
 const raw = get('acknowledgmentStatus'), date = get('acknowledgmentDate')
 const rawMethod = get('acknowledgmentMethod'), reason = get('acknowledgmentReason') || null
 const method = rawMethod ? methods[normalizeLabel(rawMethod)] || null : null
 if (rawMethod && !method) r.error('ACKNOWLEDGMENT_METHOD', `Acknowledgment method “${rawMethod}” needs review. Export email, letter, phone call, in person, handwritten note, or other.`, field('acknowledgmentMethod'))
 const template = get('acknowledgmentTemplate'), reference = get('acknowledgmentReference'), optOut = get('acknowledgmentOptOut'), interactionExternalId = get('acknowledgmentInteraction') || null
 if (!raw && !date && !rawMethod && !reason && !template && !reference && !optOut && !interactionExternalId) return undefined
 const source = r.result.source
 const key = normalizeLabel(raw)
 let status = source === 'lgl' && key === 'donotacknowledgevialgl' ? 'do not acknowledge' as const : Object.hasOwn(statuses,key) ? statuses[key] : undefined
 if (raw && !status) r.error('ACKNOWLEDGMENT_STATUS', `Acknowledgment status “${raw}” needs review. Export acknowledged, not acknowledged, or do not acknowledge.`, field('acknowledgmentStatus'))
 const flag = normalizeLabel(optOut)
 if (optOut && !['yes','y','true','1','no','n','false','0'].includes(flag)) r.error('ACKNOWLEDGMENT_STATUS', `Do Not Acknowledge value “${optOut}” needs review. Export a yes/no flag.`, field('acknowledgmentOptOut'))
 const acknowledgedOn = date ? r.date(field('acknowledgmentDate')) || null : null
 if (status === 'do not acknowledge' || ['yes','y','true','1'].includes(flag)) status = 'do not acknowledge'
 else if ((source === 'lgl' && template) || (source === 're-nxt' && (acknowledgedOn || reference))) status = 'acknowledged'
 else status ||= 'not acknowledged'
 if (interactionExternalId && status !== 'acknowledged') r.error('ACKNOWLEDGMENT_LINK', 'A linked acknowledgment interaction requires acknowledged status. Correct the source status, or retain an unrelated historical reference in Acknowledgment Reference instead.', field('acknowledgmentInteraction'))
 const sourceReference = [template && reference ? `Template: ${template}\nReference: ${reference}` : template || reference, interactionExternalId ? `Interaction: ${interactionExternalId}` : ''].filter(Boolean).join('\n') || null
 return { status, acknowledgedOn, method: method || (template && status === 'acknowledged' ? 'letter' : null), reason, sourceReference, ...(interactionExternalId ? { interactionExternalId } : {}) }
}

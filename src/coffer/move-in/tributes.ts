import { normalizeLabel } from './source-columns'
import type { SourceRow } from './source-rows'
import type { ParsedTribute } from './types'

const TRIBUTE_TYPES: Record<string, 'honor'|'memory'> = { honor: 'honor', memory: 'memory', inhonorof: 'honor', inmemoryof: 'memory' }

/** These are source facts, never a deduction from a campaign or tribute group name. */
export function tribute(r: SourceRow): ParsedTribute | undefined {
 const honoree = r.get('tributeHonoree'), raw = r.get('tributeType'), sourceGroup = r.get('tributeGroup')
 const notifiedName = r.get('tributeNotifiedName'), notifiedEmail = r.get('tributeNotifiedEmail'), notifiedAddress = r.get('tributeNotifiedAddress')
 const flag = r.get('hasTribute'), flagKey = normalizeLabel(flag)
 const hasTribute = ['yes','true','1'].includes(flagKey), noTribute = ['no','false','0'].includes(flagKey)
 if (flag && !hasTribute && !noTribute) r.error('TRIBUTE_FLAG', 'Has Tribute must be Yes or No.', 'hasTribute')
 const present = !!(honoree || raw || sourceGroup || notifiedName || notifiedEmail || notifiedAddress)
 if (!present && !hasTribute) return undefined
 if (noTribute && present) r.error('TRIBUTE_CONFLICT', 'Has Tribute is No but this gift has tribute details. Correct the source row.', 'hasTribute')
 const key = normalizeLabel(raw), kind = Object.hasOwn(TRIBUTE_TYPES,key) ? TRIBUTE_TYPES[key] : undefined
 if (!kind) r.error('TRIBUTE_TYPE', 'Supply an explicit tribute type: In Honor Of or In Memory Of (honor or memory). A tribute group or description cannot establish the type.', 'tributeType')
 if (!honoree) r.error('TRIBUTE_HONOREE', 'Supply the honoree name. A tribute group name cannot identify the person being honored or remembered.', 'tributeHonoree')
 if (notifiedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifiedEmail)) r.error('TRIBUTE_EMAIL', 'Export a single valid tribute recipient email address.', 'tributeNotifiedEmail')
 if (!kind || !honoree) return undefined
 return { kind, honoree, ...(notifiedName ? { notifiedName } : {}), ...(notifiedEmail ? { notifiedEmail } : {}), ...(notifiedAddress ? { notifiedAddress } : {}), ...(sourceGroup ? { sourceGroup } : {}) }
}

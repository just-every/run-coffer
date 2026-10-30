import type { ParsedImport } from './types'
import type { SourceRecord } from './custom-review-types'

/** Keep the complete source index, including the distinction between NXT actions and notes. */
export function sourceRecords(parsed:ParsedImport):SourceRecord[]{return [
 ...parsed.donors.map(d=>({kind:'constituent' as const,externalId:d.externalId,donorExternalId:d.externalId})),
 ...parsed.gifts.map(g=>({kind:'gift' as const,externalId:g.externalId,donorExternalId:g.donorExternalId})),
 ...parsed.notes.map(n=>({kind:(['call','meeting','email'].includes(n.type)?'interaction':'note') as 'interaction'|'note',externalId:n.externalId,donorExternalId:n.donorExternalId,sourceObject:n.sourceObject})),
]}

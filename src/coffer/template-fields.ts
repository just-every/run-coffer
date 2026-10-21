import type { Row } from './db'
import { nameMergeFields } from './person-names'

/** One syntax for reviewed receipt templates. Defaults are literal text, not
 * another template; malformed or nested fields are rejected when saving. */
export const fieldPattern = () => /\{\{\s*([a-z_][a-z0-9_.]*)(?:\|([^{}|\r\n]+))?\s*\}\}/g
export const templateTokens = (value: string) => [...value.matchAll(fieldPattern())].map(m => ({ field: m[1], fallback: m[2]?.trim() }))
export const fillFields = (value: string, fields: Record<string, string>) => value.replace(fieldPattern(), (_, name, fallback) => fields[name]?.trim() ? fields[name] : fallback?.trim() ?? '')

export const CONTACT_MERGE_FIELDS = ['email', 'postal_address']
/** Today's primary contact, using the same frozen delivery address as the letter. */
export function recipientMergeFields(d: Row): Record<string, string> {
 const a = d.letter_address ? JSON.parse(d.letter_address) : { line1: d.address_line1, line2: d.address_line2, city: d.city, region: d.region, postalCode: d.postal_code, country: d.country }
 return { ...nameMergeFields(d), email: d.email ?? '', postal_address: [a?.line1, a?.line2, a?.city, a?.region, a?.postalCode, a?.country].filter(Boolean).join('\n') }
}

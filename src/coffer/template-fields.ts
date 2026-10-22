import type { Row } from './db'
import { nameMergeFields } from './person-names'

/** One syntax for reviewed receipt templates. Defaults are literal text, not
 * another template; malformed or nested fields are rejected when saving. */
export const fieldPattern = () => /\{\{\s*([a-z_][a-z0-9_.]*)(?:\|([^{}|\r\n]+))?\s*\}\}/g
export const templateTokens = (value: string) => [...value.matchAll(fieldPattern())].map(m => ({ field: m[1], fallback: m[2]?.trim() }))
export const fillFields = (value: string, fields: Record<string, string>) => value.replace(fieldPattern(), (_, name, fallback) => fields[name]?.trim() ? fields[name] : fallback?.trim() ?? '')

export const CONTACT_MERGE_FIELDS = ['email', 'postal_address']
export const HOUSEHOLD_MERGE_FIELDS = ['household_addressee', 'household_informal_salutation', 'household_formal_salutation']
/** Today's primary contact, using the same frozen delivery address as the letter. */
export function recipientMergeFields(d: Row): Record<string, string> {
 const a = d.letter_address ? JSON.parse(d.letter_address) : { line1: d.address_line1, line2: d.address_line2, city: d.city, region: d.region, postalCode: d.postal_code, country: d.country }
 const household = d.letter_household_names
 return { ...nameMergeFields(d), household_addressee: household?.addressee ?? '', household_informal_salutation: household?.informal ?? '', household_formal_salutation: household?.formal ?? '', email: d.email ?? '', postal_address: a?.line1 ? [a.line1, a.line2, a.city, a.region, a.postalCode, a.country].filter(Boolean).join('\n') : '' }
}

/** Freeze the fields that actually rendered blank, alongside the exact wording.
 * Defaults and populated values use the same rules as fillFields. */
export function renderTemplate(template: { subject: string; body: string }, fields: Record<string, string>) {
 const blanks = [...new Set(templateTokens(template.subject + '\n' + template.body)
  .filter(t => !fields[t.field]?.trim() && !t.fallback).map(t => t.field))]
 return { subject: fillFields(template.subject, fields), body: fillFields(template.body, fields), merge_blanks: JSON.stringify(blanks) }
}

/** A review names the prepared recipient, never a later edited donor/template. */
export function blankMergeReview(letters: Row[]) {
 return letters.flatMap(l => {
  const fields: string[] = JSON.parse(l.merge_blanks ?? '[]')
  return fields.length ? [{ letterId: l.id, donorId: l.donor_id, recipientName: l.recipient_name, fields }] : []
 })
}

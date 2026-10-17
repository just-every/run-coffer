import type { ParsedImport, SourceLocation } from './types'

const at = (l: SourceLocation) => `${l.file} row ${l.row}`

/** Coffer keeps one primary email per donor. Two people in one household who share an
 * address move in as two donors: the first keeps the email, the second gets a note.
 * Any other shared email blocks, naming both rows. */
export function sharedEmails(out: ParsedImport) {
 const owner = new Map<string, (typeof out.donors)[number]>()
 for (const d of out.donors) {
  if (!d.email) continue
  const first = owner.get(d.email)
  if (!first || first.externalId === d.externalId) { owner.set(d.email, d); continue }
  if (first.householdKey && first.householdKey === d.householdKey) {
   out.diagnostics.push({ ...d.location, severity: 'warning', code: 'SHARED_EMAIL_HOUSEHOLD', column: 'email', message: `${d.name} (${d.externalId}) shares ${d.email} with ${first.name} (${first.externalId}, ${at(first.location)}) in ${d.householdName}. Both move in, in that household; the email stays on ${first.name}, and ${d.name} gets a note with it.` })
   out.notes.push({ location: d.location, externalId: `shared-email:${d.externalId}`, donorExternalId: d.externalId, text: `Shares the email address ${d.email} with ${first.name} in the source CRM.`, date: '', type: '' })
   d.email = ''
  } else out.diagnostics.push({ ...d.location, severity: 'error', code: 'SHARED_EMAIL', column: 'email', message: `Constituents ${first.externalId} (${at(first.location)}) and ${d.externalId} have the same email ${d.email} but are not one household. Coffer keeps one email per donor: clear it on one of them, or link them as spouses, and upload again.` })
 }
}

/** Checks the database would refuse at apply, caught here with the rows named. */
export function creditChecks(out: ParsedImport) {
 const gifts = new Map(out.gifts.map(g => [g.externalId, g])), seen = new Map<string, SourceLocation>()
 for (const s of out.softCredits) {
  const gift = gifts.get(s.giftExternalId)
  if (gift && gift.donorExternalId === s.donorExternalId) out.diagnostics.push({ ...s.location, severity: 'error', code: 'SOFT_SELF', message: `Soft credit ${s.externalId} credits gift ${s.giftExternalId} to the constituent who gave it (${s.donorExternalId}). Delete this row or credit another constituent.` })
  const key = `${s.giftExternalId}\u0000${s.donorExternalId}`, first = seen.get(key)
  if (first) out.diagnostics.push({ ...s.location, severity: 'error', code: 'SOFT_DUPLICATE', message: `Soft credit ${s.externalId} credits gift ${s.giftExternalId} to constituent ${s.donorExternalId} a second time (first at ${at(first)}). Coffer credits a person once per gift: delete one of the two rows, or combine their amounts.` })
  else seen.set(key, s.location)
 }
}

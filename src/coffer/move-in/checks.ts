import type { ParsedImport, SourceLocation } from './types'

const at = (l: SourceLocation) => `${l.file} row ${l.row}`

/** Household sharing preserves each person's address and independent consent.
 * Unrelated sharing remains a source error under published DONOR-001. */
export function sharedEmails(out:ParsedImport){
 const owner=new Map<string,ParsedImport['donors'][number]>()
 for(const d of out.donors)for(const email of new Set([d.email,...(d.contacts??[]).filter(p=>p.kind==='email').map(p=>p.value)].filter(Boolean))){
  const first=owner.get(email)
  if(!first||first.externalId===d.externalId){owner.set(email,d);continue}
  if(first.householdKey&&first.householdKey===d.householdKey)out.diagnostics.push({...d.location,severity:'warning',code:'SHARED_EMAIL_HOUSEHOLD',column:'email',message:`${d.name} (${d.externalId}) shares ${email} with ${first.name} (${at(first.location)}) in ${d.householdName}. Both retain the address and remain separate constituents with independent consent.`})
  else out.diagnostics.push({...d.location,severity:'error',code:'SHARED_EMAIL',column:'email',message:`Constituents ${first.externalId} (${at(first.location)}) and ${d.externalId} share ${email} outside a household. Review their identity or remove the conflicting address before importing.`})
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

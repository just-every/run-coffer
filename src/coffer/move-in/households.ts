import type { ParsedDonor, ParsedImport } from './types'
import type { SourceRow } from './source-rows'

const addressKey = (d: ParsedDonor) => d.addressLine1 && (d.postalCode || d.city)
 ? [d.addressLine1, d.addressLine2, d.postalCode || d.city].map(v => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).join('|') : ''
const surname = (d: ParsedDonor) => d.lastName || d.name.trim().split(/\s+/).at(-1) || d.name
const given = (d: ParsedDonor) => d.firstName || d.name.trim().split(/\s+/).slice(0, -1).join(' ') || d.name

/** CRMs such as Little Green Light keep no household of their own. People without an
 * exported household ID become one household when they are linked as spouses or share
 * one mailing address. A surname alone never joins two families. */
export function inferHouseholds(out: ParsedImport) {
 const people = new Map(out.donors.filter(d => !d.householdKey && !d.organization).map(d => [d.externalId, d]))
 const parent = new Map<string, string>()
 const root = (id: string): string => { let r = id; while (parent.has(r)) r = parent.get(r)!; return r }
 const join = (a: string, b: string) => { const x = root(a), y = root(b); if (x !== y) parent.set(x < y ? y : x, x < y ? x : y) }
 for (const r of out.relationships) if (r.type === 'spouse' && people.has(r.donorExternalId) && people.has(r.relatedDonorExternalId)) join(r.donorExternalId, r.relatedDonorExternalId)
 const atAddress = new Map<string, string>()
 for (const d of people.values()) {
  const key = addressKey(d); if (!key) continue
  const first = atAddress.get(key)
  if (first) join(first, d.externalId); else atAddress.set(key, d.externalId)
 }
 const groups = new Map<string, ParsedDonor[]>()
 for (const d of people.values()) { const r = root(d.externalId); groups.set(r, [...(groups.get(r) ?? []), d]) }
 const taken = new Set(out.households.map(h => h.name.toLowerCase()))
 for (const members of groups.values()) {
  if (members.length < 2) continue
  members.sort((a, b) => a.externalId.localeCompare(b.externalId))
  const names = [...new Set(members.map(surname))]
  let name = names.length === 1 ? (members.length === 2 ? `${given(members[0])} and ${given(members[1])} ${names[0]}` : `${names[0]} household`) : members.slice(0, 2).map(d => d.name).join(' and ')
  if (taken.has(name.toLowerCase()) && members[0].addressLine1) name = `${name} · ${members[0].addressLine1}`
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${name.replace(/ \(\d+\)$/, '')} (${n})`
  taken.add(name.toLowerCase())
  const household = { externalId: `members:${members.map(d => d.externalId).join('+')}`, name, location: members[0].location }
  out.households.push(household)
  for (const d of members) { d.householdKey = household.externalId; d.householdName = name }
 }
}

/** Source IDs and explicit flags are evidence; order, address and spouse links are not. */
export function sourceHousehold(r:SourceRow,out:ParsedImport,donor:ParsedDonor) {
 const flag=r.get('householdHead').toLowerCase(), explicitId=r.get('householdHeadId')
 const yes=['yes','true','y','1'].includes(flag), no=!flag||['no','false','n','0'].includes(flag)
 if (!yes&&!no) r.error('HOUSEHOLD_HEAD','Export the head flag as yes or no, or use Head of Household ID.','householdHead')
 if (yes&&explicitId&&explicitId!==donor.externalId) r.error('HOUSEHOLD_HEAD','The source head flag and head constituent ID disagree.','householdHeadId')
 const headExternalId=explicitId||(yes?donor.externalId:undefined)
 const overrides={addressee:r.verbatim('householdAddressee'),formal:r.verbatim('householdFormal'),informal:r.verbatim('householdInformal')}
 if (!donor.householdKey||!donor.householdName) {
  if (headExternalId||Object.values(overrides).some(Boolean)) r.error('HOUSEHOLD_ID','Source household head and greetings require an explicit Household ID and Household Name.','householdKey')
  return
 }
 let household=out.households.find(h=>h.externalId===donor.householdKey)
 if (!household) {household={externalId:donor.householdKey,name:donor.householdName,location:r.location};out.households.push(household)}
 else if (household.name!==donor.householdName) r.error('HOUSEHOLD_CONFLICT',`Household ${household.externalId} has conflicting names. Use the same Household Name on every constituent with this Household ID.`,'householdName')
 for (const [key,value] of Object.entries({headExternalId,...overrides})) {
  if (!value) continue
  const field=key as 'headExternalId'|'addressee'|'formal'|'informal'
  if (household[field]&&household[field]!==value) r.error('HOUSEHOLD_CONFLICT',`Household ${household.externalId} has conflicting ${key}. Export one authoritative source value.`,key)
  else household[field]=value
 }
}

export function validateHouseholdHeads(out:ParsedImport) {
 for (const h of out.households) {
  if (!h.headExternalId) continue
  const donor=out.donors.find(d=>d.externalId===h.headExternalId)
  if (!donor||donor.householdKey!==h.externalId||donor.organization||donor.constituentStatus==='deceased')
   out.diagnostics.push({...h.location,severity:'error',code:'HOUSEHOLD_HEAD',column:'Head of Household',message:`Household ${h.externalId} names a head who is not a living person member in these exports. Correct the source head or include their constituent row.`})
 }
}

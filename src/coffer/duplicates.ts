import { all, fail, id, one, type Row } from './db'

export const MERGE_FIELDS = [
 ['name', 'Name', 'name'], ['email', 'Email', 'email'], ['phone', 'Phone', 'phone'],
 ['addressLine1', 'Address line 1', 'address_line1'], ['addressLine2', 'Address line 2', 'address_line2'],
 ['city', 'City', 'city'], ['region', 'State / region', 'region'], ['postalCode', 'Postal code', 'postal_code'],
 ['organizationType','Organization type','organization_type'], ['website','Website','website'], ['ein','Organization EIN','ein'], ['informalSalutation','Informal salutation','informal_salutation'],
 ['country', 'Country', 'country'], ['householdId', 'Household', 'household_id'],
] as const

const current = `d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`
const normalized = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const nameKey = (value: unknown) => normalized(value).split(' ').sort().join(' ')
const phoneKey = (value: unknown) => { const digits = String(value ?? '').replace(/\D/g, ''); return digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits.length >= 7 ? digits : '' }
const postalKey = (d: Row) => d.address_line1 && (d.postal_code || d.city) ? [d.address_line1,d.address_line2,d.city,d.region,d.postal_code,d.country].map(normalized).join('|') : ''

export async function likelyDuplicates(c: {db:D1Database}, options:{donorId?:string|null;page?:number} = {}) {
 const [donors,aliases] = await Promise.all([
  all(c, `SELECT d.*,h.name AS household FROM cf_donors d LEFT JOIN cf_households h ON h.id=d.household_id WHERE ${current} ORDER BY d.created_at,d.id`),
  all(c,`SELECT DISTINCT COALESCE(m.into_id,a.donor_id) AS donor_id,a.email FROM (
   SELECT id AS donor_id,email FROM cf_donors WHERE email IS NOT NULL UNION SELECT donor_id,email FROM cf_donor_aliases UNION SELECT donor_id,value AS email FROM cf_contact_points WHERE kind='email' AND active=1
  ) a LEFT JOIN cf_donor_merges m ON m.donor_id=a.donor_id`),
 ])
 const points=await all(c,"SELECT * FROM cf_contact_points WHERE active=1")
 const emails = new Map<string,Set<string>>()
 for (const alias of aliases) {
  const addresses = emails.get(alias.donor_id) ?? new Set<string>()
  addresses.add(String(alias.email).trim().toLowerCase()); emails.set(alias.donor_id,addresses)
 }
 const buckets = new Map<string, Row[]>(), pairs = new Map<string, Row>()
 const donorId = options.donorId ? id(options.donorId,'Donor') : null
 // A donor page compares only that person with the index. It need not build
 // every pair in the organization just to display one person's warning.
 const anchor = donorId ? donors.find(d=>d.id===donorId) : undefined
 const ordered = donorId ? [...donors.filter(d=>d.id!==donorId),...(anchor?[anchor]:[])] : donors
 const add = (a: Row, b: Row, code: string, label: string, score: number) => {
  if (a.id === b.id || a.household_id && a.household_id === b.household_id) return
  const key = [a.id,b.id].sort().join('\0'), existing = pairs.get(key)
  if (existing) { if (!existing.reasons.some((r:Row) => r.code === code)) existing.reasons.push({code,label}); existing.score = Math.max(existing.score,score) }
  else pairs.set(key, {source:b,target:a,reasons:[{code,label}],score})
 }
 for (const d of ordered) {
  const name = nameKey(d.name), phone = phoneKey(d.phone), postal = postalKey(d)
  const address = [d.address_line1,d.address_line2,d.city,d.region,d.postal_code,d.country].filter(Boolean).join(', ')
  // Names alone are not enough evidence that two records describe one person.
  const keys: [string,string,string,number][] = [
   ...[...(emails.get(d.id) ?? [])].map(address=>[`email:${address}`,'email',`Same email: ${address}`,100] as [string,string,string,number]),
   ...points.filter(p=>p.donor_id===d.id&&p.kind==='phone').map(p=>[phoneKey(p.value)?'phone:'+phoneKey(p.value):'','phone','Same phone: '+phoneKey(p.value),90] as [string,string,string,number]),
   ...points.filter(p=>p.donor_id===d.id&&p.kind==='address').map(p=>{const a=JSON.parse(p.value);const key=postalKey({address_line1:a.line1,address_line2:a.line2,city:a.city,region:a.region,postal_code:a.postalCode,country:a.country});return [key?'address:'+key:'','address','Same postal address',90] as [string,string,string,number]}),
   [phone ? `phone:${phone}` : '', 'phone', `Same phone: ${phone}`, 90],
   [name && postal ? `postal:${name}:${postal}` : '', 'name_address', `Same name and postal address: ${d.name} · ${address}`, 95],
  ]
  for (const [key,code,label,score] of keys) if (key) {
   const prior = buckets.get(key) ?? []
   if (!donorId || d.id===donorId) for (const other of prior) add(other,d,code,label,score)
   prior.push(d); buckets.set(key,prior)
  }
 }
 const result = [...pairs.values()].filter(p=>!donorId || p.source.id===donorId || p.target.id===donorId)
  .sort((a,b) => b.score - a.score || String(a.target.name).localeCompare(String(b.target.name)) || String(a.source.id).localeCompare(String(b.source.id)))
 const pageSize=50,page=Number.isSafeInteger(options.page) && options.page!>=0 ? options.page! : 0
 return {pairs:result.slice(page*pageSize,(page+1)*pageSize),count:result.length,donorCount:donors.length,page,pageSize,more:(page+1)*pageSize<result.length,donorId}
}

export async function compareDonors(c: {db:D1Database}, sourceId: string, targetId: string) {
 const source = id(sourceId,'Source donor'), target = id(targetId,'Surviving donor')
 if (source === target) fail('INPUT','Choose two different donor records.',400)
 const rows = await all(c,`SELECT d.*,h.name AS household FROM cf_donors d LEFT JOIN cf_households h ON h.id=d.household_id WHERE d.id IN (?,?) AND ${current}`,source,target)
 const from = rows.find(d => d.id === source), into = rows.find(d => d.id === target)
 if (!from || !into) fail('DONOR_CHANGED','Choose two current donors who have not been erased or merged.')
 const history = async (donorId:string) => one(c,`SELECT
  (SELECT count(*) FROM cf_gifts WHERE donor_id=?) AS gifts,
  (SELECT COALESCE(sum(amount_cents),0) FROM cf_monetary_contributions WHERE donor_id=?) AS totalCents,
  (SELECT count(*) FROM cf_pledges WHERE donor_id=?) AS pledges,
  (SELECT count(*) FROM cf_consents WHERE donor_id=?) AS consents,
  (SELECT count(*) FROM cf_interactions WHERE donor_id=?) AS interactions`,donorId,donorId,donorId,donorId,donorId)
 const [sourceHistory,targetHistory] = await Promise.all([history(source),history(target)])
 return {source:from,target:into,fields:MERGE_FIELDS.map(([key,label,column]) => ({key,label,source:from[column] ?? null,target:into[column] ?? null,different:from[column] !== into[column],sourceLabel:key === 'householdId' ? from.household : from[column],targetLabel:key === 'householdId' ? into.household : into[column]})),history:{source:sourceHistory,target:targetHistory}}
}

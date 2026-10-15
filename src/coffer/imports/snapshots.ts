import { Buffer } from 'node:buffer'
import { canonicalJson, sha256, type ImportMapping, type Json, type SourceArtifact, type SourceBundle, type SourceRecord, type TargetEffect } from '../../modules/import-kit/src/d1/index.ts'
import { mappingVersion, namespace } from './context.ts'
import { reject, type Skipped, type SnapshotInput, type SnapshotObject } from './types.ts'

export const kitName = 'Stripe customers and charges'
export const snapshotLimits = { records: 1000, bytes: 4 * 1024 * 1024, recordBytes: 16 * 1024, pages: 40 } as const
export const donorId = (customer: string) => `stripe-${sha256(canonicalJson([namespace, 'customer', customer])).slice(0, 32)}`
export const giftId = (charge: string) => `stripe-${sha256(canonicalJson([namespace, 'charge', charge])).slice(0, 32)}`
/** The suppression entry an erasure leaves for an email or a Stripe donor ID. */
export const erasureHash = (value: string) => sha256(canonicalJson(['coffer-erasure', value.trim().toLowerCase()]))

/** What Coffer already holds, read before planning so the mapping stays pure. */
export type NativeIndex = { donorIds: Set<string>; erased: Set<string>; emails: Map<string, string>; charges: Map<string, number>; timezone: string }
const ERASED = 'Belongs to a donor erased from Coffer; not imported again.'

const object = (value: unknown, label: string): SnapshotObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('IMPORT_SHAPE', `${label} must be a JSON object.`, 400)
  return value as SnapshotObject
}
const str = (value: Json | undefined, label: string, max = 300): string => {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) reject('IMPORT_FIELD', `${label} must be text of at most ${max} characters.`, 400)
  return value.trim()
}
const mail = (value: Json | undefined) => { const v = str(value, 'email', 254).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : '' }
const unix = (value: Json | undefined, label: string) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 946684800 || value > 4102444800) reject('IMPORT_DATE', `${label} must be a Stripe Unix timestamp.`, 400)
  return value
}
const day = (seconds: number, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(seconds * 1000))
  return ['year', 'month', 'day'].map(t => parts.find(p => p.type === t)!.value).join('-')
}

type Page = { kind: 'customer' | 'charge'; root: SnapshotObject; artifact: SourceArtifact; records: SourceRecord[] }
function pages(value: unknown, kind: 'customer' | 'charge', key: string, prefix: RegExp): Page[] {
  if (value === undefined || value === null) return []
  const list = Array.isArray(value) ? value : [value]
  return list.map((raw, page) => {
    const root = object(raw, `${key} page ${page + 1}`)
    // Validate before serialization: undefined and non-JSON values must never
    // disappear from an apparently exact original.
    canonicalJson(root)
    if (root.object !== 'list' || !Array.isArray(root.data)) reject('IMPORT_SHAPE', `Use Stripe's list response, {"object":"list","data":[...]}, for ${key}.`, 400)
    const name = `stripe-${key}-${page + 1}.json`, bytes = Buffer.from(JSON.stringify(root), 'utf8')
    const artifact: SourceArtifact = { name, sha256: sha256(bytes), size: bytes.length, original: { status: 'available', base64: bytes.toString('base64') } }
    const records = (root.data as Json[]).map((row, index): SourceRecord => {
      const payload = object(row, `${key} page ${page + 1} item ${index + 1}`)
      if (Buffer.byteLength(canonicalJson(payload)) > snapshotLimits.recordBytes) reject('IMPORT_LIMIT', 'A Stripe object exceeds the bounded move-in size.', 400)
      if (typeof payload.id !== 'string' || !prefix.test(payload.id)) reject('IMPORT_SOURCE_ID', `Every ${kind} needs its Stripe id.`, 400)
      return { namespace, kind, sourceId: payload.id, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: artifact.sha256, location: { artifact: name, pointer: `/data/${index}`, row: index + 1 } }
    })
    return { kind, root, artifact, records }
  })
}

export function snapshotSource(input: SnapshotInput, native: NativeIndex): { source: SourceBundle; mapping: ImportMapping; skipped: Skipped[] } {
  object(input, 'Import input')
  const all = [...pages(input.customers, 'customer', 'customers', /^cus_[A-Za-z0-9]{1,100}$/), ...pages(input.charges, 'charge', 'charges', /^(ch|py)_[A-Za-z0-9]{1,100}$/)]
  const records = all.flatMap(p => p.records), bytes = all.reduce((n, p) => n + p.artifact.size, 0)
  if (!records.some(r => r.kind === 'charge')) reject('IMPORT_EMPTY', 'Add at least one page of Stripe charges.', 400)
  if (all.length > snapshotLimits.pages || records.length > snapshotLimits.records || bytes > snapshotLimits.bytes)
    reject('IMPORT_LIMIT', `One review holds at most ${snapshotLimits.records} Stripe objects in ${snapshotLimits.pages} pages (${snapshotLimits.bytes / 1024 / 1024} MB). Import a year in several reviews, for example by quarter.`, 400)
  const seen = new Set<string>()
  for (const r of records) { if (seen.has(`${r.kind}:${r.sourceId}`)) reject('IMPORT_DUPLICATE_ID', `Stripe ${r.kind} ${r.sourceId} appears twice.`, 400); seen.add(`${r.kind}:${r.sourceId}`) }

  // Decide every object before planning. Only objects that create a donor or a
  // gift enter the plan; the rest are listed for review and change nothing, so
  // a later review of the same Stripe objects never conflicts with this one.
  const effects = new Map<string, TargetEffect>(), skipped: Skipped[] = []
  const skip = (r: SourceRecord, reason: string) => skipped.push({ kind: r.kind as 'customer' | 'charge', sourceId: r.sourceId, reason })
  // Stripe allows several customers with one email; Coffer keeps one donor per
  // email. The earliest customer wins and later ones point at it.
  const customers = records.filter(r => r.kind === 'customer')
    .sort((a, b) => ((a.payload as SnapshotObject).created as number) - ((b.payload as SnapshotObject).created as number) || a.sourceId.localeCompare(b.sourceId))
  const donorFor = new Map<string, string>(), why = new Map<string, string>(), byEmail = new Map(native.emails)
  for (const r of customers) {
    const c = r.payload as SnapshotObject, email = mail(c.email), target = donorId(r.sourceId), name = str(c.name, 'customer name', 200)
    const reason = c.deleted === true ? 'Deleted in Stripe.'
      : native.erased.has(erasureHash(target)) || (email && native.erased.has(erasureHash(email))) ? ERASED
      : native.donorIds.has(target) ? 'Already in Coffer from an earlier import.'
      : email && byEmail.has(email) ? 'Matches a donor already using this email; gifts attach to that donor.'
      : !name && !email ? 'No name or email to identify the donor.' : ''
    if (native.donorIds.has(target)) donorFor.set(r.sourceId, target)
    else if (reason && email && byEmail.has(email) && c.deleted !== true) donorFor.set(r.sourceId, byEmail.get(email)!)
    if (reason) { why.set(r.sourceId, reason); skip(r, reason); continue }
    donorFor.set(r.sourceId, target)
    if (email) byEmail.set(email, target)
    const a = (c.address && typeof c.address === 'object' && !Array.isArray(c.address) ? c.address : {}) as SnapshotObject
    effects.set(`customer:${r.sourceId}`, { targetKind: 'donor', targetId: target, value: {
      id: target, version: 1, name: name || email, email: email || null, phone: str(c.phone, 'phone', 40) || null,
      addressLine1: str(a.line1, 'address line1', 200) || null, addressLine2: str(a.line2, 'address line2', 200) || null, city: str(a.city, 'city', 100) || null,
      region: str(a.state, 'state', 100) || null, postalCode: str(a.postal_code, 'postal code', 20) || null, country: str(a.country, 'country', 100) || null,
      householdId: null, source: 'stripe', sourceRef: r.sourceId, createdAt: new Date(unix(c.created, 'customer.created') * 1000).toISOString(), erasedAt: null,
    } })
  }
  const noGoods = input.noGoodsOrServices === true
  for (const r of records.filter(r => r.kind === 'charge')) {
    const p = r.payload as SnapshotObject
    if (p.status !== 'succeeded' || p.paid !== true) { skip(r, 'Not a successful payment.'); continue }
    if (p.currency !== 'usd') { skip(r, 'Not in US dollars.'); continue }
    const amount = p.amount, refunded = typeof p.amount_refunded === 'number' ? p.amount_refunded : 0
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(refunded) || refunded < 0) reject('IMPORT_FIELD', `Charge ${r.sourceId} needs integer cent amounts.`, 400)
    const net = amount - refunded, prior = native.charges.get(r.sourceId)
    if (prior !== undefined) { skip(r, prior === net ? 'Already imported.' : `Already imported; Stripe now shows ${(net / 100).toFixed(2)} USD. Record the refund as a reversal in Coffer.`); continue }
    if (net <= 0) { skip(r, 'Fully refunded.'); continue }
    const billing = (p.billing_details && typeof p.billing_details === 'object' ? p.billing_details : {}) as SnapshotObject
    const customer = typeof p.customer === 'string' ? p.customer : '', email = mail(billing.email) || mail(p.receipt_email)
    const donor = (customer && donorFor.get(customer)) || (email && byEmail.get(email)) || ''
    if (!donor && email && native.erased.has(erasureHash(email))) { skip(r, ERASED); continue }
    if (!donor) { skip(r, customer && why.has(customer) ? `Its customer was not imported: ${why.get(customer)}` : 'No matching donor. Include its Stripe customer, or add the donor with this email in Coffer first.'); continue }
    const meta = (p.metadata && typeof p.metadata === 'object' ? p.metadata : {}) as SnapshotObject
    const created = unix(p.created, 'charge.created'), type = (p.payment_method_details as SnapshotObject | null)?.type, id = giftId(r.sourceId)
    effects.set(`charge:${r.sourceId}`, { targetKind: 'gift', targetId: id, value: {
      id, version: 1, donorId: donor, kind: 'gift', reverses: null, receivedOn: day(created, native.timezone), amountCents: net,
      method: type === 'us_bank_account' || type === 'ach_debit' ? 'bank transfer' : 'card', reference: r.sourceId,
      fund: str(meta.fund, 'metadata.fund', 100) || str(meta.campaign, 'metadata.campaign', 100) || 'Unrestricted', pledgeId: null,
      goods: noGoods ? 'none' : 'unknown', goodsCents: 0, goodsDescription: null, note: str(p.description, 'description', 1000) || null,
      source: 'stripe', createdAt: new Date(created * 1000).toISOString(), createdBy: 'Stripe move-in',
    } })
  }
  if (!effects.size) reject('IMPORT_NOTHING_NEW', 'Nothing in these pages adds a donor or gift.', 409, skipped)
  const diagnostics: SourceBundle['diagnostics'] = all.filter(p => p.root.has_more === true)
    .map(p => ({ severity: 'warning' as const, code: 'PARTIAL_SNAPSHOT', message: `${p.artifact.name} says Stripe has more results. Fetch the next page with starting_after if you need them.` }))
  const mapping: ImportMapping = {
    version: mappingVersion,
    map(record) {
      const effect = effects.get(`${record.kind}:${record.sourceId}`)!
      return { effects: [effect], unmapped: record.kind === 'customer' ? [{ reason: 'Stripe metadata and payment settings stay in the retained original.' }] : [] }
    },
  }
  return { source: { records: records.filter(r => effects.has(`${r.kind}:${r.sourceId}`)), artifacts: all.map(p => p.artifact), diagnostics }, mapping, skipped }
}

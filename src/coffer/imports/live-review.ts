import { canonicalJson } from '../../modules/import-kit/src/d1/index.ts'
import type { SnapshotInput } from './types.ts'

const fields = ['customers', 'charges', 'subscriptions', 'paymentIntents', 'invoices'] as const
function unsigned(input: SnapshotInput) {
  return Object.fromEntries([...fields.map(field => [field, (input[field] ?? []).map((page: any) => {
    const { cofferLiveReview, ...original } = page
    return original
  })]), ['noGoodsOrServices', input.noGoodsOrServices === true]])
}
async function signature(input: SnapshotInput, secret: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(canonicalJson(unsigned(input))))), n => n.toString(16).padStart(2, '0')).join('')
}

/** Bind live provenance to every reviewed page and the donation answer. */
export async function signLiveStripeInput(input: SnapshotInput, secret: string): Promise<SnapshotInput> {
  const token = await signature(input, secret)
  return { ...input, ...Object.fromEntries(fields.map(field => [field, (input[field] ?? []).map(page => ({ ...page, cofferLiveReview: token }))])) }
}

/** Only the HTTP handler holding the installation secret grants the live skip policy. */
export async function isLiveStripeInput(input: SnapshotInput, secret: string): Promise<boolean> {
  if (!input || typeof input !== 'object' || fields.some(field => input[field] !== undefined && input[field] !== null && !Array.isArray(input[field]))) return false
  const pages = fields.flatMap(field => Array.isArray(input[field]) ? input[field]! : []) as Record<string, unknown>[]
  const token = pages[0]?.cofferLiveReview
  if (!secret || !pages.length || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || pages.some(page => !page || page.cofferLiveReview !== token)) return false
  const expected = await signature(input, secret)
  let difference = 0
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ token.charCodeAt(i)
  return difference === 0
}

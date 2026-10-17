import type { Bindings } from '../../auth.server'
import { isLoopbackHost } from '../../modules/operator-auth/index.mjs'
import { CofferError } from '../db'

export interface GivingEnv extends Bindings {
 STRIPE_SECRET_KEY?: string
 STRIPE_WEBHOOK_SECRET?: string
}

// Stable Endive release; Checkout uses allowed_payment_method_types in this version.
// https://docs.stripe.com/changelog/endive/2026-09-30/remove-payment-method-types-checkout-sessions
export const STRIPE_API_VERSION = '2026-09-30.endive'

/** Match the platform's managed-installation convention, including invalid origins. */
export function managed(env: GivingEnv): boolean {
 if (!env.RER_INSTALLATION_ID || !env.RER_MANAGEMENT_ORIGIN) return false
 try { return !isLoopbackHost(new URL(env.RER_MANAGEMENT_ORIGIN).hostname) } catch { return true }
}

export function available(env: GivingEnv): boolean {
 return !managed(env) && Boolean(env.STRIPE_SECRET_KEY?.trim())
}

/** Returns the configured secret key for either a live account or a Stripe sandbox. */
export function requireStripe(env: GivingEnv): string {
 if (managed(env)) throw new CofferError('not_available', 'Stripe is not available yet on RER Managed.', 503)
 const key = env.STRIPE_SECRET_KEY?.trim()
 if (!key) throw new CofferError('not_available', 'Online giving is not connected yet. An owner or admin connects Stripe in Coffer under Giving → Connect Stripe.', 503)
 return key
}

export type StripeParams = URLSearchParams | Record<string, string | number | boolean>

/** Keys in a record use Stripe's bracket notation; omit params for a GET request. */
export async function stripe<T = Record<string, any>>(env: GivingEnv, path: string, params?: StripeParams, idempotencyKey?: string): Promise<T> {
 const key = requireStripe(env)
 const url = new URL(path.startsWith('/v1/') ? path : `/v1/${path.replace(/^\/+/, '')}`, 'https://api.stripe.com')
 const headers = new Headers({ Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_API_VERSION })
 const body = params === undefined ? undefined : params instanceof URLSearchParams ? params : new URLSearchParams(Object.entries(params).map(([name, value]) => [name, String(value)]))
 if (body !== undefined) headers.set('Content-Type', 'application/x-www-form-urlencoded')
 if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey)
 let response: Response
 try {
  response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
 } catch {
  throw new CofferError('stripe_unavailable', 'Stripe could not be reached. Try again.', 502)
 }
 let result: unknown
 try { result = await response.json() } catch {
  throw new CofferError('stripe_error', 'Stripe returned an unreadable response.', 502)
 }
 if (!response.ok) {
  // Do not expose Stripe's raw error text: it can include submitted donor data.
  throw new CofferError('stripe_error', 'Stripe could not complete that request.', 502, { requestId: response.headers.get('request-id'), status: response.status })
 }
 return result as T
}

/** Verify the untouched request body before parsing its JSON. Accept any valid v1
 * signature during endpoint-secret rotation, with a five-minute clock tolerance. */
export async function verifyStripeSignature(raw: string, header: string | null, secret: string): Promise<boolean> {
 if (!header || !secret) return false
 const fields = header.split(',').map(part => part.trim().split('='))
 const timestamps = fields.filter(([name]) => name === 't')
 if (timestamps.length !== 1 || timestamps[0].length !== 2 || !/^\d+$/.test(timestamps[0][1])) return false
 const timestamp = timestamps[0][1], seconds = Number(timestamp)
 if (!Number.isSafeInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false
 const signatures = fields.filter(([name, value, extra]) => name === 'v1' && extra === undefined && /^[a-fA-F0-9]{64}$/.test(value ?? ''))
 if (!signatures.length) return false
 const encoder = new TextEncoder()
 const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
 const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${raw}`)))
 let matched = 0
 for (const [, signature] of signatures) {
  // Fixed-size XOR comparison never exits early on the first differing byte.
  let difference = 0
  for (let index = 0; index < digest.length; index++) difference |= digest[index] ^ Number.parseInt(signature.slice(index * 2, index * 2 + 2), 16)
  matched |= Number(difference === 0)
 }
 return matched !== 0
}

import { fail } from '../db'
import type { Bindings } from '../../auth.server'

export function webhookEndpoint(value: unknown): string {
 let url: URL
 try { url = new URL(String(value)) } catch { return fail('WEBHOOK_ENDPOINT', 'Enter a public HTTPS endpoint.', 400) }
 const host = url.hostname.toLowerCase()
 if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /(^|\.)(localhost|local|internal|home|lan)$/.test(host) || host.endsWith('.localhost') || url.href.length > 2000)
  fail('WEBHOOK_ENDPOINT', 'Use public HTTPS on port 443, without credentials, query parameters or a fragment.', 400)
 return url.href
}
const bytes = (value: string) => new TextEncoder().encode(value)
async function key(env: Bindings) {
 if (!env.SESSION_SECRET) fail('WEBHOOK_SECRET', 'Signing-key storage is unavailable.')
 return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', bytes('coffer:webhooks:v1:' + env.SESSION_SECRET)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function sealWebhookKey(env: Bindings, secret: string) {
 const iv = crypto.getRandomValues(new Uint8Array(12))
 const data = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv}, await key(env), bytes(secret)))
 return JSON.stringify({iv:[...iv],data:[...data]})
}
export async function openWebhookKey(env: Bindings, sealed: string) {
 const value = JSON.parse(sealed)
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(value.iv)},await key(env),new Uint8Array(value.data)))
}
export async function webhookSignature(secret: string, timestamp: string, body: string) {
 const signing = await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const digest = new Uint8Array(await crypto.subtle.sign('HMAC',signing,bytes(timestamp+'.'+body)))
 return `t=${timestamp},v1=${[...digest].map(n=>n.toString(16).padStart(2,'0')).join('')}`
}

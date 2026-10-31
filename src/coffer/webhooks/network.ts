import { webhookEndpoint } from './security'

export type WebhookNetworkFailure = 'dns_nonpublic' | 'dns_alias_unsafe' | 'dns_incomplete' | 'dns_malformed' | 'dns_unavailable'
class Refusal extends Error {
 constructor(readonly code: WebhookNetworkFailure) { super(code) }
}
const refuse = (code: WebhookNetworkFailure): never => { throw new Refusal(code) }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const uint32 = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffffffff

function dnsName(value: unknown): string {
 if (typeof value !== 'string') return refuse('dns_malformed')
 if (value === '.') return value
 const name = value.toLowerCase().replace(/\.$/, '')
 if (name.length > 253 || !name.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return refuse('dns_malformed')
 return name
}
function hostname(value: unknown): string {
 const name = dnsName(value)
 if (!name.includes('.')) return refuse('dns_alias_unsafe')
 try { if (new URL(webhookEndpoint('https://' + name + '/')).hostname !== name) return refuse('dns_alias_unsafe') }
 catch { return refuse('dns_alias_unsafe') }
 return name
}

function publicAddress(value: string, family: number): boolean {
 if (family === 1) {
  if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) return refuse('dns_malformed')
  const octets = value.split('.').map(Number)
  if (octets.some(n => n > 255)) return refuse('dns_malformed')
  const [a,b,c] = octets
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 ||
   a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
   a === 192 && (b === 0 && (c === 0 || c === 2) || b === 88 && c === 99 || b === 168) ||
   a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113)
 }
 if (!/^[0-9a-f:]+$/i.test(value) || value.split('::').length > 2) return refuse('dns_malformed')
 const sides = value.toLowerCase().split('::'),parts = sides.map(side => side ? side.split(':') : [])
 const count = parts.reduce((n,side) => n + side.length,0)
 if (parts.flat().some(part => !/^[0-9a-f]{1,4}$/.test(part)) || (sides.length === 1 ? count !== 8 : count >= 8)) return refuse('dns_malformed')
 const words = [...parts[0],...Array(sides.length === 2 ? 8-count : 0).fill('0'),...(parts[1] ?? [])].map(part => parseInt(part,16))
 // Only global unicast, excluding special-purpose, transition and documentation ranges.
 return words[0] >= 0x2000 && words[0] <= 0x3fff &&
  !(words[0] === 0x2001 && (words[1] < 0x200 || words[1] === 0xdb8) || words[0] === 0x2002 || words[0] === 0x3fff && words[1] < 0x1000)
}

type Answer = { name: string; type: number; data: string }
function answers(value: unknown): Answer[] {
 if (value === undefined) return []
 if (!Array.isArray(value) || value.length > 128) return refuse('dns_malformed')
 return value.map(item => {
  if (!record(item) || !Number.isInteger(item.type) || !uint32(item.TTL) || typeof item.data !== 'string') return refuse('dns_malformed')
  return {name:hostname(item.name),type:Number(item.type),data:item.data}
 })
}

function inspect(value: unknown, name: string, family: number) {
 if (!record(value) || !Number.isInteger(value.Status) || Number(value.Status) < 0 || Number(value.Status) > 15 || typeof value.TC !== 'boolean') return refuse('dns_malformed')
 if (value.Status !== 0) return refuse('dns_unavailable')
 if (value.TC) return refuse('dns_incomplete')
 if (!Array.isArray(value.Question) || value.Question.length !== 1 || !record(value.Question[0]) ||
  hostname(value.Question[0].name) !== name || value.Question[0].type !== family) return refuse('dns_malformed')
 const rows = answers(value.Answer),aliases = new Map<string,string>()
 for (const row of rows) {
  if (row.type === 5) {
   const target = hostname(row.data)
   if (aliases.has(row.name) && aliases.get(row.name) !== target) return refuse('dns_alias_unsafe')
   aliases.set(row.name,target)
  } else if (row.type === 1 || row.type === 28) {
   if (!publicAddress(row.data,row.type)) return refuse('dns_nonpublic')
   if (row.type !== family) return refuse('dns_malformed')
  } else return refuse('dns_malformed')
 }
 const chain = [name]
 while (aliases.has(chain.at(-1)!)) {
  const next = aliases.get(chain.at(-1)!)!
  if (chain.includes(next) || chain.length > 8) return refuse('dns_alias_unsafe')
  chain.push(next)
 }
 const terminal = chain.at(-1)!
 if (rows.some(row => row.type === 5 ? !chain.slice(0,-1).includes(row.name) : row.name !== terminal)) return refuse('dns_malformed')
 const addresses = rows.filter(row => row.type === family)
 if (!addresses.length) {
  // A missing family needs a complete negative answer, not an empty or partial reply.
  const authority = answers(value.Authority)
  const negative = authority.some(row => {
   if (row.type !== 6 || !(terminal === row.name || terminal.endsWith('.'+row.name))) return false
   const fields = row.data.split(/\s+/)
   if (fields.length !== 7 || !fields.slice(2).every(field => /^\d+$/.test(field) && uint32(Number(field)))) return refuse('dns_malformed')
   // SOA mailbox and primary-server names are DNS names, not arbitrary text.
   fields.slice(0,2).forEach(dnsName)
   return true
  })
  if (!negative) return refuse('dns_incomplete')
 }
 return {chain,hasAddress:addresses.length > 0}
}

async function resolve(name: string, family: number, signal: AbortSignal) {
 // Cloudflare's documented DNS JSON edge: no endpoint path, event or signing bytes.
 // https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/
 const url = new URL('https://cloudflare-dns.com/dns-query')
 url.searchParams.set('name',name);url.searchParams.set('type',family === 1 ? 'A' : 'AAAA')
 let response: Response
 try { response = await fetch(url,{headers:{accept:'application/dns-json'},redirect:'manual',signal}) }
 catch { return refuse('dns_unavailable') }
 try {
  if (!response.ok) return refuse('dns_unavailable')
  if (!/^application\/(?:dns-)?json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) return refuse('dns_malformed')
  const reader = response.body?.getReader()
  if (!reader) return refuse('dns_incomplete')
  const chunks: Uint8Array[] = [];let length = 0
  try {
   for (;;) {
    const {done,value} = await reader.read()
    if (done) break
    length += value.length
    if (length > 65536) return refuse('dns_malformed')
    chunks.push(value)
   }
  } finally { await reader.cancel() }
  const bytes = new Uint8Array(length);let offset = 0
  for (const chunk of chunks) { bytes.set(chunk,offset);offset += chunk.length }
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) }
  catch { return refuse('dns_malformed') }
  return inspect(value,name,family)
 } finally { await response.body?.cancel().catch(() => {}) }
}

/** Preflight is fail-closed but cannot pin the address used by Worker fetch. */
export async function webhookNetworkFailure(endpoint: string): Promise<WebhookNetworkFailure | null> {
 try {
  const name = hostname(new URL(webhookEndpoint(endpoint)).hostname),signal = AbortSignal.timeout(5000)
  const results = await Promise.allSettled([resolve(name,1,signal),resolve(name,28,signal)])
  // Select a deterministic stable outcome even when both resolver requests fail.
  const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason instanceof Refusal ? result.reason.code : 'dns_unavailable'] : [])
  for (const code of ['dns_nonpublic','dns_alias_unsafe','dns_malformed','dns_incomplete','dns_unavailable'] as const) if (failures.includes(code)) return code
  const [v4,v6] = results.map(result => { if (result.status === 'rejected') throw result.reason;return result.value })
  if (JSON.stringify(v4.chain) !== JSON.stringify(v6.chain)) return 'dns_alias_unsafe'
  if (!v4.hasAddress && !v6.hasAddress) return 'dns_incomplete'
  return null
 } catch (error) { return error instanceof Refusal ? error.code : 'dns_unavailable' }
}

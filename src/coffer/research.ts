import { manager } from './auth'
import { all, commit, event, fail, guard, id, newId, one, sql, text, type Context, type Row, type Stmt } from './db'

// Official current contract: https://apidocs.wealthengine.com/docs/api-service-openapi.yaml
// Summary lookup supplies giving indicators without creating a saved provider screening list.
const API = 'https://api.wealthengine.com/v1'
const ENDPOINT = '/profile/summary/basic'
function access(c: Context) {
 if (!manager(c.actor)) fail('manager_required', 'Only the owner or an admin accesses prospect research.', 403)
}
async function sealingKey(c: Context) {
 const secret = c.env?.SESSION_SECRET
 if (!secret || secret.length < 32) fail('research_secret_unavailable', 'Configure the installation session secret before connecting prospect research.', 503)
 return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode('coffer:research:key:v1:' + secret)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function seal(c: Context, key: string) {
 const iv = crypto.getRandomValues(new Uint8Array(12))
 const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealingKey(c), new TextEncoder().encode(key)))
 return JSON.stringify({ iv: Array.from(iv), data: Array.from(data) })
}
async function credential(c: Context) {
 const saved = await one(c, 'SELECT encrypted_key,version FROM cf_research_connection WHERE id=1')
 if (!saved) fail('research_not_connected', 'Connect WealthEngine before screening donors.', 409)
 try {
  const value = JSON.parse(saved.encrypted_key)
  const key = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv) }, await sealingKey(c), new Uint8Array(value.data)))
  return { key, version: saved.version, encryptedKey: saved.encrypted_key }
 } catch { return fail('research_key_unreadable', 'The saved WealthEngine key cannot be opened. Connect again with a new key.', 503) }
}
async function request(key: string, path: string, body: Row): Promise<Row | null> {
 let response: Response
 try {
  response = await fetch(API + path, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15_000),
   headers: { authorization: `APIkey ${key}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
 } catch { return fail('research_unreachable', 'WealthEngine could not be reached. No research results were saved.', 502) }
 if (response.status === 555 && path === ENDPOINT) return null
 if ([401, 403].includes(response.status)) fail('research_key_rejected', 'WealthEngine refused the key or its API permissions. Check the account and connect again.', 409)
 if (response.status === 402) fail('research_quota', 'The WealthEngine account has no remaining API quota. No research results were saved.', 409)
 if (!response.ok) fail('research_provider_error', 'WealthEngine could not complete the request. No research results were saved.', 502)
 const value: unknown = await response.json().catch(() => null)
 if (!value || typeof value !== 'object' || Array.isArray(value)) fail('research_response', 'WealthEngine returned an unreadable result. No research results were saved.', 502)
 return value as Row
}
function label(value: unknown): string | null {
 if (value === undefined || value === null) return null
 if (typeof value !== 'string' || value.length > 240 || /[\u0000-\u001f]/.test(value)) fail('research_response', 'WealthEngine returned an invalid research field. No research results were saved.', 502)
 return value
}
function result(donorId: string, value: Row | null) {
 if (!value) return { donorId, status: 'no_match', profileId: null, rating: null, score: null, range: null, low: null, high: null, propensity: null, propensityCode: null, annual: null }
 if (!Number.isSafeInteger(value.id) || !Array.isArray(value.locations) || (value.client_id !== undefined && value.client_id !== donorId)) fail('research_response', 'WealthEngine returned a result that could not be matched to this request. No research results were saved.', 502)
 const score = value.wealth?.wealth_score?.value
 if (score !== undefined && score !== null && (!Number.isInteger(score) || score < 0 || score > 100)) fail('research_response', 'WealthEngine returned an invalid rating. No research results were saved.', 502)
 return { donorId, status: 'matched', profileId: String(value.id), rating: label(value.wealth?.wealth_score?.text), score: score ?? null,
  range: label(value.giving?.gift_capacity?.text), low: label(value.giving?.gift_capacity?.text_low), high: label(value.giving?.gift_capacity?.text_high),
  propensity: label(value.giving?.p2g_score?.text), propensityCode: label(value.giving?.p2g_score?.value), annual: label(value.giving?.estimated_annual_donations?.text) }
}
function query(donor: Row) {
 const names = String(donor.name).trim().split(/\s+/)
 if (names.length < 2 || !donor.address_line1 || !donor.city || !/^[A-Za-z]{2}$/.test(donor.region ?? '') || !/^\d{5}(?:-\d{4})?$/.test(donor.postal_code ?? '') || !['US', 'USA', 'United States', 'United States of America'].includes(donor.country))
  fail('research_address_required', 'Each selected donor needs a first and last name and a complete United States address with a two-letter state and ZIP code.', 400)
 return { client_id: donor.id, first_name: names[0], last_name: names.slice(1).join(' '), address_line1: donor.address_line1,
  ...(donor.address_line2 ? { address_line2: donor.address_line2 } : {}), city: donor.city, state: donor.region.toUpperCase(), zip: donor.postal_code.slice(0, 5) }
}

export async function researchState(c: Context, donorId?: string) {
 access(c)
 if (donorId) donorId = id(donorId, 'Donor')
 await commit(c, [])
 const [connection, donors, results] = await Promise.all([
  one(c, 'SELECT provider,connected_at AS connectedAt FROM cf_research_connection WHERE id=1'),
  all(c, `SELECT id,name FROM cf_donors d WHERE erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id) ORDER BY lower(name),id`),
  all(c, `SELECT r.*,d.name AS donor_name FROM cf_research_results r JOIN cf_donors d ON d.id=r.donor_id WHERE d.erased_at IS NULL AND (? IS NULL OR r.donor_id=?) ORDER BY r.researched_at DESC,lower(d.name)`, donorId ?? null, donorId ?? null),
 ])
 return { connection, donors, results }
}

export async function researchCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['research.connect', 'research.screen', 'research.disconnect'].includes(command)) return undefined
 access(c)
 if (command === 'research.connect') {
  if (p.provider !== 'wealthengine') fail('INPUT', 'Choose WealthEngine.', 400)
  const key = text(p.apiKey, 'WealthEngine API key', 1000)
  if (/\s/.test(key)) fail('INPUT', 'Paste the API key without spaces.', 400)
  await commit(c, [])
  const session = await request(key, '/session/create', { duration: 60 })
  if (typeof session?._id !== 'string' || !session._id) fail('research_response', 'WealthEngine did not confirm the API key. The connection was not saved.', 502)
  const encrypted = await seal(c, key)
  await commit(c, [sql(`INSERT INTO cf_research_connection(id,provider,encrypted_key,version,connected_at) VALUES(1,'wealthengine',?,1,?)
   ON CONFLICT(id) DO UPDATE SET encrypted_key=excluded.encrypted_key,version=version+1,connected_at=excluded.connected_at`, encrypted, c.now),
   event(c, 'research.connect', 'settings', 'research', null, { provider: 'wealthengine' })])
  return { connected: true, provider: 'wealthengine' }
 }
 if (command === 'research.disconnect') {
  await commit(c, [sql('DELETE FROM cf_research_connection WHERE id=1'), event(c, 'research.disconnect', 'settings', 'research', null)])
  return { connected: false }
 }
 const selection = Array.isArray(p.donorIds) ? p.donorIds : typeof p.donorIds === 'string' ? [p.donorIds] : []
 if (!selection.length || selection.length > 25) fail('INPUT', 'Select 1–25 donors to screen.', 400)
 const donorIds = [...new Set(selection.map((value: unknown) => id(value, 'Donor')))]
 const donors = await all(c, `SELECT id,version,name,address_line1,address_line2,city,region,postal_code,country FROM cf_donors d
  WHERE erased_at IS NULL AND id IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`, JSON.stringify(donorIds))
 if (donors.length !== donorIds.length) fail('NOT_FOUND', 'A selected donor was erased or merged. Refresh the donor list.', 404)
 const queries = donors.map(query), auth = await credential(c)
 const checks: Stmt[] = [guard('EXISTS(SELECT 1 FROM cf_research_connection WHERE id=1 AND version=? AND encrypted_key=?)', 'VERSION', 'The research connection changed. Screen again with the current connection.', auth.version, auth.encryptedKey),
  ...donors.map(d => guard('EXISTS(SELECT 1 FROM cf_donors d WHERE id=? AND version=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))', 'VERSION', 'A selected donor changed. Refresh before screening again.', d.id, d.version))]
 await commit(c, checks)
 // Three concurrent lookups bound provider pressure and Worker request duration.
 const results: ReturnType<typeof result>[] = []
 for (let start = 0; start < queries.length; start += 3) {
  results.push(...await Promise.all(queries.slice(start, start + 3).map(async input => result(input.client_id, await request(auth.key, ENDPOINT, input)))))
 }
 await commit(c, [...checks, ...results.flatMap(r => [
  sql('DELETE FROM cf_research_results WHERE donor_id=?',r.donorId),
  sql(`INSERT INTO cf_research_results(id,donor_id,provider,provider_profile_id,researched_at,status,wealth_rating,wealth_score,capacity_range,capacity_low,capacity_high,propensity,propensity_code,annual_donations)
   VALUES(?,?,'wealthengine',?,?,?,?,?,?,?,?,?,?,?)`,
   newId(),r.donorId,r.profileId,c.now,r.status,r.rating,r.score,r.range,r.low,r.high,r.propensity,r.propensityCode,r.annual),
  event(c, 'research.screen', 'donor', r.donorId, r.donorId, { provider: 'wealthengine', status: r.status }),
 ])])
 return { screened: results.length, matched: results.filter(r => r.status === 'matched').length }
}

import { all, commit, event, fail, guard, one, sha256, sql, text, type Context, type Row } from '../../db'
import { openGiving, sealGiving } from '../../giving/connections'
import { managed } from '../../giving/stripe'
import type { PaymentsEnv } from '../pantry'
import { qboCatalog, tokenRequest, type QboConnection } from './client'

export function qboOwner(c: Context, env: PaymentsEnv) {
 if (c.actor.role !== 'owner') fail('QBO_OWNER', 'Only the owner connects QuickBooks or posts its accounting entries.', 403)
 if (managed(env)) fail('not_available', 'QuickBooks is not available yet on RER Managed.', 503)
}
export const callbackUrl = (env: PaymentsEnv) => env.AUTH_ORIGIN + '/app/settings/quickbooks/callback'
const credential = (env: PaymentsEnv) => {
 if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET) fail('QBO_CONFIG', 'Configure the QuickBooks application client ID and secret first.', 503)
}
export async function beginConnection(c: Context, env: PaymentsEnv) {
 credential(env)
 const state = crypto.randomUUID() + crypto.randomUUID()
 await commit(c, [sql('DELETE FROM cf_qbo_oauth WHERE expires_at<=?', c.now), sql('INSERT INTO cf_qbo_oauth VALUES(?,?,?)', await sha256(state), c.actor.id, new Date(Date.parse(c.now) + 600_000).toISOString()), event(c, 'quickbooks.authorize', 'settings', 'quickbooks', null)])
 const url = new URL('https://appcenter.intuit.com/connect/oauth2')
 url.search = new URLSearchParams({ client_id: env.QBO_CLIENT_ID!, redirect_uri: callbackUrl(env), response_type: 'code', scope: 'com.intuit.quickbooks.accounting', state }).toString()
 return { url: url.href }
}
export async function finishConnection(c: Context, env: PaymentsEnv, params: URLSearchParams) {
 credential(env)
 const hash = await sha256(text(params.get('state'), 'Authorization state', 200))
 const pending = await one(c, 'SELECT * FROM cf_qbo_oauth WHERE state_hash=? AND actor_id=? AND expires_at>?', hash, c.actor.id, c.now)
 if (!pending) fail('QBO_STATE', 'This QuickBooks authorization expired or belongs to another session. Connect again.', 409)
 const realm = text(params.get('realmId'), 'QuickBooks company ID', 100)
 if (!/^\d+$/.test(realm)) fail('QBO_REALM', 'QuickBooks returned an invalid company ID.', 400)
 // A restored financial claim cannot silently be redirected to another company.
 const sandbox = env.QBO_SANDBOX === 'true' ? 1 : 0
 if (await one(c, 'SELECT 1 FROM cf_qbo_postings WHERE realm_id<>? OR sandbox<>? LIMIT 1', realm, sandbox)) fail('QBO_COMPANY', 'Reconnect the QuickBooks company that owns the saved accounting entries.', 409)
 await commit(c, [guard('EXISTS(SELECT 1 FROM cf_qbo_oauth WHERE state_hash=? AND actor_id=? AND expires_at>?)', 'QBO_STATE', 'This authorization has already been used.', hash, c.actor.id, c.now), sql('DELETE FROM cf_qbo_oauth WHERE state_hash=?', hash)])
 const tokens = await tokenRequest(env, new URLSearchParams({ grant_type: 'authorization_code', code: text(params.get('code'), 'Authorization code', 4000), redirect_uri: callbackUrl(env) }))
 const sealed = await sealGiving(env, { access: tokens.access_token, refresh: tokens.refresh_token })
 await commit(c, [sql(`INSERT INTO cf_qbo_connection VALUES(1,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET realm_id=excluded.realm_id,sandbox=excluded.sandbox,sealed=excluded.sealed,expires_at=excluded.expires_at,version=version+1,connected_at=excluded.connected_at`, realm, sandbox, sealed, new Date(Date.parse(c.now) + tokens.expires_in * 1000).toISOString(), c.now), event(c, 'quickbooks.connected', 'settings', 'quickbooks', null, { realm, sandbox: Boolean(sandbox) })])
 return { connected: true, realm, sandbox: Boolean(sandbox) }
}
export async function qboConnection(c: Context, env: PaymentsEnv): Promise<QboConnection> {
 const row = await one(c, 'SELECT * FROM cf_qbo_connection WHERE id=1')
 if (!row) fail('QBO_CONNECTION', 'Connect QuickBooks in Settings first.', 409)
 let tokens = await openGiving(env, row.sealed)
 if (Date.parse(row.expires_at) <= Date.parse(c.now) + 60_000) {
  const fresh = await tokenRequest(env, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh }))
  tokens = { access: fresh.access_token, refresh: fresh.refresh_token }
  await commit(c, [guard('EXISTS(SELECT 1 FROM cf_qbo_connection WHERE id=1 AND version=?)', 'QBO_CONNECTION_CHANGED', 'The QuickBooks connection changed. Retry with the current connection.', row.version), sql('UPDATE cf_qbo_connection SET sealed=?,expires_at=?,version=version+1 WHERE id=1', await sealGiving(env, tokens), new Date(Date.parse(c.now) + fresh.expires_in * 1000).toISOString())])
 }
 return { realm: row.realm_id, sandbox: Boolean(row.sandbox), token: tokens.access }
}
export async function qboSettings(c: Context) {
 return { connection: await one(c, 'SELECT realm_id,sandbox,connected_at FROM cf_qbo_connection WHERE id=1'), mapping: await one(c, 'SELECT * FROM cf_qbo_mapping WHERE id=1'), funds: await all(c, `SELECT name FROM cf_funds UNION SELECT fund AS name FROM cf_fund_ledger ORDER BY name`) }
}
export async function saveMapping(c: Context, env: PaymentsEnv, input: Row) {
 const conn = await qboConnection(c, env), catalog = await qboCatalog(conn)
 let funds = input.funds
 if (typeof funds === 'string') { try { funds = JSON.parse(funds) } catch { fail('QBO_MAPPING', 'Choose valid fund account mappings.', 400) } }
 if (!funds || typeof funds !== 'object' || Array.isArray(funds) || !Object.keys(funds).length) fail('QBO_MAPPING', 'Map every fund to its income account and class or location.', 400)
 const account = (value: unknown, type: string) => {
  const id = text(value, type + ' account', 100)
  if (!catalog.accounts.some(a => a.Id === id && a.Active === true && a.AccountType === type && (a.CurrencyRef?.value === 'USD' || !catalog.multiCurrency && !a.CurrencyRef))) fail('QBO_MAPPING', `Choose an active USD ${type} account from QuickBooks.`, 409)
  return id
 }
 const selected: Row = Object.create(null)
 for (const [fund, value] of Object.entries(funds)) {
  const v = value as Row
  if (!v || typeof v !== 'object') fail('QBO_MAPPING', 'Choose an account and dimension for every fund.', 400)
  const classId = v.classId ? text(v.classId, 'Class', 100) : null, locationId = v.locationId ? text(v.locationId, 'Location', 100) : null
  if ((!classId && !locationId) || (classId && !catalog.classes.some(d => d.Id === classId && d.Active === true)) || (locationId && !catalog.locations.some(d => d.Id === locationId && d.Active === true))) fail('QBO_MAPPING', 'Choose an active QuickBooks class or location for every fund.', 409)
  selected[text(fund, 'Fund', 200)] = { accountId: account(v.accountId, 'Income'), classId, locationId }
 }
 const currentFunds = (await qboSettings(c)).funds
 if (currentFunds.some(f => !Object.hasOwn(selected, f.name))) fail('QBO_MAPPING', 'Map every current fund before saving.', 409)
 const mapping = { funds: selected, bank: account(input.bank, 'Bank'), stripe: account(input.stripe, 'Bank'), fees: account(input.fees, 'Expense') }
 if (mapping.bank === mapping.stripe) fail('QBO_MAPPING', 'Choose separate checking and Stripe clearing accounts.', 409)
 const old = await one(c, 'SELECT version FROM cf_qbo_mapping WHERE id=1'), version = Number(input.version ?? 0)
 if (version !== (old?.version ?? 0)) fail('VERSION', 'The account mapping changed. Refresh before saving.', 409)
 await commit(c, [guard('COALESCE((SELECT version FROM cf_qbo_mapping WHERE id=1),0)=?', 'VERSION', 'The account mapping changed.', version), sql(`INSERT INTO cf_qbo_mapping VALUES(1,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET realm_id=excluded.realm_id,sandbox=excluded.sandbox,version=version+1,mapping=excluded.mapping,updated_at=excluded.updated_at`, conn.realm, conn.sandbox ? 1 : 0, JSON.stringify(mapping), c.now), event(c, 'quickbooks.mapping', 'settings', 'quickbooks', null, { funds: Object.keys(selected), version: version + 1 })])
 return { version: version + 1, ...mapping }
}

import { fail, type Row } from '../../db'
import type { PaymentsEnv } from '../pantry'

export type QboConnection = { realm: string; sandbox: boolean; clientId: string; token: string; sealed: string }
export class QboFailure extends Error {
 constructor(public definitive: boolean, message: string, public status?: number, public code?: string) { super(message) }
}
export async function tokenRequest(env: PaymentsEnv, body: URLSearchParams) {
 if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET) fail('QBO_CONFIG', 'Configure the QuickBooks application client ID and secret first.', 503)
 let response: Response
 try {
  response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
   method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
   headers: { authorization: 'Basic ' + btoa(env.QBO_CLIENT_ID + ':' + env.QBO_CLIENT_SECRET), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body,
  })
 } catch { fail('QBO_OAUTH', 'QuickBooks could not complete authorization. Connect again.', 502) }
 const data = await response.json().catch(() => null) as Row | null
 if (!response.ok || !data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || !Number.isSafeInteger(data.expires_in) || data.expires_in < 1) fail('QBO_OAUTH', 'QuickBooks authorization expired or was refused. Connect again.', 502)
 return data
}

/** No user-supplied origin: tokens go only to Intuit, without redirects. */
export async function qboRequest(conn: QboConnection, path: string, body?: Row): Promise<Row> {
 let response: Response
 try {
  response = await fetch(`https://${conn.sandbox ? 'sandbox-' : ''}quickbooks.api.intuit.com/v3/company/${encodeURIComponent(conn.realm)}/${path}`, {
   method: body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000),
   headers: { authorization: 'Bearer ' + conn.token, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
   ...(body ? { body: JSON.stringify(body) } : {}),
  })
 } catch { throw new QboFailure(false, 'QuickBooks did not confirm the result. Retry the saved request to recover it.') }
 const data = await response.json().catch(() => null) as Row | null
 if (!response.ok || data?.Fault) {
  // Only a structured provider refusal proves that no money was created.
  const definitive = response.status >= 400 && response.status < 500 && Boolean(data?.Fault)
  const code = String(data?.Fault?.Error?.[0]?.code ?? response.status).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
  throw new QboFailure(definitive, `QuickBooks refused the request (code ${code}). Review accounts, authorization and the accounting period, then retry.`, response.status, code)
 }
 if (!data) throw new QboFailure(false, 'QuickBooks returned an unreadable result. Retry the saved request to recover it.')
 return data
}

export async function qboCatalog(conn: QboConnection) {
 const preferences = (await qboRequest(conn, 'preferences')).Preferences?.CurrencyPrefs
 if (preferences?.HomeCurrency?.value !== 'USD') fail('QBO_CURRENCY', 'Connect a QuickBooks company with USD home currency.', 409)
 const read = async (entity: string) => {
  const rows: Row[] = []
  for (let start = 1; start <= 10_001; start += 1000) {
   const result = await qboRequest(conn, 'query?query=' + encodeURIComponent(`select * from ${entity} where Active = true startposition ${start} maxresults 1000`))
   const page = result.QueryResponse?.[entity] ?? []
   if (!Array.isArray(page)) fail('QBO_RESPONSE', 'QuickBooks returned an invalid account catalog.', 502)
   rows.push(...page)
   if (page.length < 1000) return rows
  }
  fail('QBO_CATALOG', 'This QuickBooks account catalog exceeds the supported size.', 409)
 }
 return { accounts: await read('Account'), classes: await read('Class'), locations: await read('Department'), multiCurrency: Boolean(preferences.MultiCurrencyEnabled) }
}

import { commit, event, fail, id, sql, type Context, type Row } from '../../db'
import { page } from '../../ui/common'
import type { PaymentsEnv } from '../pantry'
import { QboFailure, qboCatalog } from './client'
import { beginConnection, finishConnection, qboConnection, qboOwner, qboSettings, saveMapping } from './connection'
import { prepareDeposit } from './deposits'
import { postDeposit, qboPostings, readRemote } from './postings'
import { qboDepositPage, qboSettingsPage } from './ui'

const json = (value: unknown) => Response.json(value, { headers: { 'cache-control': 'no-store' } })
const redirect = (location: string) => new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
export async function quickbooksResponse(request: Request, c: Context, env: PaymentsEnv, input: () => Promise<Row>) {
 const url = new URL(request.url), path = url.pathname, api = path.startsWith('/api/'), apiRoot = '/api/coffer/payments/quickbooks', appRoot = '/app/payouts/quickbooks', settings = '/app/settings/quickbooks'
 if (!(path === apiRoot || path.startsWith(apiRoot + '/') || path.startsWith(appRoot + '/') || path === settings || path.startsWith(settings + '/'))) return null
 qboOwner(c, env)
 const suffix = path.startsWith(settings) ? path.slice(settings.length) : path.slice((api ? apiRoot : appRoot).length)
 try {
  if (suffix === '/connect' && (request.method === 'POST' || !api && request.method === 'GET')) {
   const result = await beginConnection(c, env)
   return api ? json(result) : redirect(result.url)
  }
  if (suffix === '/callback' && request.method === 'GET') {
   await finishConnection(c, env, url.searchParams)
   return redirect(settings)
  }
  if (suffix === '/disconnect' && request.method === 'POST') {
   await commit(c, [sql('DELETE FROM cf_qbo_connection'), sql('DELETE FROM cf_qbo_oauth'), event(c, 'quickbooks.disconnected', 'settings', 'quickbooks', null)])
   return api ? json({ connected: false }) : redirect(settings)
  }
  if (suffix === '/mapping' && request.method === 'POST') {
   const data = await input()
   if (!api) {
    data.funds = {}
    for (let i = 0; data['fund' + i] !== undefined; i++) data.funds[data['fund' + i]] = { accountId: data['account' + i], classId: data['class' + i], locationId: data['location' + i] }
   }
   const result = await saveMapping(c, env, data)
   return api ? json(result) : redirect(settings)
  }
  if (suffix === '' && request.method === 'GET') {
   const view = await qboSettings(c)
   return api ? json(view) : page('QuickBooks settings', qboSettingsPage(view, view.connection ? await qboCatalog(await qboConnection(c, env)) : null, Boolean(env.QBO_CLIENT_ID && env.QBO_CLIENT_SECRET)), c.actor, 200, '/app/settings')
  }
  const source = suffix.match(/^\/(payout|batch)\/([^/]+)(?:\/(post|remote))?$/)
  if (source) {
   const kind = source[1], sourceId = id(decodeURIComponent(source[2]), 'Deposit ID'), action = source[3]
   if (action === 'post' && request.method === 'POST') {
    const result = await postDeposit(c, env, kind, sourceId, (await input()).confirm)
    return api ? json(result) : redirect(`${appRoot}/${kind}/${encodeURIComponent(sourceId)}`)
   }
   if (action === 'remote' && request.method === 'GET') return json(await readRemote(c, env, kind, sourceId))
   if (!action && request.method === 'GET') {
    const rows = await qboPostings(c, kind, sourceId), preview = rows.some(r => r.kind === kind) ? null : await prepareDeposit(c, await qboConnection(c, env), kind, sourceId)
    return api ? json({ postings: rows, preview }) : page('QuickBooks deposit', qboDepositPage(kind, sourceId, rows, preview), c.actor, 200, '/app/payouts')
   }
  }
  fail('method_not_allowed', 'Use the QuickBooks settings or deposit controls.', 405)
 } catch (error) {
  if (error instanceof QboFailure) fail('QBO_UNAVAILABLE', error.message, 502)
  throw error
 }
}

import { manager, person } from '../auth'
import { fail, id, type Context } from '../db'
import { available, managed } from '../giving/stripe'
import { page } from '../ui/common'
import { evidenceCsv, journalIif, qboCsv } from './exports'
import { postToPantry, type PaymentsEnv } from './pantry'
import { matchManualPayout, payoutDetail, payoutList, syncPayouts } from './payouts'
import { payoutDetailPage, payoutListPage, payoutStyles } from './ui'

const json = (value: unknown) => Response.json(value, { headers: { 'cache-control': 'no-store' } })
export async function paymentsResponse(request: Request, c: Context, env: PaymentsEnv, input: () => Promise<any>): Promise<Response | null> {
 const path = new URL(request.url).pathname, api = path.startsWith('/api/'), root = api ? '/api/coffer/payments' : '/app/payouts'
 if (!path.startsWith(root)) return null
 if (!manager(c.actor)) fail('manager_required', 'Only the owner or an admin manages payouts.', 403)
 if (!api && !person(c.actor)) fail('person_required', 'Use the API for automated access.', 403)
 if (path === '/api/coffer/payments/styles.css' && ['GET', 'HEAD'].includes(request.method)) return new Response(payoutStyles, { headers: { 'content-type': 'text/css', 'cache-control': 'private, max-age=3600' } })
 const flags = { managed: managed(env), stripeAvailable: available(env), pantryAvailable: !managed(env) && Boolean(env.PANTRY_ORIGIN && env.PANTRY_AGENT_TOKEN) }
 const redirect = (location: string) => new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } })
 const suffix = path.slice(root.length)
 if (suffix === '/sync' && request.method === 'POST') {
  const data = await input(), payoutId = data.payoutId ? id(data.payoutId, 'Stripe payout ID') : undefined
  const result = await syncPayouts(env, payoutId, c)
  return api ? json(result) : redirect(payoutId ? '/app/payouts/' + encodeURIComponent(payoutId) : '/app/payouts')
 }
 const match = suffix.match(/^\/([^/]+)(?:\/(post|match|evidence\.csv|qbo\.csv|journal\.iif))?$/)
 if (match) {
  const payoutId = id(decodeURIComponent(match[1]), 'Payout ID'), action = match[2], view = await payoutDetail(c, payoutId)
  if (action === 'match' && request.method === 'POST') {
   const result = await matchManualPayout(env, c, payoutId, await input())
   return api ? json(result) : redirect('/app/payouts/' + encodeURIComponent(payoutId))
  }
  if (action === 'post' && request.method === 'POST') {
   const data = await input(), result = await postToPantry(c, env, view, data.documentId || undefined)
   return api ? json(result) : redirect('/app/payouts/' + encodeURIComponent(payoutId))
  }
  if (!['GET', 'HEAD'].includes(request.method)) fail('method_not_allowed', 'Use the payout buttons.', 405)
  if (action && action !== 'post') {
   const body = action === 'evidence.csv' ? evidenceCsv(view) : action === 'qbo.csv' ? await qboCsv(view, env) : await journalIif(view, env)
   const filename = `coffer-${payoutId.replace(/[^a-zA-Z0-9_-]/g, '')}-${action}`
   return new Response(body, { headers: { 'content-type': action.endsWith('.iif') ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' } })
  }
  if (action) fail('method_not_allowed', 'Use POST.', 405)
  return api ? json(view) : page('Payout details', payoutDetailPage({ ...view, ...flags }), c.actor, 200, '/app/payouts')
 }
 if (suffix === '' && ['GET', 'HEAD'].includes(request.method)) {
  const view = await payoutList(c)
  return api ? json(view) : page('Payouts', payoutListPage({ ...view, ...flags }), c.actor, 200, '/app/payouts')
 }
 fail('not_found', 'That payout page is not available.', 404)
}

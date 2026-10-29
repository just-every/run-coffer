import { approveDonorMatch, donorMatchQueue, donorMatchView, refreshDonorMatch } from './donor-match'
import { donorMatchPage, donorMatchQueuePage, donorMatchStyles } from './donor-match-ui'
import { quickbooksResponse } from './quickbooks/http'
import { batchDeposit, batchEvidence, postBatchToPantry } from './batch-deposits'
import { batchDepositPage } from './batch-ui'
import { reconciliation } from './reconciliation'
import { reconciliationPage } from './reconciliation-ui'
import { adjustmentState, requestRefund } from './refunds'
import { adjustmentsPage } from './adjustments-ui'
import { feeReport } from './fee-report'
import { feeReportPage } from './fee-report-ui'
import { periodJournal } from './period-journal'
import { manager, person } from '../auth'
import { fail, id, type Context } from '../db'
import { available, managed } from '../giving/stripe'
import { settings } from '../settings'
import { page } from '../ui/common'
import { evidenceCsv, journalIif, qboCsv } from './exports'
import { postToPantry, type PaymentsEnv } from './pantry'
import { matchManualPayout, payoutDetail, payoutList, syncPayouts } from './payouts'
import { payoutDetailPage, payoutListPage, payoutStyles } from './ui'

const json = (value: unknown) => Response.json(value, { headers: { 'cache-control': 'no-store' } })
export async function paymentsResponse(request: Request, c: Context, env: PaymentsEnv, input: () => Promise<any>): Promise<Response | null> {
 const quickbooks = await quickbooksResponse(request, c, env, input)
 if (quickbooks) return quickbooks
 const path = new URL(request.url).pathname, api = path.startsWith('/api/'), root = api ? '/api/coffer/payments' : '/app/payouts'
 if (!path.startsWith(root)) return null
 if (!manager(c.actor)) fail('manager_required', 'Only the owner or an admin manages payouts.', 403)
 if (!api && !person(c.actor)) fail('person_required', 'Use the API for automated access.', 403)
 if (path === '/api/coffer/payments/styles.css' && ['GET', 'HEAD'].includes(request.method)) return new Response(payoutStyles, { headers: { 'content-type': 'text/css', 'cache-control': 'private, max-age=3600' } })
 const flags = { managed: managed(env), stripeAvailable: available(env), pantryAvailable: !managed(env) && Boolean(env.PANTRY_ORIGIN && env.PANTRY_AGENT_TOKEN) }
 const redirect = (location: string) => new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } })
 const suffix = path.slice(root.length)
 if(suffix==='/donor-match.css'&&['GET','HEAD'].includes(request.method))return new Response(donorMatchStyles,{headers:{'content-type':'text/css','cache-control':'no-store'}})
 if(suffix==='/donor-matches'&&['GET','HEAD'].includes(request.method)){
  const view=await donorMatchQueue(c)
  return api?json(view):page('Donor matches',donorMatchQueuePage(view),c.actor,200,'/app/payouts')
 }
 const donorReview=suffix.match(/^\/donor-matches\/([^/]+)(?:\/(approve|refresh))?$/)
 if(donorReview){
  const chargeId=id(decodeURIComponent(donorReview[1]),'Stripe charge'),action=donorReview[2]
  if(request.method==='POST'&&action){
   const data=await input()
   if(!api&&action==='approve'){
    const selection=String(data.selection??''),at=selection.lastIndexOf(':')
    data.donorId=selection.slice(0,at);data.donorVersion=Number(selection.slice(at+1))
   }
   const result=action==='approve'?await approveDonorMatch(c,env,chargeId,data):await refreshDonorMatch(c,env,chargeId)
   return api?json(result):redirect('/app/payouts/donor-matches/'+encodeURIComponent(chargeId))
  }
  if(action||!['GET','HEAD'].includes(request.method))fail('method_not_allowed','Use the donor review buttons.',405)
  const view=await donorMatchView(c,chargeId)
  return api?json(view):page('Review donor match',donorMatchPage(view),c.actor,200,'/app/payouts')
 }
 if (suffix === '/refunds' && request.method === 'POST') {
  const result = await requestRefund(c,env,await input())
  return api ? json(result) : redirect('/app/payouts/adjustments')
 }
 if (suffix === '/adjustments' && ['GET','HEAD'].includes(request.method)) {
  const state=await adjustmentState(c)
  return api ? json(state) : page('Refunds and disputes',adjustmentsPage(state),c.actor,200,'/app/payouts')
 }
 if (suffix === '/sync' && request.method === 'POST') {
  const data = await input(), payoutId = data.payoutId ? id(data.payoutId, 'Stripe payout ID') : undefined
  const result = await syncPayouts(env, payoutId, c)
  return api ? json(result) : redirect(payoutId ? '/app/payouts/' + encodeURIComponent(payoutId) : '/app/payouts')
 }
 if (suffix === '/fees' && ['GET', 'HEAD'].includes(request.method)) {
  const payoutId = new URL(request.url).searchParams.get('payoutId') || null
  const report = await feeReport(c, payoutId)
  return api ? json(report) : page('Processing fees', feeReportPage(report, payoutId), c.actor, 200, '/app/payouts')
 }
 if (suffix === '/reconciliation' && ['GET','HEAD'].includes(request.method)) {
  const report=await reconciliation(c,new URL(request.url))
  return api ? json(report) : page('Reconciliation',reconciliationPage(report),c.actor,200,'/app/payouts')
 }
 if (suffix === '/journal') {
  if (!['GET', 'HEAD'].includes(request.method)) fail('method_not_allowed', 'Use GET to download a journal.', 405)
  return periodJournal(c, env, new URL(request.url))
 }
 const batchMatch=suffix.match(/^\/batches\/([^/]+)(?:\/(post|evidence\.csv))?$/)
 if(batchMatch){
  const batchId=id(decodeURIComponent(batchMatch[1]),'Batch ID'),action=batchMatch[2],view=await batchDeposit(c,batchId)
  if(action==='post'&&request.method==='POST'){
   const data=await input(),result=await postBatchToPantry(c,env,view,data.documentId||undefined)
   return api?json(result):redirect('/app/payouts/batches/'+encodeURIComponent(batchId))
  }
  if(!['GET','HEAD'].includes(request.method)||action==='post')fail('method_not_allowed','Use the deposit buttons.',405)
  if(action==='evidence.csv')return new Response(batchEvidence(view),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="coffer-batch-${batchId.replace(/[^a-zA-Z0-9_-]/g,'')}.csv"`,'cache-control':'no-store'}})
  return api?json(view):page('Batch deposit',batchDepositPage(view,flags.pantryAvailable,flags.managed),c.actor,200,'/app/payouts')
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
  return api ? json(view) : page('Payout details', payoutDetailPage({ ...view, ...flags, timezone: (await settings(c)).timezone }), c.actor, 200, '/app/payouts')
 }
 if (suffix === '' && ['GET', 'HEAD'].includes(request.method)) {
  const view = await payoutList(c)
  return api ? json(view) : page('Payouts', payoutListPage({ ...view, ...flags, timezone: (await settings(c)).timezone }), c.actor, 200, '/app/payouts')
 }
 fail('not_found', 'That payout page is not available.', 404)
}

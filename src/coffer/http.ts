import { grantsState, grantDownload } from './grants'
import { grantsPage } from './ui/grants'
import { engagementPolicy, engagementScores } from './engagement'
import { engagementPage } from './ui/engagement'
import { cultivationState, proposalDownload } from './cultivation'
import { cultivationPage } from './ui/cultivation'
import { portfolioReport } from './portfolios'
import { portfoliosPage } from './ui/portfolios'
import { recurringHealth } from './recurring-health'
import { recurringHealthPage } from './ui/recurring-health'
import { restrictionReport } from './restricted-funds'
import { restrictedFundsPage } from './ui/restricted-funds'
import { recurringTasks } from './recurring-tasks'
import { reassignmentReason } from './reassignment-reasons'
import { fundEntries, fundLedgerCsv, fundReport } from './fund-report'
import { auditCsv, auditLog, recordRequest } from './audit'
import { auditPage } from './ui/audit'
import { compareDonors, likelyDuplicates } from './duplicates'
import { comparePage, duplicatesPage } from './ui/duplicates'
import { fundReportPage } from './ui/fund-report'
import { welcomeState } from './communications/welcome'
import { preferenceState } from './communications/preferences'
import { replyTasks } from './communications/replies'
import { callTasks, taskOwners, taskSources } from './call-tasks'
import { lapses } from './lapses'
import { annualLapses } from './annual-lapses'
import { annualLapsesPage } from './ui/annual-lapses'
import { retention } from './retention'
import { prospects, opportunityStages, opportunityPipeline } from './major-gifts'
import { callTasksPage } from './ui/call-tasks'
import { lapsesPage } from './ui/lapses'
import { retentionPage } from './ui/retention'
import { majorGiftsPage } from './ui/major-gifts'
import type { Bindings } from '../auth.server'
import { runtimeBindings } from '../auth.server'
import { createPortability } from '@runeditrun/rer/modules/portability'
import { createPortabilityHandler } from './portability/http.mjs'
import policy from './archive-policy.mjs'
import { identity, manager, originGuard, person, type Actor, type Authority } from './auth'
import { CofferError, fail, today, type Context } from './db'
import { canonicalDonor } from './donor-merge'
import { execute } from './commands'
import { listDonors, donorHistory } from './donors'
import { batchDetail, batches, batchLetters, dueGifts, lettersCsv, currentLetterGiftsCondition } from './acknowledgements'
import { appealDetail, appeals, recipientsCsv, recipientsOf } from './appeals'
import { settings } from './settings'
import * as imports from './imports/index'
import { readStripe } from './imports/live-stripe'
import { available as stripeAvailable } from './giving/stripe'
import { page, when } from './ui/common'
import { givingResponse } from './giving/http'
import { paymentsResponse } from './payments/http'
import { agentResponse } from './agent/http'
import { crmMoveInResponse } from './move-in/http'
import { createCampaign, campaigns } from './giving/campaigns'
import { givingManagePage } from './giving/manage-ui'
import { checkStripe, givingSetupPage } from './giving/setup'
import { invitePerson, people } from './people'
import { receiptEvents } from './letter-delivery'
import { printLetters } from './ui/print-letters'
import { home } from './ui/home'
import { donorsPage, donorPage } from './ui/donors'
import { giftsPage } from './ui/gifts'
import { lettersPage, batchPage } from './ui/letters'
import { appealsPage, appealPage } from './ui/appeals'
import { connectPage } from './communications/connect-ui'
import { morePage, settingsPage, dataPage } from './ui/more'
import { moveInPage, previewPage, journalPage } from './ui/move-in'

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const redirect = (path: string) => new Response(null, { status: 303, headers: { ...headers, location: path } })
const download = (body: string, name: string) => new Response(body, { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"` } })
const LIMIT = 1024 * 1024, MOVE_IN_LIMIT = 12 * 1024 * 1024

async function textBody(request: Request, limit: number) {
 const reader = request.body?.getReader(); if (!reader) return ''
 const chunks: Uint8Array[] = []; let length = 0
 try { for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > limit) fail('body_too_large', 'That upload is too large.', 413); chunks.push(value) } } finally { await reader.cancel(); reader.releaseLock() }
 const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
 return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
async function jsonBody(request: Request, limit = LIMIT) {
 if (!request.headers.get('content-type')?.startsWith('application/json')) fail('json_required', 'Send JSON.', 415)
 const text = await textBody(request, limit)
 try { const input = JSON.parse(text); if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error(); return input } catch { return fail('invalid_json', 'The request body is not a JSON object.', 400) }
}
/** Native forms: url-encoded, or multipart for the move-in file pickers. */
async function formBody(request: Request, limit = LIMIT): Promise<FormData> {
 const type = request.headers.get('content-type') ?? ''
 if (type.startsWith('multipart/form-data')) {
  if (Number(request.headers.get('content-length') ?? 0) > limit) fail('body_too_large', 'That upload is too large.', 413)
  return request.formData() as Promise<FormData>
 }
 if (!type.startsWith('application/x-www-form-urlencoded')) fail('form_required', 'Send the form.', 415)
 const data = new FormData(); for (const [key, value] of new URLSearchParams(await textBody(request, limit))) data.append(key, value)
 return data
}
async function formInput(data: FormData) {
 const input: Record<string, any> = Object.fromEntries(data)
 for (const name of ['version', 'sourceVersion', 'targetDays', 'reminderDays', 'intervalMonths', 'untouchedDays', 'templateVersion']) if (typeof input[name] === 'string' && input[name] !== '') input[name] = Number(input[name])
 if (input.command === 'gift.record' && data.has('splitAmount')) {
  const funds=data.getAll('splitFund'),campaigns=data.getAll('splitCampaign')
  input.allocations=data.getAll('splitAmount').map((amount,i)=>({amount,fund:funds[i],campaignId:campaigns[i]}))
 }
 if (input.command === 'consent.record') input.donorIds = data.getAll('donorIds')
 if (input.command === 'donor.merge') input.fields = Object.fromEntries([...data].filter(([key])=>key.startsWith('field:')).map(([key,value])=>[key.slice(6),value]))
 if (input.command === 'ack.prepare' && data.has('giftIds')) input.giftIds = data.getAll('giftIds')
 if (['proposal.attach','grant.attach'].includes(input.command)) {
  const file=data.get('attachment')
  if (!file || typeof file==='string' || file.size<1 || file.size>256000) fail('INPUT','Attach a nonempty PDF or plain-text document up to 256 KB.',400)
  input.fileName=file.name; input.mediaType=file.type
  const bytes=new Uint8Array(await file.arrayBuffer()); let binary=''
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
  input.contentBase64=btoa(binary);delete input.attachment
 }
 return input
}
/** Stripe pages from file pickers and/or pasted JSON: one list response or an array of them. */
async function pages(data: FormData, name: string) {
 const out: unknown[] = []
 const add = (text: string, label: string) => { if (!text.trim()) return; let value; try { value = JSON.parse(text) } catch { fail('IMPORT_SHAPE', `${label} is not valid JSON.`, 400) } out.push(...(Array.isArray(value) ? value : [value])) }
 for (const file of data.getAll(`${name}Files`)) if (typeof file !== 'string') add(await file.text(), file.name || name)
 const pasted = data.get(name); if (typeof pasted === 'string') add(pasted, name)
 return out
}

const ROUTES = /^\/(app|api\/coffer|api\/portability)(\/|$)/
export async function cofferResponse(request: Request, original: Bindings): Promise<Response | null> {
 const response = await cofferHandler(request, original)
 const path = new URL(request.url).pathname
 const provider = path === '/api/coffer/giving/webhook' || path === '/api/coffer/mail/events'
 if (response && response.status < 400 && !provider && !response.headers.get('location')?.startsWith('/signin') && ROUTES.test(path)) {
  const env = runtimeBindings(original), auth = await identity(request,env)
  try { await recordRequest({ db:env.DB,actor:auth.actor,authority:auth.authority,now:new Date().toISOString(),env },request,response) }
  catch (error) { if (error instanceof CofferError) return json({error:error.code,message:error.message},error.status); throw error }
 }
 return response
}
async function cofferHandler(request: Request, original: Bindings): Promise<Response | null> {
 if (new URL(request.url).pathname === '/api/coffer/mail/events') return receiptEvents(request, original)
 const publicGiving = await givingResponse(request, original); if (publicGiving) return publicGiving
 const url = new URL(request.url), path = url.pathname
 if (!ROUTES.test(path)) return null
 const env = runtimeBindings(original), isApi = path.startsWith('/api/')
 let actor: Actor | undefined
 try {
  const auth = await identity(request, env); actor = auth.actor; originGuard(request, env, auth.bearer)
  if (!['GET', 'POST', 'PUT', 'HEAD'].includes(request.method)) fail('method_not_allowed', 'That method is not supported here.', 405)
  const c: Context = { db: env.DB, actor, authority: auth.authority, now: new Date().toISOString(), env }
  if (!isApi && person(actor)) actor.org = (await settings(c)).organisation || undefined
  const agent = await agentResponse(request, c, env, async () => isApi ? jsonBody(request) : Object.fromEntries(await formBody(request)))
  if (agent) return agent
  const crmMoveIn = await crmMoveInResponse(request, c, { jsonBody, formBody })
  if (crmMoveIn) return crmMoveIn
  const payments = await paymentsResponse(request, c, env, async () => isApi ? jsonBody(request) : Object.fromEntries(await formBody(request)))
  if (payments) return payments
  if (path === '/api/coffer/giving/campaigns' || path === '/app/giving/campaigns') {
   if (request.method === 'GET' && isApi) return json({ campaigns: await campaigns(c) })
   if (request.method !== 'POST') fail('method_not_allowed', 'Use the campaign form.', 405)
   const input = isApi ? await jsonBody(request) : Object.fromEntries(await formBody(request))
   const result = await createCampaign(c, input)
   return isApi ? json(result) : redirect('/app/giving')
  }
  if (path === '/app/giving/setup/check' && request.method === 'POST') {
   if (!manager(actor)) fail('manager_required', 'Only the owner or an admin connects Stripe.', 403)
   return page('Connect Stripe', await givingSetupPage(c, await checkStripe(c)), actor, 200, '/app/giving')
  }
  if (path === '/app/people/invite' && request.method === 'POST') {
   const invited = await invitePerson(request, c, env, Object.fromEntries(await formBody(request)))
   return redirect('/app/data?invited=' + encodeURIComponent(invited) + '#people')
  }
  if (path.startsWith('/api/portability/')) {
   if (actor.role !== 'owner') fail('owner_required', 'Only the owner can back up or restore.', 403)
   const handler = await createPortabilityHandler({ db: env.DB, policy, appOrigin: env.AUTH_ORIGIN, authorize: async req => { const current = await identity(req, env); originGuard(req, env, current.bearer); return current.actor.role === 'owner' ? current.actor.id : null } })
   return await handler(request)
  }
  if (path.startsWith('/api/coffer/imports/') || path.startsWith('/app/move-in/')) return await moveIn(request, c, auth.authority, path, isApi)
  if ((path === '/api/coffer/commands' || path === '/app/actions') && request.method === 'POST') {
   const data = path === '/app/actions' ? await formInput(await formBody(request, 400000)) : await jsonBody(request), command = String(data.command), input = data.input ?? data
   let result
   try { result = command === 'donor.erase' ? await eraseDonor(c, auth.authority, input) : await execute(c, command, input) }
   catch (error: any) {
    // A rejected appeal form comes back on its own page with the answers kept.
    if (!isApi && command === 'appeal.prepare' && error instanceof CofferError && error.status === 400) return page('Appeals', await appealsPage(c, { error: error.message, values: input }), actor, 400, '/app/appeals')
    if (!isApi && CONNECT.has(command) && error instanceof CofferError) return page('Connect email marketing', await connectPage(c, error.message), actor, error.status ?? 409, '/app/appeals')
    throw error
   }
   if (isApi) return json(result)
   return actionPage(command, input, result, actor, (await settings(c)).timezone)
  }
  if (path === '/app/backup' && request.method === 'POST') {
   if (actor.role !== 'owner') fail('owner_required', 'Only the owner can download a backup.', 403)
   const service = await createPortability({ db: env.DB, policy }), id = await service.exports.create(actor.id)
   let state = await service.exports.advance(id, { maxParts: 1 })
   while (state.phase !== 'complete') state = await service.exports.advance(id, { expectedPart: state.completed, maxParts: 1 })
   return new Response(await service.exports.download(id), { headers: { ...headers, 'content-type': 'application/x-ndjson', 'content-disposition': 'attachment; filename="coffer.rer"' } })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') fail('method_not_allowed', 'Use the page’s buttons for changes.', 405)
  return isApi ? await api(c, url) : await screen(c, url, request)
 } catch (error: any) {
  const known = error instanceof CofferError || error instanceof imports.ImportError || typeof error?.code === 'string'
  // The import kit reports its refusals by code, alone or inside a D1 error.
  const kitCode = error instanceof Error ? (error.message.match(/^[A-Z][A-Z0-9_]{1,100}$/)?.[0] ?? error.message.match(/\b(IMPORT_[A-Z0-9_]+|NATIVE_EDIT_CONFLICT|SOURCE_ID_CONTENT_CONFLICT|TARGET_OWNER_BUSY)\b/)?.[1] ?? null) : null
  const status = known ? (error.status ?? 409) : kitCode ? 409 : 500, code = error?.code ?? kitCode ?? 'operation_failed'
  const message = known ? error.message : kitCode ? kitMessage(kitCode) : 'The operation failed.'
  if (status === 500) console.error('coffer request failed', error)
  if (isApi) return json({ error: code, message, details: error?.details ?? undefined }, status)
  if (status === 401) return redirect('/signin?returnTo=' + encodeURIComponent(path))
  const back = path.startsWith('/app/actions') || path.startsWith('/app/move-in/') ? (request.headers.get('referer') && new URL(request.headers.get('referer')!).origin === url.origin ? new URL(request.headers.get('referer')!).pathname : '/app') : '/app'
  return page('Could not complete that', `<p role="alert" class="alert">${esc(message)}</p>${error?.details ? `<details class="facts"><summary>Details</summary><pre>${esc(JSON.stringify(error.details, null, 2))}</pre></details>` : ''}<p><a href="${esc(back)}">Go back</a></p>`, actor, status, path)
 }
}
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
function kitMessage(code: string) {
 if (code === 'IMPORT_ATOMIC_GUARD' || code === 'NATIVE_EDIT_CONFLICT') return 'Some imported records have changed or been used since the import (for example a new gift, consent, letter or appeal). Undo leaves them in place and stops here.'
 if (code === 'IMPORT_D1_REQUEST_LIMIT') return 'This step ran out of database room for one request. Use Continue to carry on.'
 return `The import stopped: ${code}.`
}

async function eraseDonor(c: Context, authority: Authority, input: any) {
 if (c.actor.role !== 'owner') fail('owner_required', 'Only the owner can erase a donor.', 403)
 if (input?.confirm !== 'ERASE') fail('confirmation_required', 'Type ERASE to confirm.', 400)
 const reason = reassignmentReason('erase', input.reason ?? 'donor_request')
 const donorId = await canonicalDonor(c, String(input.donorId ?? ''))
 const aliases = await c.db.prepare('SELECT donor_id FROM cf_donor_merges WHERE into_id=?').bind(donorId).all<{donor_id:string}>()
 for (const alias of aliases.results) await eraseSingleDonor(c, authority, alias.donor_id, reason)
 return eraseSingleDonor(c, authority, donorId, reason)
}
async function eraseSingleDonor(c: Context, authority: Authority, donorId: string, reason: string) {
 const placeholder = `erased-${crypto.randomUUID()}`
 const donor = await c.db.prepare('SELECT id,email FROM cf_donors WHERE id=? AND erased_at IS NULL').bind(donorId).first<{ id: string; email: string | null }>()
 if (!donor) fail('NOT_FOUND', 'That donor does not exist or was already erased.', 404)
 const checkpoint = await imports.portabilityCheckpoint(c.db)
 const aliases = await c.db.prepare('SELECT email FROM cf_donor_aliases WHERE donor_id=?').bind(donorId).all<{email:string}>()
 const nativeErasure = imports.donorErasureStatements({...donor,emails:aliases.results.map(a=>a.email)}, placeholder, c.now)
 const givingErasure = [
  { sql: 'INSERT OR IGNORE INTO cf_erased_stripe_customers(customer_id,donor_id) SELECT customer_id,? FROM cf_giving_customers WHERE donor_id=?', params: [placeholder, donorId] },
  { sql: "INSERT OR IGNORE INTO cf_erased_stripe_customers(customer_id,donor_id) SELECT source_ref,? FROM cf_donors WHERE id=? AND source='stripe' AND source_ref IS NOT NULL", params: [placeholder, donorId] },
  { sql: 'DELETE FROM cf_donor_merges WHERE donor_id=?', params: [donorId] },
  { sql: 'UPDATE cf_pledge_installments SET recipient_email=NULL,message_id=NULL,attempt_id=NULL WHERE pledge_id IN (SELECT id FROM cf_pledges WHERE donor_id=?)', params: [placeholder] },
  { sql: 'DELETE FROM cf_donor_tokens WHERE donor_id=?', params: [donorId] },
  { sql: 'DELETE FROM cf_giving_customers WHERE donor_id=?', params: [donorId] },
  { sql: "UPDATE cf_giving_intents SET donor_id=?,name='Erased donor',email='',customer_id=NULL WHERE donor_id=? OR email=?", params: [placeholder, donorId, donor.email ?? ''] },
  { sql: "UPDATE cf_subscriptions SET donor_id=?,customer_id='' WHERE donor_id=?", params: [placeholder, donorId] },
 ]
 // The placeholder must exist before its references move; delete the old donor last.
 const nativeStatements = [...nativeErasure.slice(0, -1), ...givingErasure, ...nativeErasure.slice(-1), { sql: "INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) VALUES(?,?,?,?,'donor.erase','donor',?,?,?)", params: [c.now, c.actor.id, c.actor.name, c.actor.role, placeholder, placeholder, JSON.stringify({reason})] }]
 const result: any = await imports.erase(c.db, c.actor, donorId, authority, { nativeStatements, checkpoint })
 return { erased: donorId, donorId: placeholder, receiptId: result.receiptId ?? result.id }
}

const CONNECT = new Set(['marketing.connectMango', 'marketing.connectMailchimp', 'marketing.chooseAudience', 'marketing.check', 'marketing.disconnect'])
function actionPage(command: string, input: any, result: any, actor: Actor, timeZone: string) {
 if (command === 'donor.merge' || command === 'donor.unmerge') return redirect('/app/audit?record='+encodeURIComponent(result.donorId))
 if (CONNECT.has(command)) return redirect('/app/appeals/connect')
 if (command.startsWith('welcome.') || command.startsWith('marketing.') || command.startsWith('reply.')) return redirect('/app/appeals')
 if (command.startsWith('fund.')) return redirect('/app/funds/restrictions')
 if (command.startsWith('task.')) return redirect('/app/calls?owner=&status=' + (command === 'task.complete' ? 'done' : 'active'))
 if (command.startsWith('portfolio.')) return redirect('/app/portfolios')
 if (command.startsWith('grant.')) return redirect('/app/grants')
 if (command === 'engagement.settings') return redirect('/app/engagement')
 if (command.startsWith('cultivation.') || command.startsWith('proposal.')) return redirect('/app/opportunities/' + encodeURIComponent(result.prospectId ?? input.prospectId))
 if (command.startsWith('prospect.')) return redirect('/app/pipeline')
 if (command === 'agent.create') return page('Agent key created', `<p>Copy this key once into your agent’s private environment. It will not be shown again.</p><pre class="secret">${esc(result.token)}</pre><p>Expires ${esc(when(new Date(result.expiresAt).toISOString(), timeZone))}.</p><p><a href="/app/data">Back to data &amp; access</a></p>`, actor)
 if (command === 'agent.revoke') return redirect('/app/data')
 if (command === 'settings.update') return redirect('/app/settings?saved=1')
 if (command === 'donor.create') return redirect(`/app/donors/${result.id}`)
 if (input.returnDonorId) return redirect(`/app/donors/${encodeURIComponent(input.returnDonorId)}`)
 if (command === 'donor.erase') return redirect(`/app/donors/${result.donorId}`)
 if (command === 'consent.record') return redirect(input.returnTo === 'donor' && input.donorIds?.length === 1 ? `/app/donors/${input.donorIds[0]}#consent` : '/app/donors?consent=' + result.recorded)
 if (command.startsWith('ack.')) return redirect(`/app/letters/${result.id ?? input.batchId}`)
 if (command.startsWith('appeal.')) return redirect(`/app/appeals/${result.id ?? input.appealId}`)
 return redirect(input.donorId ? `/app/donors/${input.donorId}` : '/app/donors')
}

async function moveIn(request: Request, c: Context, authority: Authority, path: string, isApi: boolean) {
 if (!manager(c.actor)) fail('manager_required', 'Only the owner or an admin moves records in.', 403)
 const action = path.split('/').at(-1)
 if (action === 'journal' && request.method === 'GET') {
  const result = await imports.journal(c.db, c.actor, new URL(request.url).searchParams.get('id') ?? '', authority)
  return isApi ? json(result) : page('Import journal', journalPage(result), c.actor, 200, '/app/more')
 }
 if (request.method !== 'POST') fail('post_required', 'Use the page’s buttons.', 405)
 const data = isApi ? await jsonBody(request, MOVE_IN_LIMIT) : await formBody(request, MOVE_IN_LIMIT)
 const get = (name: string) => isApi ? (data as any)[name] : (data as FormData).get(name)
 if (action === 'resume' || action === 'undo') {
  const result = await imports[action](c.db, c.actor, String(get('id')), authority)
  return isApi ? json(result) : redirect(`/app/move-in/journal?id=${encodeURIComponent(result.id)}`)
 }
 if (action === 'read-stripe') {
  const input = await readStripe(c.env!, Object.fromEntries(['start', 'end', 'readKey', 'noGoodsOrServices'].map(name => [name, get(name)])))
  const result = await imports.preview(c.db, c.actor, input, { ...authority, liveStripe: await imports.isLiveStripeInput(input, c.env!.SESSION_SECRET) })
  return isApi ? json({ input, ...result }) : page('Review the move-in', previewPage(input, result), c.actor, 200, '/app/more')
 }
 const input = isApi ? data : {
  customers: await pages(data as FormData, 'customers'), charges: await pages(data as FormData, 'charges'),
  subscriptions: await pages(data as FormData, 'subscriptions'), paymentIntents: await pages(data as FormData, 'paymentIntents'), invoices: await pages(data as FormData, 'invoices'),
  noGoodsOrServices: get('noGoodsOrServices') === 'yes', fingerprint: get('fingerprint') ?? undefined,
 }
 if (action === 'preview') { const result = await imports.preview(c.db, c.actor, input, { ...authority, liveStripe: await imports.isLiveStripeInput(input, c.env!.SESSION_SECRET) }); return isApi ? json(result) : page('Review the move-in', previewPage(input, result), c.actor, 200, '/app/more') }
 if (action === 'apply') {
  if (!isApi && get('confirm') !== 'yes') fail('confirmation_required', 'Tick the box to approve this exact plan.', 400)
  const result = await imports.apply(c.db, c.actor, input, { ...authority, liveStripe: await imports.isLiveStripeInput(input, c.env!.SESSION_SECRET) })
  return isApi ? json(result) : redirect(`/app/move-in/journal?id=${encodeURIComponent(result.id)}`)
 }
 return fail('not_found', 'Not found.', 404)
}

async function api(c: Context, url: URL): Promise<Response> {
 if (url.pathname === '/api/coffer/recurring-tasks') return json(await recurringTasks(c,url.searchParams.get('owner')))
 if (url.pathname === '/api/coffer/duplicates') return json(await likelyDuplicates(c,{donorId:url.searchParams.get('donorId'),page:Number(url.searchParams.get('page'))||0}))
 if (url.pathname === '/api/coffer/duplicates/compare') return json(await compareDonors(c,url.searchParams.get('source')??'',url.searchParams.get('target')??''))
 if (url.pathname === '/api/coffer/audit') return json(await auditLog(c,url))
 if (url.pathname === '/api/coffer/audit.csv') return download(await auditCsv(c,url),'coffer-audit')
 const path = url.pathname, match = (re: RegExp) => path.match(re)
 if (path === '/api/coffer/donors') return json(await listDonors(c, { q: url.searchParams.get('q'), page: Number(url.searchParams.get('page') ?? 0) || 0, relationship: url.searchParams.get('relationship'), relatedTo: url.searchParams.get('relatedTo') }))
 let m = match(/^\/api\/coffer\/donors\/([^/]+)$/)
 if (m) return json(await donorHistory(c, m[1]))
 if (path === '/api/coffer/letters') { const due = await dueGifts(c); return json({ today: due.today, thresholdCents: due.settings.threshold_cents, targetDays: due.settings.target_days, due: due.gifts, batches: await batches(c) }) }
 if ((m = match(/^\/api\/coffer\/letters\/([^/]+)$/))) return json(await batchDetail(c, m[1]))
 if ((m = match(/^\/api\/coffer\/letters\/([^/]+)\/letters\.csv$/))) return lettersFile(c, m[1])
 if (path === '/api/coffer/welcome') return json(await welcomeState(c))
 if (path === '/api/coffer/marketing/preferences') return json(await preferenceState(c))
 if (path === '/api/coffer/replies') return json(await replyTasks(c))
 if (path === '/api/coffer/appeals') return json({ appeals: await appeals(c) })
 if ((m = match(/^\/api\/coffer\/appeals\/([^/]+)$/))) return json(await appealDetail(c, m[1]))
 if ((m = match(/^\/api\/coffer\/appeals\/([^/]+)\/recipients\.csv$/))) return recipientsFile(c, m[1])
 if (path === '/api/coffer/reports/annual-lapses') return json(await annualLapses(c,url.searchParams.has('year') ? Number(url.searchParams.get('year')) : undefined))
 if (path === '/api/coffer/lapses') return json(await lapses(c))
 if (path === '/api/coffer/tasks') return json({ tasks: await callTasks(c,url.searchParams.get('owner'),url.searchParams.get('status')), owners: await taskOwners(c), sources: await taskSources(c) })
 if (path === '/api/coffer/retention') return json(await retention(c,url))
 if (path === '/api/coffer/portfolios') return json(await portfolioReport(c,url))
 const cultivation = path.match(/^\/api\/coffer\/opportunities\/([^/]+)$/)
 if(cultivation) return json(await cultivationState(c,cultivation[1]))
 const attachment=path.match(/^\/api\/coffer\/proposals\/([^/]+)\/download$/)
 if(attachment) return proposalDownload(c,attachment[1])
 if (path === '/api/coffer/grants') return json(await grantsState(c,url.searchParams.get('donorId')??undefined))
 const grantDocument=path.match(/^\/api\/coffer\/grant-documents\/([^/]+)\/download$/)
 if(grantDocument) return grantDownload(c,grantDocument[1])
 if (path === '/api/coffer/engagement/settings') return json(await engagementPolicy(c))
 if (path === '/api/coffer/engagement') return json(await engagementScores(c))
 if (path === '/api/coffer/prospect-stages') return json(await opportunityStages(c))
 if (path === '/api/coffer/pipeline') return json(await opportunityPipeline(c,url))
 if (path === '/api/coffer/prospects') return json(await prospects(c))
 if (path === '/api/coffer/reports/recurring') return json(await recurringHealth(c,url))
 if (path === '/api/coffer/reports/restrictions') return json(await restrictionReport(c,url))
 if (path === '/api/coffer/reports/funds') return json(await fundReport(c,url))
 if (path === '/api/coffer/settings') return json(await settings(c))
 return fail('not_found', 'Not found.', 404)
}
async function lettersFile(c: Context, batchId: string) {
 if (!manager(c.actor)) fail('manager_required', 'Only the owner or an admin downloads letters.', 403)
 const { batch } = await batchDetail(c, batchId)
 if (!['exported', 'sent'].includes(batch.status)) fail('NOT_EXPORTED', 'Export the approved letters first.')
 return download(lettersCsv(await batchLetters(c, batchId)), `coffer-letters-${batch.prepared_at.slice(0, 10)}`)
}
async function recipientsFile(c: Context, appealId: string) {
 if (!manager(c.actor)) fail('manager_required', 'Only the owner or an admin downloads an audience.', 403)
 const { appeal } = await appealDetail(c, appealId)
 if (!['exported', 'sent'].includes(appeal.status)) fail('NOT_EXPORTED', 'Export the approved audience first.')
 return download(recipientsCsv(appeal, await recipientsOf(c, appealId)), `coffer-appeal-${appeal.prepared_at.slice(0, 10)}`)
}

async function screen(c: Context, url: URL, request: Request): Promise<Response> {
 const path = url.pathname, actor = c.actor
 if (!person(actor)) fail('person_required', 'Agent keys use the /api/coffer endpoints.', 403)
 const show = (title: string, body: string) => page(title, body, actor, 200, path)
 if (path === '/app/duplicates') return show('Possible duplicates',await duplicatesPage(c,url))
 if (path === '/app/duplicates/compare') return show('Compare donor records',await comparePage(c,url))
 if (path === '/app/audit') return show('Audit log',await auditPage(c,url))
 if (path === '/app/audit.csv') return download(await auditCsv(c,url),'coffer-audit')
 if (path === '/app/giving/health') return show('Recurring giving health',await recurringHealthPage(c,url))
 if (path === '/app/funds/restrictions') return show('Restricted funds',await restrictedFundsPage(c,url))
 if (path === '/app/funds') return show('Giving by fund',await fundReportPage(c,url))
 if (path === '/app/funds/ledger.csv') {
  if (!manager(actor)) fail('manager_required','Only the owner or an admin exports accounting entries.',403)
  return download(fundLedgerCsv(await fundEntries(c,url,null)),'coffer-fund-ledger')
 }
 if (path === '/app/calls') return show('Call list', await callTasksPage(c,url))
 if (path === '/app/lapses') return url.searchParams.has('annual') ? show('LYBUNT and SYBUNT',await annualLapsesPage(c,url)) : show('Donors who need a call', await lapsesPage(c,url))
 if (path === '/app/retention') return show('Donor retention', await retentionPage(c,url))
 if (path === '/app/portfolios') return show('Portfolios and moves',await portfoliosPage(c,url))
 const cultivation = path.match(/^\/app\/opportunities\/([^/]+)$/)
 if(cultivation) return show('Action plan and proposals',await cultivationPage(c,cultivation[1]))
 if (path === '/app/grants') return show('Foundation and corporate grants',await grantsPage(c,url.searchParams.get('donorId')??undefined))
 if (path === '/app/engagement') return show('Engagement scores',await engagementPage(c))
 if (path === '/app/pipeline') return show('Major-gift pipeline', await majorGiftsPage(c,url))
 if (path === '/app') return show('Today', await home(c))
 if (path === '/app/giving') return show('Online giving', await givingManagePage(c))
 if (path === '/app/giving/setup') return show('Connect Stripe', await givingSetupPage(c))
 if (path === '/app/gifts') return page('Gifts', await giftsPage(c, url), actor, 200, path, { hideTitle: true })
 if (path === '/app/donors') return show('Donors', await donorsPage(c, url))
 let m = path.match(/^\/app\/donors\/([^/]+)$/)
 if (m) { const view = await donorPage(c, m[1], url); return show(view.title, view.body) }
 if (path === '/app/letters') return show('Acknowledgement letters', await lettersPage(c))
 if ((m = path.match(/^\/app\/letters\/([^/]+)$/))) return show('Letter batch', await batchPage(c, m[1]))
 if ((m = path.match(/^\/app\/letters\/([^/]+)\/print$/))) {
  if (!manager(actor)) fail('manager_required', 'Only the owner or an admin prints letters.', 403)
  const { batch, letters } = await batchDetail(c, m[1])
  if (!['approved','exported','sent'].includes(batch.status)) fail('NOT_APPROVED', 'Approve these letters before printing.')
  if (!(await c.db.prepare(`SELECT CASE WHEN (${currentLetterGiftsCondition}) THEN 1 ELSE 0 END AS ok`).bind(m[1]).first<{ok:number}>())?.ok) fail('GIFT_CHANGED', 'A statement gift changed. Prepare an updated statement before printing.')
  const selected = letters.filter(l => (!url.searchParams.has('letter') || l.id === url.searchParams.get('letter')) && (!url.searchParams.has('pending') || (l.route === 'print' && !l.printed_at)))
  return printLetters(selected, (await settings(c)).organisation)
 }
 if ((m = path.match(/^\/app\/letters\/([^/]+)\/letters\.csv$/))) return lettersFile(c, m[1])
 if (path === '/app/appeals') return show('Appeals', await appealsPage(c, null, url))
 if (path === '/app/appeals/connect') return show('Connect email marketing', await connectPage(c))
 if ((m = path.match(/^\/app\/appeals\/([^/]+)$/))) return show('Appeal', await appealPage(c, m[1]))
 if ((m = path.match(/^\/app\/appeals\/([^/]+)\/recipients\.csv$/))) return recipientsFile(c, m[1])
 if (path === '/app/more') return show('More', morePage(actor))
 if (path === '/app/settings') return show('Letter settings', await settingsPage(c, url.searchParams.has('saved')))
 if (path === '/app/data') {
  if (!manager(actor)) fail('manager_required', 'Only the owner or an admin manages data and access.', 403)
  return show('Data & access', dataPage(actor, (await c.db.prepare('SELECT id,label,expires_at,revoked_at FROM cf_agent_keys ORDER BY created_at DESC').all()).results, await people(request, c, c.env!), { local: c.env?.AUTH_LOCAL === 'true', invited: url.searchParams.get('invited'), now: Date.parse(c.now), timeZone: (await settings(c)).timezone }))
 }
 if (path === '/app/move-in') { if (!manager(actor)) fail('manager_required', 'Only the owner or an admin moves records in.', 403); return show('Move in from Stripe', moveInPage(await imports.jobs(c.db as any), today((await settings(c)).timezone, new Date(c.now)), stripeAvailable(c.env!))) }
 if (path === '/app/backup') fail('post_required', 'Use the backup button.', 405)
 return page('Page not found', '<p>There is nothing at this address.</p><p><a href="/app">Back to today</a></p>', actor, 404, path)
}

import { journeySettingsPanel } from './communications/journeys-ui'
import { journeyState } from './communications/journeys'
import { postalEvents } from './postal-delivery'
import { communicationPreferences } from './communications/preference-store'
import { constantContactPreferencesPanel } from './communications/preferences-ui'
import { singleLetter } from './single-letters'
import { singleLetterPage } from './ui/single-letters'
import { lettersPdfResponse, mergeDocxResponse, mergePackageResponse } from './print-exports'
import { apiErasureStatements } from './api/custody'
import { restApiResponse } from './api/http'
import { apiKeysPage, apiKeySecretPage } from './ui/api-keys'
import { auctionState, auctionUploadResponse } from './auction'
import { auctionPage } from './auction-ui'
import { auctionErasureStatements } from './auction-custody'
import { developmentReportResponse } from './agent/development-report-http'
import { taskTeam } from './task-team'
import { webhookState, webhookErasureStatements } from './webhooks'
import { webhookPage, webhookSecretPage } from './ui/webhooks'
import { eventRegistrationErasureStatements } from './privacy'
import { eventGuests, fundraisingEvents } from './fundraising-events'
import { eventsPage } from './ui/fundraising-events'
import { scheduledReportDocument } from './ui/scheduled-report'
import { scheduledReportLink } from './report-links'
import { reportSchedules } from './report-schedules'
import { reportSchedulesPage } from './ui/report-schedules'
import { agentGrantsPanel } from './ui/agent-grants'
import { reservePreparationGrant } from './agent-grants-legacy'
import { agentGrantsState } from './agent-grants'
import { grantedRead } from './agent-grants-reads'
import { savedConnection } from './communications/connection'
import { profileFieldsPanel } from './communications/profile-fields'
import { pledgeTemplatePanel } from './ui/pledge-template'
import { pledgeTemplateFields, pledgeTemplate, pledgeMergeReview } from './pledge-templates'
import { welcomePanel } from './communications/welcome-ui'
import { ackMailPieceGuard, ackMailPieces,printableAckPieces } from './ack-mail-pieces'
import { contributionTypeState } from './contribution-types'
import { addressState } from './addresses/state'
import { addressesPage } from './ui/addresses'
import { giftRulesState } from './gift-rules'
import { giftRulesPage } from './ui/gift-rules'
import { solicitationState } from './solicitation'
import { protectionState } from './giving/protection'
import { smsState, smsPreference, smsWebhook } from './sms'
import { textsPage } from './ui/sms'
import { smsRegistrationPanel } from './ui/sms-registration'
import { smsRegistrationState } from './sms-registration'
import { smsRegistrationEvents } from './sms-registration-events'
import { giftBatch, giftBatches } from './gift-batches'
import { giftBatchesPage } from './ui/gift-batches'
import { exportsResponse } from './exports-http'
import { savedLists } from './saved-lists'
import { exportsPage } from './ui/exports'
import { form } from './ui/common'
import { appealPieces } from './mail-pieces'
import { listMembers } from './list-members'
import { templateForm } from './ui/letter-templates'
import { report as customReport, reportCsv as customReportCsv } from './custom-report'
import { customReportPage } from './ui/custom-report'
import { customFields } from './custom-fields'
import { publishedTemplateFields } from './letter-templates'
import { printMeetingBrief } from './ui/meeting-brief'
import { pledgeInvoice } from './pledge-invoices'
import { printPledgeInvoice } from './ui/pledge-invoice'
import { householdState } from './households'
import { meetings, meetingBrief } from './meeting-briefs'
import { calendarCallback, calendarEvents, calendarState } from './calendars/google'
import { bookingState, bookingWebhook } from './calendars/bookings'
import { calendarPage, calendarSettingsPanel } from './ui/calendars'
import { documentsResponse } from './documents-http'
import { cleanDocumentUploads, purgeDocuments } from './documents'
import { notificationDownload } from './tribute-notifications'
import { tributeGroups } from './tribute-groups'
import { dashboardReport, dashboardEntries } from './dashboard'
import { dashboardPage } from './ui/dashboard'
import { report as honorRoll, honorRollCsv } from './recognition'
import { honorRollPage,honorRollUrl } from './ui/recognition'
import { researchState } from './research'
import { researchPage } from './ui/research'
import { volunteering, volunteerCsv } from './volunteering'
import { volunteeringPage } from './ui/volunteering'
import { mcpResponse } from './mcp'
import { taxReport } from './tax-reports'
import { taxReportsPage } from './ui/tax-reports'
import { inKindState, inKindAcknowledgment } from './in-kind'
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
import { donorFile } from './donor-file'
import { campaignInput } from './giving/media'
import { cleanVideoUploads, uploadCampaignVideo } from './giving/video'
import { stateReport, stateReportCsv } from './state-report'
import { stateReportPage } from './ui/state-report'
import { campaignProgress } from './campaign-progress'
import { campaignProgressPage } from './ui/campaign-progress'
import { attributionReport } from './attribution'
import { attributionPage } from './ui/attribution'
import { auditPage } from './ui/audit'
import { compareDonors, likelyDuplicates } from './duplicates'
import { comparePage, duplicatesPage } from './ui/duplicates'
import { fundReportPage } from './ui/fund-report'
import { welcomeState } from './communications/welcome'
import { preferenceState } from './communications/preferences'
import { replyTasks } from './communications/replies'
import { callTasks, taskCandidates, taskOwners, taskNotices, taskPolicy } from './call-tasks'
import { statusNotices } from './status'
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
import { identity, manager, originGuard, person, requireRole, type Actor, type Authority } from './auth'
import { all, commit, CofferError, fail, today, type Context, type Row } from './db'
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
import { staffPlanResponse } from './giving/http'
import { paymentsResponse } from './payments/http'
import { agentResponse } from './agent/http'
import { crmMoveInResponse } from './move-in/http'
import { updateFeeCover } from './giving/fee-cover'
import { createCampaign, campaigns } from './giving/campaigns'
import { publishCampaign } from './giving/campaign-publication'
import { givingManageResponse } from './giving/manage-ui'
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
import { letterTemplates } from './letter-templates'
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
 for (const name of ['version', 'householdVersion', 'targetHouseholdVersion', 'affectedCount', 'sourceVersion', 'targetDays', 'reminderDays', 'intervalMonths', 'untouchedDays', 'templateVersion', 'stopVersion']) if (typeof input[name] === 'string' && input[name] !== '') input[name] = Number(input[name])
 if (input.command === 'gift.record' && data.has('splitAmount')) {
  const funds=data.getAll('splitFund'),campaigns=data.getAll('splitCampaign')
  input.allocations=data.getAll('splitAmount').map((amount,i)=>({amount,fund:funds[i],campaignId:campaigns[i]}))
 }
 const customKeys=[...new Set([...data.keys()].filter(key=>key.startsWith('custom.')))]
 if(customKeys.length)input.customFields=Object.fromEntries(customKeys.filter(key=>data.getAll(key).some(value=>String(value).trim()!=='')).map(key=>[key.slice(7),data.has('many.'+key)?data.getAll(key):data.get(key)]))
 if(input.command==='custom.set'&&data.has('customMany'))input.value=data.getAll('customValues')
 if(input.command==='webhook.subscribe')input.events=data.getAll('events')
 if(input.command==='agentGrant.save')input.permissions=data.getAll('permissions')
 if(input.command==='communication.preferences')input.topics=data.getAll('topics')
 if(input.command==='ack.sendPostal')input.approvePostage=data.get('approvePostage')==='true'
 if (input.command === 'sms.prepare') input.donorIds=data.getAll('donorIds')
 if (input.command === 'research.screen') input.donorIds=data.getAll('donorIds')
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

// Retain the authority that produced a response: re-identifying after a read
// must never relabel an all-record response with a newly narrowed grant.
const responseAuthorities = new WeakMap<Request, Context>()
const ROUTES = /^\/(app|api\/coffer|api\/portability)(\/|$)/
export async function cofferResponse(request: Request, original: Bindings): Promise<Response | null> {
 const response = await cofferHandler(request, original)
 const path = new URL(request.url).pathname
 const provider = path === '/api/coffer/giving/webhook' || path === '/api/coffer/mail/events' || path === '/api/coffer/postal/events' || path === '/api/coffer/sms/webhook' || path === '/api/coffer/sms/registration/events' || path === '/api/coffer/calendar/bookings'
 if (response && response.status < 400 && !provider && !response.headers.get('location')?.startsWith('/signin') && ROUTES.test(path)) {
  const env = runtimeBindings(original), captured=responseAuthorities.get(request)
  const auth=captured?null:await identity(request,env)
  try { await recordRequest(captured??{ db:env.DB,actor:auth!.actor,authority:auth!.authority,now:new Date().toISOString(),env },request,response) }
  catch (error) { if (error instanceof CofferError) return json({error:error.code,message:error.message},error.status); throw error }
 }
 responseAuthorities.delete(request)
 return response
}
async function cofferHandler(request: Request, original: Bindings): Promise<Response | null> {
 if(new URL(request.url).pathname==='/api/coffer/calendar/bookings')return bookingWebhook(request,runtimeBindings(original))
 const rest=await restApiResponse(request,original)
 if(rest){if(rest.context)responseAuthorities.set(request,rest.context);return rest.response}
 if(new URL(request.url).pathname==='/api/coffer/sms/registration/events')return smsRegistrationEvents(request,runtimeBindings(original))
 if (new URL(request.url).pathname === '/api/coffer/sms/webhook') return smsWebhook(request,runtimeBindings(original))
 if(new URL(request.url).pathname==='/api/coffer/postal/events')return postalEvents(request,original)
 if (new URL(request.url).pathname === '/api/coffer/mail/events') return receiptEvents(request, original)
 const publicGiving = await givingResponse(request, original); if (publicGiving) return publicGiving
 const url = new URL(request.url), path = url.pathname
 if (!ROUTES.test(path)) return null
 const env = runtimeBindings(original), isApi = path.startsWith('/api/')
 let actor: Actor | undefined
 try {
  const auth = await identity(request, env); actor = auth.actor
  if(path==='/app/calendar/google/callback'&&request.method==='GET') {
   // Google returns by cross-site navigation. Keep the exact host check;
   // calendarCallback checks the native user's single-use authorization state.
   const callbackHeaders=new Headers(request.headers);callbackHeaders.delete('sec-fetch-site')
   originGuard(new Request(request,{headers:callbackHeaders}),env,auth.bearer)
  } else originGuard(request, env, auth.bearer, request.method === 'GET' && path === '/app/settings/quickbooks/callback')
  const c: Context = { db: env.DB, actor, authority: auth.authority, now: new Date().toISOString(), env }
  responseAuthorities.set(request,c)
  if(path==='/app/calendar/google/callback'&&request.method==='GET'){await calendarCallback(c,url);return redirect('/app/settings#calendar-settings')}
  if(c.actor.preparationGrant&&(request.method==='GET'||path==='/api/coffer/mcp'))await reservePreparationGrant(c,'read')
  if (path === '/api/coffer/mcp') {
   if (!auth.bearer || actor.role !== 'agent') fail('agent_key_required', 'Use an existing Coffer agent key for MCP.', 403)
   if (request.headers.has('origin') && request.headers.get('origin') !== url.origin) fail('invalid_origin', 'This MCP request came from another origin.', 403)
   return await mcpResponse(request, c, () => textBody(request, LIMIT))
  }
  if(actor.grant) {
   if(request.method==='GET' && path==='/api/coffer/donors')return json(await grantedRead(c,'donors.list',Object.fromEntries(url.searchParams)))
   const scopedDonor=path.match(/^\/api\/coffer\/donors\/([^/]+)$/)
   if(request.method==='GET'&&scopedDonor)return json(await grantedRead(c,'donors.context',{donorId:decodeURIComponent(scopedDonor[1])}))
   if(!(request.method==='POST'&&path==='/api/coffer/commands'))fail('GRANT_FORBIDDEN','This endpoint is outside the named agent grant.',403)
  }
  if (!['GET', 'POST', 'PUT', 'HEAD'].includes(request.method)) fail('method_not_allowed', 'That method is not supported here.', 405)
  if (!isApi && person(actor)) actor.org = (await settings(c)).organisation || undefined
  const scheduledLink=path.match(/^\/app\/scheduled-reports\/([^/]+)$/)
  if(scheduledLink&&request.method==='GET') {
   const report=await scheduledReportLink(c,decodeURIComponent(scheduledLink[1]))
   if(url.searchParams.get('download')==='1')return new Response(JSON.stringify(report,null,2),{headers:{...headers,'content-type':'application/json','content-disposition':'attachment; filename="coffer-report.json"'}})
   return page(report.title,scheduledReportDocument(report,path),actor)
  }
  if(path==='/api/coffer/giving/protection'&&request.method==='GET'){if(!manager(actor))fail('FORBIDDEN','Only the owner or an admin reviews giving protection.',403);return json({forms:await protectionState(c)})}
  const auctionUpload=await auctionUploadResponse(request,c)
  if(auctionUpload)return auctionUpload
  const documents=await documentsResponse(request,c,async()=>isApi?jsonBody(request):formBody(request,400000))
  if(documents)return documents
  const developmentReport=await developmentReportResponse(request,c,async()=>isApi?jsonBody(request):Object.fromEntries(await formBody(request)))
  if(developmentReport)return developmentReport
  const agent = await agentResponse(request, c, env, async () => isApi ? jsonBody(request) : Object.fromEntries(await formBody(request)))
  if (agent) return agent
  const crmMoveIn = await crmMoveInResponse(request, c, { jsonBody, formBody })
  if (crmMoveIn) return crmMoveIn
  const staffPlans = await staffPlanResponse(request,c)
  if(staffPlans)return staffPlans
  const payments = await paymentsResponse(request, c, env, async () => isApi ? jsonBody(request) : Object.fromEntries(await formBody(request)))
  if (payments) return payments
  const publication=path.match(/^\/(api\/coffer|app)\/giving\/campaigns\/([^/]+)\/publish$/)
  if(publication){
   if(request.method!=='POST')fail('method_not_allowed','Use the campaign review form.',405)
   const result=await publishCampaign(c,decodeURIComponent(publication[2]),isApi?await jsonBody(request):Object.fromEntries(await formBody(request)))
   return isApi?json(result):redirect('/app/giving/campaigns/'+encodeURIComponent(result.id))
  }
  const feeCover = path.match(/^\/(api\/coffer|app)\/giving\/campaigns\/([^/]+)\/fee-cover$/)
  if (feeCover) {
   if (request.method !== 'POST') fail('method_not_allowed', 'Use the fee-cover form.', 405)
   const result = await updateFeeCover(c, feeCover[2], isApi ? await jsonBody(request) : Object.fromEntries(await formBody(request)))
   return isApi ? json(result) : redirect('/app/giving/campaigns/' + encodeURIComponent(feeCover[2]))
  }
  const progress = path.match(/^\/(api\/coffer|app)\/giving\/campaigns\/([^/]+)$/)
  if (progress && request.method === 'GET') return isApi ? json(await campaignProgress(c, progress[2])) : page('Campaign progress', await campaignProgressPage(c, progress[2]), actor, 200, '/app/giving')
  const videoUpload = path.match(/^\/api\/coffer\/giving\/campaigns\/([^/]+)\/video$/)
  if (videoUpload) {
   if (request.method !== 'POST') fail('method_not_allowed', 'Use the campaign video upload form.', 405)
   return json(await uploadCampaignVideo(c, request, decodeURIComponent(videoUpload[1])))
  }
  if (path === '/api/coffer/giving/campaigns' || path === '/app/giving/campaigns') {
   if (request.method === 'GET' && isApi) return json({ campaigns: await campaigns(c) })
   if (request.method !== 'POST') fail('method_not_allowed', 'Use the campaign form.', 405)
   const input = await campaignInput(request, isApi)
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
   await cleanVideoUploads(c)
   await cleanDocumentUploads(c);await purgeDocuments(c)
   const handler = await createPortabilityHandler({ db: env.DB, buckets: { FILES: env.FILES }, policy, appOrigin: env.AUTH_ORIGIN, authorize: async req => { const current = await identity(req, env); originGuard(req, env, current.bearer); return current.actor.role === 'owner' ? current.actor.id : null } })
   return await handler(request)
  }
  if (path.startsWith('/api/coffer/imports/') || path.startsWith('/app/move-in/')) return await moveIn(request, c, auth.authority, path, isApi)
  if(path==='/api/coffer/tributes' && request.method==='GET')return json({groups:await tributeGroups(c)})
  const notification=path.match(/^\/(api\/coffer|app)\/tribute-notifications\/([^/]+)\/(download|print)$/)
  if(notification && request.method==='GET') {
   const n=await notificationDownload(c,notification[2])
   if(notification[3]==='print')return printLetters([{...n,subject:`Approved family notification · version ${n.version} · Not sent\n${n.subject}`,recipient_name:n.recipient_name,address:n.recipient_address?JSON.stringify({line1:n.recipient_address}):null,body:n.body,received_on:n.prepared_at.slice(0,10)}],(await settings(c)).organisation)
   return new Response(`Approved family notification · version ${n.version}\nNot sent by Coffer.\nTo: ${n.recipient_name}${n.recipient_email?' <'+n.recipient_email+'>':''}\nSubject: ${n.subject}\n\n${n.body}`,{headers:{...headers,'content-type':'text/plain; charset=utf-8','content-disposition':'attachment; filename="coffer-family-notification.txt"'}})
  }
  const dataRequest = path.match(/^\/(?:api\/coffer|app)\/donors\/([^/]+)\/data-request$/)
  if (dataRequest && request.method === 'POST') {
   const file = await donorFile(c, decodeURIComponent(dataRequest[1]), isApi ? await jsonBody(request) : Object.fromEntries(await formBody(request)))
   return new Response(JSON.stringify(file, null, 1), { headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="coffer-donor-file-${file.request.requestedOn}.json"` } })
  }
  if ((path === '/api/coffer/commands' || path === '/app/actions') && request.method === 'POST') {
   const data = path === '/app/actions' ? await formInput(await formBody(request, 400000)) : await jsonBody(request), command = String(data.command), input = data.input ?? data
   if(!isApi&&command==='appeal.prepare'&&input.insertField==='yes'){
    if(!manager(actor))fail('FORBIDDEN','Only an owner or admin edits an appeal draft.',403)
    const field=String(input.fieldKey),fields=(await publishedTemplateFields(c)).messages.find(m=>m.kind==='appeal')!.fields,target=input.fieldTarget==='subject'?'subject':'body'
    if(!fields.includes(field))fail('TEMPLATE','Choose a published field.',400)
    return page('Appeal draft',await appealsPage(c,{error:'',values:{...input,[target]:String(input[target]??'')+'{{'+field+'}}'}}),actor,200,'/app/appeals')
   }
   if(!isApi&&command==='marketing.fields'&&input.insertField==='yes'){
    if(!manager(actor))fail('FORBIDDEN','Only an owner or admin chooses shared fields.',403)
    const conn=await savedConnection(c);if(!conn)fail('EMAIL_NOT_CONNECTED','Connect email marketing first.',409)
    const field=String(input.fieldKey),allowed=(await publishedTemplateFields(c)).settings.fields
    if(!allowed.includes(field))fail('TEMPLATE','Choose a published field.',400)
    return page('Shared field draft',await profileFieldsPanel(c,conn,String(input.fields??'')+(input.fields?'\n':'')+'{{'+field+'}}'),actor,200,'/app/appeals')
   }
   if(!isApi&&command==='pledgeTemplate.save'&&input.insertField==='yes'){
    if(!manager(actor))fail('FORBIDDEN','Only an owner or admin edits reminder wording.',403)
    const fields=await pledgeTemplateFields(c),field=String(input.fieldKey),target=input.fieldTarget==='subject'?'subject':'body'
    if(!fields.includes(field))fail('TEMPLATE','Choose a published reminder field.',400)
    return page('Pledge reminder draft',await pledgeTemplatePanel(c,{...input,[target]:String(input[target]??'')+'{{'+field+'}}'}),actor,200,'/app/settings')
   }
   if(!isApi&&command==='welcome.publish'&&input.insertField==='yes'){
    if(!manager(actor))fail('FORBIDDEN','Only an owner or admin edits welcome messages.',403)
    if((await welcomeState(c)).activeCount)fail('WELCOME_ACTIVE','Finish active journeys before changing the published messages.')
    const fields=(await publishedTemplateFields(c)).messages.find(m=>m.kind==='welcome')!.fields,field=String(input.fieldKey),target=String(input.fieldTarget)
    if(!fields.includes(field)||!['thankSubject','thankBody','impactSubject','impactBody','askSubject','askBody'].includes(target))fail('TEMPLATE','Choose a published field and welcome message.',400)
    return page('Welcome template draft',await welcomePanel(c,{...input,[target]:String(input[target]??'')+'{{'+field+'}}'}),actor,200,'/app/appeals')
   }
   if(!isApi&&command==='letterTemplate.save'&&input.insertField==='yes'){
    if(!manager(actor))fail('FORBIDDEN','Only an owner or admin edits templates.',403)
    const catalog=await publishedTemplateFields(c),entry=catalog.templates.find(t=>t.kind===input.kind),field=String(input.fieldKey)
    if(!entry?.fields.includes(field))fail('TEMPLATE','Choose a field supported by this template kind.',400)
    const target=input.fieldTarget==='subject'?'subject':'body',draft={...input,id:input.templateId??null,_draft:!input.templateId,min_cents:Math.round(Number(input.minAmount||0)*100),[target]:String(input[target]??'')+'{{'+field+'}}'}
    return page('Template draft',templateForm(draft,await all(c,'SELECT id,name FROM cf_campaigns ORDER BY name'),entry.fields),actor,200,'/app/settings')
   }
   let result
   try { result = command === 'donor.erase' ? await eraseDonor(c, auth.authority, input) : await execute(c, command, input) }
   catch (error: any) {
    if (!isApi && command.startsWith('giftBatch.') && input.batchId && error instanceof CofferError) return page('Batch gift entry and deposits', `<p role="alert" class="alert">${esc(error.message)}</p>`+await giftBatchesPage(c,new URL('/app/gifts/batches?id='+encodeURIComponent(input.batchId),url)),actor,error.status,'/app/gifts/batches')
    if (!isApi && command === 'appeal.prepare' && error instanceof CofferError && error.code.startsWith('NCOA_')) return page('Addresses', `<p role="alert" class="alert">${esc(error.message)}</p><p><a href="/app/appeals">Return to appeals</a></p>` + (manager(c.actor)?await addressesPage(c):''), actor, error.status, '/app/addresses')
    // A rejected appeal form comes back on its own page with the answers kept.
    if (!isApi && command === 'appeal.prepare' && error instanceof CofferError && error.status === 400) return page('Appeals', await appealsPage(c, { error: error.message, values: input }), actor, 400, '/app/appeals')
    if (!isApi && command==='marketing.connectConstantContact' && error instanceof CofferError) return page('Constant Contact settings', `<p role="alert" class="alert">${esc(error.message)}</p>`+await constantContactPreferencesPanel(c), actor, error.status, '/app/settings')
    if (!isApi && CONNECT.has(command) && error instanceof CofferError) return page('Connect email marketing', await connectPage(c, error.message), actor, error.status ?? 409, '/app/appeals')
    throw error
   }
   if (isApi) return json(result)
   return actionPage(command, input, result, actor, (await settings(c)).timezone)
  }
  const csvExport=await exportsResponse(request,c);if(csvExport)return csvExport
  if (path === '/app/backup' && request.method === 'POST') {
   if (actor.role !== 'owner') fail('owner_required', 'Only the owner can download a backup.', 403)
   await cleanVideoUploads(c)
   await cleanDocumentUploads(c);await purgeDocuments(c)
   const service = await createPortability({ db: env.DB, buckets: { FILES: env.FILES }, policy }), id = await service.exports.create(actor.id)
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
 const aliases = await c.db.prepare("SELECT email FROM cf_donor_aliases WHERE donor_id=? UNION SELECT value AS email FROM cf_contact_points WHERE donor_id=? AND kind='email' UNION SELECT json_extract(snapshot,'$.value') AS email FROM cf_contact_history WHERE donor_id=? AND json_extract(snapshot,'$.kind')='email'").bind(donorId,donorId,donorId).all<{email:string}>()
 const auctionErasure=await auctionErasureStatements(c,donorId,placeholder)
 const nativeErasure = imports.donorErasureStatements({...donor,emails:aliases.results.map(a=>a.email)}, placeholder, c.now,auctionErasure)
 const givingErasure = [
  {sql:'UPDATE cf_single_letters SET donor_id=? WHERE donor_id=?',params:[placeholder,donorId]},
  ...eventRegistrationErasureStatements(donorId,placeholder,[donor.email,...aliases.results.map(a=>a.email)].filter((value):value is string=>Boolean(value))),
  {sql:'DELETE FROM cf_saved_card_consents WHERE donor_id=?',params:[donorId]},
  { sql: "UPDATE cf_in_kind_acknowledgments SET subject='[erased]',body='[erased]' WHERE in_kind_id IN (SELECT id FROM cf_in_kind_gifts WHERE donor_id=?)", params: [donorId] },
  { sql: "UPDATE cf_in_kind_revisions SET snapshot=json_set(snapshot,'$.description','Erased property contribution','$.goods_description',NULL),reason='[erased]' WHERE in_kind_id IN (SELECT id FROM cf_in_kind_gifts WHERE donor_id=?)", params: [donorId] },
  { sql: "UPDATE cf_in_kind_gifts SET donor_id=?,description='Erased property contribution',goods_description=NULL,disposal_evidence=NULL,version=version+1 WHERE donor_id=?", params: [placeholder,donorId] },
  { sql: 'INSERT OR IGNORE INTO cf_erased_stripe_customers(customer_id,donor_id) SELECT customer_id,? FROM cf_giving_customers WHERE donor_id=?', params: [placeholder, donorId] },
  { sql: "INSERT OR IGNORE INTO cf_erased_stripe_customers(customer_id,donor_id) SELECT source_ref,? FROM cf_donors WHERE id=? AND source='stripe' AND source_ref IS NOT NULL", params: [placeholder, donorId] },
  { sql: 'DELETE FROM cf_donor_merges WHERE donor_id=?', params: [donorId] },
  { sql: 'UPDATE cf_pledge_installments SET reminder_subject=NULL,reminder_body=NULL,reminder_template_version=NULL,reminder_merge_blanks=NULL,reminder_merge_checked_at=NULL,recipient_email=NULL,recipient_contact_id=NULL,recipient_contact_version=NULL,message_id=NULL,attempt_id=NULL WHERE pledge_id IN (SELECT id FROM cf_pledges WHERE donor_id=?)', params: [placeholder] },
  { sql: 'DELETE FROM cf_donor_tokens WHERE donor_id=?', params: [donorId] },
  {sql:"DELETE FROM cf_appeal_pieces WHERE EXISTS(SELECT 1 FROM json_each(members) WHERE value=?) OR EXISTS(SELECT 1 FROM json_each(snapshot,'$.gifts') g WHERE json_extract(g.value,'$.donorId')=?)",params:[donorId,donorId]},
  {sql:'DELETE FROM cf_donor_tags WHERE donor_id=?',params:[donorId]},
  {sql:"DELETE FROM cf_ack_mail_pieces WHERE EXISTS(SELECT 1 FROM json_each(members) WHERE value=?)",params:[donorId]},
  {sql:"UPDATE cf_list_bulk_jobs SET reason='' WHERE id IN(SELECT job_id FROM cf_list_bulk_rows WHERE donor_id=?)",params:[donorId]},
  {sql:'DELETE FROM cf_list_bulk_rows WHERE donor_id=?',params:[donorId]},
  {sql:'DELETE FROM cf_custom_value_history WHERE donor_id=?',params:[donorId]},
  {sql:'DELETE FROM cf_custom_values WHERE donor_id=?',params:[donorId]},
  { sql: 'DELETE FROM cf_giving_customers WHERE donor_id=?', params: [donorId] },
  { sql: "UPDATE cf_giving_intents SET donor_id=?,name='Erased donor',email='',customer_id=NULL WHERE donor_id=? OR email=?", params: [placeholder, donorId, donor.email ?? ''] },
  { sql: "UPDATE cf_subscriptions SET donor_id=?,customer_id='' WHERE donor_id=?", params: [placeholder, donorId] },
 ]
 // The placeholder must exist before its references move; delete the old donor last.
 const nativeStatements = [...apiErasureStatements(donorId), ...webhookErasureStatements(donorId), ...nativeErasure.slice(0, -1), ...givingErasure, ...nativeErasure.slice(-1), { sql: "INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) VALUES(?,?,?,?,'donor.erase','donor',?,?,?)", params: [c.now, c.actor.id, c.actor.name, c.actor.role, placeholder, placeholder, JSON.stringify({reason})] }]
 const result: any = await imports.erase(c.db, c.actor, donorId, authority, { nativeStatements, checkpoint })
 await purgeDocuments(c)
 return { erased: donorId, donorId: placeholder, receiptId: result.receiptId ?? result.id }
}

const CONNECT = new Set(['marketing.fields','marketing.connectMango', 'marketing.connectMailchimp', 'marketing.chooseAudience', 'marketing.check', 'marketing.disconnect'])
function actionPage(command: string, input: any, result: any, actor: Actor, timeZone: string) {
 if(command==='calendar.start')return page('Connect Google Calendar',`<p>Continue to Google to approve read-only access to your primary calendar.</p><p><a href="${esc(result.authorizeUrl)}" rel="noreferrer">Continue to Google</a></p><p><a href="/app/settings#calendar-settings">Back to Settings</a></p>`,actor,200,'/app/settings')
 if(command==='calendar.configure'||command==='calendar.disconnect'||command==='booking.configure'||command==='booking.disconnect')return redirect('/app/settings#calendar-settings')
 if(command==='calendar.log'||command==='booking.link'||command==='booking.revoke')return redirect('/app/donors/'+encodeURIComponent(input.donorId)+'#meetings')
 if(command.startsWith('auction.'))return redirect('/app/events/'+encodeURIComponent(result.eventId)+'/auctions?jobId='+encodeURIComponent(result.jobId))
 if(command.startsWith('giving.'))return redirect('/app/giving/setup?saved=1')
 if(command==='communication.preferences')return redirect('/app/donors/'+encodeURIComponent(input.donorId)+'#communication-preferences')
 if(command==='marketing.connectConstantContact')return redirect('/app/settings#constant-contact-sender')
 if(command.startsWith('marketing.constantContact')||command==='marketing.topicMapping')return redirect('/app/settings#constant-contact-preferences')
 if(command==='pledgeTemplate.save')return redirect('/app/settings?saved=1#pledge-template')
 if(command==='custom.define'||command==='custom.renameChoice'||command==='tag.define'||command==='tag.category')return redirect('/app/settings?saved=1#custom-field-definitions')
 if(command==='custom.set'||command==='custom.clear')return redirect('/app/donors/'+encodeURIComponent(result.donorId)+'?customRecord='+encodeURIComponent(input.recordId)+'#custom-fields')
 if(command==='inKind.review')return page('Property merge review',`<h2>${esc(result.recipientName)}</h2>${result.fields.length?'<p>Empty fields to correct before approval:</p><ul>'+result.fields.map((f:string)=>'<li>'+esc(f)+'</li>').join('')+'</ul>':'<p>No empty merge fields.</p>'}<h3>${esc(result.subject)}</h3><pre>${esc(result.body)}</pre><p><a href="/app/donors/${encodeURIComponent(result.donorId)}#in-kind">Return to the property record</a></p>`,actor,200,'/app/donors')
 if(command==='list.profileUndo'||command==='list.restorePending'||command==='list.undo')return redirect('/app/exports?list=saved:'+encodeURIComponent(result.listId))
 if(command==='list.tasks')return redirect('/app/calls?owner='+encodeURIComponent(input.ownerId))
 if(command==='list.welcome')return redirect('/app/appeals')
 if(command==='contact.save')return redirect('/app/donors/'+encodeURIComponent(result.donorId)+'#contact-points')
 if(command==='list.bulk'||command==='list.profile'||command==='list.solicitation')return page('Bulk list change',`<p>${esc(result.changed)} constituents changed.</p><p><a href="/app/exports?list=saved:${esc(result.listId)}">Return to live list</a></p><form method="post" action="/app/actions"><input type="hidden" name="command" value="${command==='list.bulk'?'list.undo':'list.profileUndo'}"><input type="hidden" name="jobId" value="${esc(result.jobId??result.id)}"><input type="hidden" name="version" value="1"><p>Undo restores records only. Pending tasks and journey work require a separate confirmation afterward.</p><button>Undo this bulk change</button></form>`,actor,200,'/app/exports')
 if(command==='sms.registration.refresh')return redirect('/app/settings#sms-registration')
 if(command.startsWith('sms.'))return redirect(command==='sms.preference'?'/app/donors/'+encodeURIComponent(input.donorId)+'#sms-permission':'/app/texts?runId='+encodeURIComponent(result.id??input.runId))
 if(command.startsWith('address.'))return redirect(input.returnDonorId?'/app/donors/'+encodeURIComponent(input.returnDonorId)+'#address-verification':'/app/addresses')
 if(command==='solicitation.set')return redirect('/app/donors/'+encodeURIComponent(input.donorId)+'#solicitation')
 if(command.startsWith('giftRule.'))return redirect('/app/gift-rules')
 if(command.startsWith('giftBatch.'))return redirect('/app/gifts/batches?id='+encodeURIComponent(result.id))
 if(command==='donor.create' && input.returnBatchId)return redirect('/app/gifts/batches?id='+encodeURIComponent(input.returnBatchId)+'&donor='+encodeURIComponent(result.id))
 if(command==='list.solicitation')return redirect('/app/exports?list=saved:'+encodeURIComponent(result.id))
 if(command==='list.save')return redirect('/app/exports?list=saved:'+encodeURIComponent(result.id))
 if (command === 'donor.merge' || command === 'donor.unmerge') return redirect('/app/audit?record='+encodeURIComponent(result.donorId))
 if (CONNECT.has(command)) return redirect('/app/appeals/connect')
 if(command==='journey.cap')return redirect('/app/settings#journey-frequency')
 if (command.startsWith('journey.') || command.startsWith('welcome.') || command.startsWith('marketing.') || command.startsWith('reply.')) return redirect('/app/appeals')
 if (command.startsWith('fund.')) return redirect('/app/funds/restrictions')
 if(command==='calls.policy')return redirect('/app/settings?saved=1#call-priorities')
 if(command==='calls.rank')return redirect('/app/agent/calls?managerId='+encodeURIComponent(result.run.manager_id)+'&runId='+encodeURIComponent(result.run.id))
 if(command==='task.teamSave'||command==='task.policy')return redirect('/app/settings?saved=1#task-settings')
 if (command.startsWith('task.')) return redirect('/app/calls?owner=&status=' + (command === 'task.complete' ? 'done' : 'active'))
 if (command.startsWith('portfolio.')) return redirect('/app/portfolios')
 if (command.startsWith('research.')) return redirect('/app/research'+(input.returnDonorId?'?donorId='+encodeURIComponent(input.returnDonorId):''))
 if (command.startsWith('event.')) return redirect('/app/events/'+encodeURIComponent(result.eventId??result.id))
 if (command.startsWith('volunteer.')) return redirect(input.returnDonorId?'/app/donors/'+encodeURIComponent(input.returnDonorId)+'#volunteering':'/app/volunteering')
 if (command.startsWith('grant.')) return redirect('/app/grants')
 if (command === 'taxReports.settings') return redirect('/app/reports/tax?'+new URLSearchParams({year:String(input.reportYear??''),basis:String(input.reportBasis??'calendar')}))
 if (command === 'engagement.settings') return redirect('/app/engagement')
 if (command.startsWith('cultivation.') || command.startsWith('proposal.')) return redirect('/app/opportunities/' + encodeURIComponent(result.prospectId ?? input.prospectId))
 if (command.startsWith('prospect.')) return redirect('/app/pipeline')
 if (command === 'agent.create') return page('Agent key created', `<p>Copy this key once into your agent’s private environment. It will not be shown again.</p><pre class="secret">${esc(result.token)}</pre><p>Expires ${esc(when(new Date(result.expiresAt).toISOString(), timeZone))}.</p><p><a href="/app/data">Back to data &amp; access</a></p>`, actor)
 if(command.startsWith('agentGrant.'))return redirect('/app/data#agent-grants')
 if (command === 'agent.revoke') return redirect('/app/data')
 if(command==='apiKey.create')return page('Public API key',apiKeySecretPage(result.token),actor,200,'/app/settings')
 if(command==='apiKey.revoke')return redirect('/app/api-keys')
 if(['webhook.subscribe','webhook.rotate','webhook.recover'].includes(command))return page('Webhook signing key',webhookSecretPage(result.secret),actor,200,'/app/settings')
 if(command.startsWith('webhook.'))return redirect('/app/webhooks')
 if (command.startsWith('reportSchedule.')) return redirect('/app/report-schedules')
 if (command === 'dashboard.goal') return redirect('/app/reports/dashboard?year='+encodeURIComponent(String(input.year))+'#goals')
 if(command==='person.defaultsPreview')return page('Review name defaults',`<p>${result.changed} person records will change. Overrides and prepared documents are preserved.</p>${form('person.defaults','<p>Save these defaults for existing and new people.</p>','Save name defaults',result)}<p><a href="/app/settings">Back to settings</a></p>`,actor)
 if(command==='person.defaults')return redirect('/app/settings?saved=1')
 if (command === 'settings.update') return redirect('/app/settings?saved=1')
 if (command.startsWith('letterTemplate.')) return redirect('/app/settings?saved=1#thank-you-templates')
 if (command === 'donor.create') return redirect(`/app/donors/${result.id}`)
 if(input.returnGiftId)return redirect('/app/gifts?gift='+encodeURIComponent(input.returnGiftId)+'#selected-gift-acknowledgment')
 if (input.returnDonorId) return redirect(`/app/donors/${encodeURIComponent(input.returnDonorId)}`)
 if (command === 'donor.erase') return redirect(`/app/donors/${result.donorId}`)
 if (command === 'consent.record') return redirect(input.returnTo === 'donor' && input.donorIds?.length === 1 ? `/app/donors/${input.donorIds[0]}#consent` : '/app/donors?consent=' + result.recorded)
 if (command.startsWith('singleLetter.')) return redirect('/app/single-letters/'+result.id)
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
 if(url.pathname==='/api/coffer/webhooks')return json(await webhookState(c,url.searchParams.get('before')))
 if(url.pathname==='/api/coffer/auctions')return json(await auctionState(c,url.searchParams.get('eventId')??'',url.searchParams.get('jobId')??undefined))
 if(url.pathname==='/api/coffer/report-schedules')return json(await reportSchedules(c))
 if(url.pathname==='/api/coffer/agent-grants')return json(await agentGrantsState(c))
 if(url.pathname==='/api/coffer/provider-fields'){if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin manages shared provider fields.',403);const conn=await savedConnection(c);return json({provider:conn?.provider??null,version:conn?.mergeVersion??1,fields:conn?.mergeSelection??[]})}
 const members=url.pathname.match(/^\/api\/coffer\/lists\/([^/]+)\/members$/);if(members){if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin reads a saved list.',403);return json({donorIds:(await listMembers(c,decodeURIComponent(members[1]))).ids})}
 if(url.pathname==='/api/coffer/pledge-template'){if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin reads reminder wording.',403);return json(await pledgeTemplate(c))}
 if(url.pathname==='/api/coffer/pledge-reminders/review'){if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin reviews all reminders.',403);return json({recipients:await pledgeMergeReview(c)})}
 if(url.pathname==='/api/coffer/custom-fields'){if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin manages custom fields.',403);return json({fields:await customFields(c)})}
 if(url.pathname==='/api/coffer/lists')return json({lists:await savedLists(c)})
 if(url.pathname==='/api/coffer/template-fields')return json(await publishedTemplateFields(c))
 if(url.pathname==='/api/coffer/meetings')return json(await meetings(c))
 if(url.pathname==='/api/coffer/calendar')return json({...await calendarState(c),booking:await bookingState(c)})
 if(url.pathname==='/api/coffer/calendar/events')return json(await calendarEvents(c,url.searchParams.get('pageToken')??undefined))
 const meeting=url.pathname.match(/^\/api\/coffer\/meetings\/([^/]+)\/brief$/)
 if(meeting)return json(await meetingBrief(c,decodeURIComponent(meeting[1])))
 if (url.pathname === '/api/coffer/recurring-tasks') return json(await recurringTasks(c,url.searchParams.get('owner')))
 if (url.pathname === '/api/coffer/duplicates') return json(await likelyDuplicates(c,{donorId:url.searchParams.get('donorId'),page:Number(url.searchParams.get('page'))||0}))
 if (url.pathname === '/api/coffer/duplicates/compare') return json(await compareDonors(c,url.searchParams.get('source')??'',url.searchParams.get('target')??''))
 if (url.pathname === '/api/coffer/audit') return json(await auditLog(c,url))
 if (url.pathname === '/api/coffer/audit.csv') return download(await auditCsv(c,url),'coffer-audit')
 const path = url.pathname, match = (re: RegExp) => path.match(re)
 if(path==='/api/coffer/reports/honor-roll')return json(await honorRoll(c,url))
 if(path==='/api/coffer/reports/honor-roll.csv')return download(honorRollCsv(await honorRoll(c,url)),'coffer-honor-roll')
 if (/^\/api\/coffer\/households\/[^/]+$/.test(path)) {
  const year=url.searchParams.get('year'),basis=url.searchParams.get('basis')??'calendar'
  if(year!==null&&!/^\d{4}$/.test(year)||!['calendar','fiscal'].includes(basis))fail('INPUT','Choose a four-digit year and calendar or fiscal basis.',400)
  return json(await householdState(c,decodeURIComponent(path.split('/').at(-1)!),{...(year?{year:Number(year)}:{}),basis:basis as 'calendar'|'fiscal'}))
 }
 if(path==='/api/coffer/addresses'){if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin manages address processing.',403);return json(await addressState(c))}
 const addressDonor=path.match(/^\/api\/coffer\/donors\/([^/]+)\/addresses$/);if(addressDonor)return json(await addressState(c,addressDonor[1]))
 if(path==='/api/coffer/sms/registration'){if(!['owner','admin'].includes(c.actor.role))fail('FORBIDDEN','Only an owner or admin reads SMS registration.',403);return json(await smsRegistrationState(c))}
 if(path==='/api/coffer/texts')return json(await smsState(c,url.searchParams.get('runId')??undefined))
 const typedDonor=path.match(/^\/api\/coffer\/donors\/([^/]+)\/contribution-types$/);if(typedDonor)return json(await contributionTypeState(c,typedDonor[1]))
 const smsDonor=path.match(/^\/api\/coffer\/donors\/([^/]+)\/sms$/);if(smsDonor)return json({preference:await smsPreference(c,smsDonor[1])})
 if(path==='/api/coffer/gift-rules')return json(await giftRulesState(c))
 if(path==='/api/coffer/gift-batches')return json(url.searchParams.has('id')?await giftBatch(c,url.searchParams.get('id')!):{batches:await giftBatches(c)})
 if (path === '/api/coffer/donors') return json(await listDonors(c, { q: url.searchParams.get('q'), page: Number(url.searchParams.get('page') ?? 0) || 0, relationship: url.searchParams.get('relationship'), relatedTo: url.searchParams.get('relatedTo'), volunteer:url.searchParams.get('volunteer'), solicitation:url.searchParams.get('solicitation') }))
 const noteMatch=match(/^\/api\/coffer\/notes\/([^/]+)$/)
 if(noteMatch){
  const note=await c.db.prepare('SELECT * FROM cf_donor_notes WHERE id=?').bind(noteMatch[1]).first<any>()
  if(!note)fail('NOT_FOUND','That note does not exist.',404)
  if(note.confidential && !manager(c.actor))fail('FORBIDDEN','Only the owner or an admin reads confidential notes.',403)
  return json(note)
 }
 let m = match(/^\/api\/coffer\/donors\/([^/]+)$/)
 if (m) return json(await donorHistory(c, m[1]))
 if((m=match(/^\/api\/coffer\/donors\/([^/]+)\/preferences$/)))return json(await communicationPreferences(c,m[1]))
 if (path === '/api/coffer/letters') { const due = await dueGifts(c); return json({ today: due.today, held: due.held, thresholdCents: due.settings.threshold_cents, targetDays: due.settings.target_days, due: due.gifts, softCredits:due.softCredits, batches: await batches(c) }) }
 if ((m = match(/^\/api\/coffer\/letters\/([^/]+)$/))) return json(await batchDetail(c, m[1]))
 if ((m = match(/^\/api\/coffer\/letters\/([^/]+)\/letters\.csv$/))) return lettersFile(c, m[1])
 if (path === '/api/coffer/journeys') return json(await journeyState(c))
 if (path === '/api/coffer/welcome') return json(await welcomeState(c))
 if (path === '/api/coffer/marketing/preferences') return json(await preferenceState(c))
 if (path === '/api/coffer/replies') return json(await replyTasks(c))
 if (path === '/api/coffer/appeals') return json({ appeals: await appeals(c) })
 if ((m = match(/^\/api\/coffer\/appeals\/([^/]+)$/))) return json(await appealDetail(c, m[1]))
 if ((m = match(/^\/api\/coffer\/appeals\/([^/]+)\/recipients\.csv$/))) return recipientsFile(c, m[1])
 if (path === '/api/coffer/reports/annual-lapses') return json(await annualLapses(c,url.searchParams.has('year') ? Number(url.searchParams.get('year')) : undefined))
 if (path === '/api/coffer/lapses') return json(await lapses(c))
 if(path==='/api/coffer/task-team')return json(await taskTeam(c))
 if (path === '/api/coffer/tasks') { const candidates = await taskCandidates(c); return json({ tasks: await callTasks(c,url.searchParams.get('owner'),url.searchParams.get('status')), owners: await taskOwners(c), sources: candidates.sources, excluded: candidates.excluded, notices:await taskNotices(c,url.searchParams.get('owner')||c.actor.id), policy:await taskPolicy(c) }) }
 if (path === '/api/coffer/status-notices') return json({ notices: await statusNotices(c) })
 if (path === '/api/coffer/retention') return json(await retention(c,url))
 if (path === '/api/coffer/portfolios') return json(await portfolioReport(c,url))
 const cultivation = path.match(/^\/api\/coffer\/opportunities\/([^/]+)$/)
 if(cultivation) return json(await cultivationState(c,cultivation[1]))
 const attachment=path.match(/^\/api\/coffer\/proposals\/([^/]+)\/download$/)
 if(attachment) return proposalDownload(c,attachment[1])
 if (path === '/api/coffer/reports/tax') return json(await taxReport(c,url))
 if (path === '/api/coffer/research') return json(await researchState(c,url.searchParams.get('donorId')??undefined))
 if(path==='/api/coffer/events'){requireRole(c.actor,['owner','admin'],'manage fundraising events');return json(url.searchParams.get('eventId')?await eventGuests(c,url.searchParams.get('eventId')!):await fundraisingEvents(c))}
 if (path === '/api/coffer/volunteering') return json(await volunteering(c,url.searchParams.get('donorId')??undefined,url.searchParams.get('year')||undefined))
 if (path === '/api/coffer/volunteering.csv') return download(await volunteerCsv(c,url.searchParams.get('year')||undefined),'coffer-volunteering')
 if (path === '/api/coffer/in-kind') return json(await inKindState(c,url.searchParams.get('donorId')??undefined))
 const propertyAck=path.match(/^\/api\/coffer\/in-kind-acknowledgments\/([^/]+)\/download$/)
 if(propertyAck) return inKindAcknowledgment(c,propertyAck[1])
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
 if (path === '/api/coffer/reports/custom-fields')return json(await customReport(c,url))
 if (path === '/api/coffer/reports/custom-fields.csv')return download(customReportCsv(await customReport(c,url)),'coffer-custom-gifts')
 if (path === '/api/coffer/reports/funds') return json(await fundReport(c,url))
 if (path === '/api/coffer/reports/states') return json(await stateReport(c,url))
 if (path === '/api/coffer/reports/dashboard') return json(await dashboardReport(c,url))
 if (path === '/api/coffer/reports/dashboard/entries') return json(await dashboardEntries(c,url))
 if (path === '/api/coffer/reports/attribution') return json(await attributionReport(c,url))
 if (path === '/api/coffer/reports/states.csv') return download(stateReportCsv(await stateReport(c,url)),'coffer-giving-by-state')
 if (path === '/api/coffer/settings') return json(await settings(c))
 if (path === '/api/coffer/letter-templates') return json({ templates: await letterTemplates(c) })
 return fail('not_found', 'Not found.', 404)
}
async function lettersFile(c: Context, batchId: string) {
 if (!manager(c.actor)) fail('manager_required', 'Only the owner or an admin downloads letters.', 403)
 const { batch } = await batchDetail(c, batchId)
 if (!['exported', 'sent'].includes(batch.status)) fail('NOT_EXPORTED', 'Export the approved letters first.')
 return download(lettersCsv(await batchLetters(c, batchId),await ackMailPieces(c,batchId)), `coffer-letters-${batch.prepared_at.slice(0, 10)}`)
}
async function recipientsFile(c: Context, appealId: string) {
 if (!manager(c.actor)) fail('manager_required', 'Only the owner or an admin downloads an audience.', 403)
 const { appeal } = await appealDetail(c, appealId)
 if (!['exported', 'sent'].includes(appeal.status)) fail('NOT_EXPORTED', 'Export the approved audience first.')
 return download(recipientsCsv(appeal, await recipientsOf(c, appealId),await appealPieces(c,appealId)), `coffer-appeal-${appeal.prepared_at.slice(0, 10)}`)
}

async function screen(c: Context, url: URL, request: Request): Promise<Response> {
 const path = url.pathname, actor = c.actor
 if (!person(actor)) fail('person_required', 'Agent keys use the /api/coffer endpoints.', 403)
 const show = (title: string, body: string) => page(title, body, actor, 200, path)
 if(path==='/app/api-keys')return show('Public API keys',await apiKeysPage(c))
 if(path==='/app/webhooks')return show('Webhooks',await webhookPage(c,url.searchParams.get('before')))
 if(path==='/app/report-schedules')return show('Scheduled reports',await reportSchedulesPage(c,url))
 if(path==='/app/reports/custom-fields')return show('Gift custom fields',await customReportPage(c,url))
 if(path==='/app/reports/custom-fields.csv')return download(customReportCsv(await customReport(c,url)),'coffer-custom-gifts')
 if(path==='/app/addresses')return show('Addresses',await addressesPage(c))
 if(path==='/app/gift-rules')return show('Gift rules',await giftRulesPage(c))
 if(path==='/app/texts')return show('Text messages',await textsPage(c,url.searchParams.get('runId')??undefined))
 if(path==='/app/gifts/batches')return show('Batch gift entry and deposits',await giftBatchesPage(c,url))
 if(path==='/app/exports')return show('Export donor records',await exportsPage(c,url))
 if (path === '/app/duplicates') return show('Possible duplicates',await duplicatesPage(c,url))
 if (path === '/app/duplicates/compare') return show('Compare donor records',await comparePage(c,url))
 if (path === '/app/audit') return show('Audit log',await auditPage(c,url))
 if (path === '/app/audit.csv') return download(await auditCsv(c,url),'coffer-audit')
 if (path === '/app/giving/health') return show('Recurring giving health',await recurringHealthPage(c,url))
 if (path === '/app/funds/restrictions') return show('Restricted funds',await restrictedFundsPage(c,url))
 if (path === '/app/funds') return show('Giving by fund',await fundReportPage(c,url))
 if (path === '/app/reports/states') return show('Giving by state',await stateReportPage(c,url))
 if (path === '/app/gifts/attribution') return show('Gift attribution',await attributionPage(c,url))
 if (path === '/app/reports/states.csv') return download(stateReportCsv(await stateReport(c,url)),'coffer-giving-by-state')
 if (path === '/app/funds/ledger.csv') {
  if (!manager(actor)) fail('manager_required','Only the owner or an admin exports accounting entries.',403)
  return download(fundLedgerCsv(await fundEntries(c,url,null)),'coffer-fund-ledger')
 }
 if (path === '/app/calls') return show('Call list', await callTasksPage(c,url))
 if (path === '/app/lapses') return url.searchParams.has('annual') ? show('LYBUNT and SYBUNT',await annualLapsesPage(c,url)) : show('Donors who need a call', await lapsesPage(c,url))
 if(path==='/app/reports/honor-roll') {if(!manager(actor))fail('FORBIDDEN','Only the owner or an admin reads honor rolls.',403);return show('Honor roll',await honorRollPage(c,url))}
 if(path==='/app/reports/honor-roll.csv')return download(honorRollCsv(await honorRoll(c,honorRollUrl(url))),'coffer-honor-roll')
 if (path === '/app/reports/tax') return show('Form 990 support',await taxReportsPage(c,url))
 if (path === '/app/retention') return show('Donor retention', await retentionPage(c,url))
 if (path === '/app/portfolios') return show('Portfolios and moves',await portfoliosPage(c,url))
 const cultivation = path.match(/^\/app\/opportunities\/([^/]+)$/)
 if(cultivation) return show('Action plan and proposals',await cultivationPage(c,cultivation[1]))
 if (path === '/app/research') return show('Prospect research',await researchPage(c,url.searchParams.get('donorId')??undefined))
 const auctionPath=path.match(/^\/app\/events\/([^/]+)\/auctions$/)
 if(auctionPath)return show('Auction results',await auctionPage(c,decodeURIComponent(auctionPath[1]),url.searchParams.get('jobId')??undefined,{q:url.searchParams.get('q')??undefined,rowId:url.searchParams.get('matchRow')??undefined}))
 if(path==='/app/events'||/^\/app\/events\/[^/]+$/.test(path)){requireRole(c.actor,['owner','admin'],'manage fundraising events');return show('Fundraising events',await eventsPage(c,path==='/app/events'?undefined:decodeURIComponent(path.split('/').at(-1)!),{q:url.searchParams.get('q')??undefined,registrationId:url.searchParams.get('matchGuest')??undefined}))}
 if (path === '/app/volunteering') return show('Volunteer history',await volunteeringPage(c,url))
 if (path === '/app/grants') return show('Foundation and corporate grants',await grantsPage(c,url.searchParams.get('donorId')??undefined))
 if (path === '/app/engagement') return show('Engagement scores',await engagementPage(c))
 if (path === '/app/pipeline') return show('Major-gift pipeline', await majorGiftsPage(c,url))
 if (path === '/app/reports/dashboard') return show('Fundraising dashboard', await dashboardPage(c,url))
 if (path === '/app') return show('Today', await home(c,url))
 if (path === '/app/giving') return givingManageResponse(c)
 if (path === '/app/giving/setup') return show('Connect Stripe', await givingSetupPage(c))
 if (path === '/app/gifts') return page('Gifts', await giftsPage(c, url), actor, 200, path, { hideTitle: true })
 if (path === '/app/donors') return show('Donors', await donorsPage(c, url))
 const briefPath=path.match(/^\/app\/meetings\/([^/]+)\/brief$/)
 if(briefPath)return printMeetingBrief(await meetingBrief(c,decodeURIComponent(briefPath[1])))
 const invoicePath=path.match(/^\/app\/pledges\/([^/]+)\/invoice$/)
 if(invoicePath)return printPledgeInvoice(await pledgeInvoice(c,decodeURIComponent(invoicePath[1])))
 let m = path.match(/^\/app\/donors\/([^/]+)$/)
 if (m) { const view = await donorPage(c, m[1], url); return show(view.title, view.body) }
 if (path === '/app/letters') return show('Acknowledgement letters', await lettersPage(c))
 if ((m = path.match(/^\/app\/letters\/([^/]+)$/))) return show('Letter batch', await batchPage(c, m[1]))
 if ((m=path.match(/^\/app\/single-letters\/([^/]+)(?:\/(print|letters\.pdf|merge\.zip|merge\.docx))?$/))) {
  if(!manager(actor))fail('FORBIDDEN','Only the owner or an admin produces letters.',403)
  const letter=await singleLetter(c,m[1],Boolean(m[2])),organisation=(await settings(c)).organisation
  if(!m[2])return show('Single letter',singleLetterPage(letter,organisation))
  return letterOutput([letter],organisation,m[2],url)
 }
 if ((m = path.match(/^\/app\/letters\/([^/]+)\/(print|letters\.pdf|merge\.zip|merge\.docx)$/))) {
  if (!manager(actor)) fail('manager_required', 'Only the owner or an admin prints letters.', 403)
  const { batch, letters } = await batchDetail(c, m[1])
  if (!['approved','exported','sent'].includes(batch.status)) fail('NOT_APPROVED', 'Approve these letters before printing.')
  if(batch.status==='approved')await commit(c,[ackMailPieceGuard(batch.id)])
  if (!(await c.db.prepare(`SELECT CASE WHEN (${currentLetterGiftsCondition}) THEN 1 ELSE 0 END AS ok`).bind(m[1]).first<{ok:number}>())?.ok) fail('GIFT_CHANGED', 'A statement gift changed. Prepare an updated statement before printing.')
  const selected = letters.filter(l => (!url.searchParams.has('letter') || l.id === url.searchParams.get('letter')) && (!url.searchParams.has('pending') || (l.route === 'print' && !l.printed_at)))
  const pieces=!url.searchParams.has('letter')?await ackMailPieces(c,m[1]):[]
  return letterOutput(pieces.length?printableAckPieces(pieces,selected):selected,(await settings(c)).organisation,m[2],url)
 }
 if ((m = path.match(/^\/app\/letters\/([^/]+)\/letters\.csv$/))) return lettersFile(c, m[1])
 if (path === '/app/appeals') return show('Appeals', await appealsPage(c, null, url))
 if (path === '/app/appeals/connect') return show('Connect email marketing', await connectPage(c))
 if ((m = path.match(/^\/app\/appeals\/([^/]+)$/))) return show('Appeal', await appealPage(c, m[1]))
 if ((m = path.match(/^\/app\/appeals\/([^/]+)\/recipients\.csv$/))) return recipientsFile(c, m[1])
 if (path === '/app/more') return show('More', morePage(actor))
 if(path==='/app/calendar')return show('Your calendar',await calendarPage(c,url))
 if (path === '/app/settings') return show('Letter settings', await settingsPage(c, url.searchParams.has('saved'))+await constantContactPreferencesPanel(c)+await journeySettingsPanel(c)+await calendarSettingsPanel(c)+await smsRegistrationPanel(c))
 if (path === '/app/data') {
  if (!manager(actor)) fail('manager_required', 'Only the owner or an admin manages data and access.', 403)
  return show('Data & access', dataPage(actor, (await c.db.prepare('SELECT id,label,expires_at,revoked_at FROM cf_agent_keys ORDER BY created_at DESC').all()).results, await people(request, c, c.env!), { local: c.env?.AUTH_LOCAL === 'true', invited: url.searchParams.get('invited'), now: Date.parse(c.now), timeZone: (await settings(c)).timezone }) + await agentGrantsPanel(c))
 }
 if (path === '/app/move-in') { if (!manager(actor)) fail('manager_required', 'Only the owner or an admin moves records in.', 403); return show('Move in from Stripe', moveInPage(await imports.jobs(c.db as any), today((await settings(c)).timezone, new Date(c.now)), stripeAvailable(c.env!))) }
 if (path === '/app/backup') fail('post_required', 'Use the backup button.', 405)
 return page('Page not found', '<p>There is nothing at this address.</p><p><a href="/app">Back to today</a></p>', actor, 404, path)
}

function letterOutput(letters:Row[],organisation:string,format:string,url:URL):Response|Promise<Response>{
 if(format==='letters.pdf')return lettersPdfResponse(letters,organisation,'coffer-letters.pdf',url.searchParams.has('labels')?'labels':url.searchParams.has('envelopes')?'envelopes':'letters')
 if(format==='merge.zip')return mergePackageResponse(letters,organisation)
 if(format==='merge.docx')return mergeDocxResponse(letters,organisation)
 return printLetters(letters,organisation,url.searchParams.get('labels')==='1',url.searchParams.get('envelopes')==='1')
}

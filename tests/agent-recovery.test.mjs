import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import {fixedNow} from './fixed-clock.mjs'
import { run, donor, archive, restore } from './harness.mjs'

const secret = randomBytes(32).toString('hex')
const form = (values, as = '') => ({ method: 'POST', as, headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: new URLSearchParams(values).toString() })

// Inspect values and embedded JSON, so opaque IDs, checksums and legitimate
// postal codes containing the same digits cannot masquerade as card storage.
function assertNoCardLastFour(value) {
 if (typeof value === 'string') {
  assert.notEqual(value, '4242', 'Provider card last four are never persisted as a value')
  let parsed
  try { parsed = JSON.parse(value) } catch {}
  if (parsed !== undefined) assertNoCardLastFour(parsed)
 } else if (Array.isArray(value)) {
  value.forEach(assertNoCardLastFour)
 } else if (value !== null && typeof value === 'object') {
  for (const [key, stored] of Object.entries(value)) {
   assert.doesNotMatch(key, /^(?:last_?4|lastFour)$/i, 'Provider card last-four fields are never persisted')
   assertNoCardLastFour(stored)
  }
 } else assert.notEqual(value, 4242, 'Provider card last four are never persisted as a number')
}

// Stripe and mail are the only fake boundaries. Operator authentication, donor
// portal, webhook processing, scheduled reconciliation and ledger run unchanged.
test('GIVE-006 / GIVE-003: each recurring cadence recovers on Stripe retries, escalates exhausted invoices and warns about expiring cards once', async t => {
 t.mock.timers.enable({apis:['Date'],now:Date.parse(fixedNow)})
 for(const frequency of ['monthly','quarterly','annually']) {
 const state = { intent: null, attempt: 1, paid: false, canceled: false, cardUpdated: false, paymentMethod: null, expiryOffset: 2, calls: [], invoiceId: 'in_recovery' }
 const second={intent:null,invoiceId:'in_lapsed',canceled:false}
 const subscription = () => ({ id: 'sub_recovery', customer: 'cus_recovery', metadata: { coffer_intent: state.intent }, status: state.canceled ? 'canceled' : state.paid ? 'active' : 'past_due', cancel_at_period_end: false, items: { data: [{ quantity:1,price: { unit_amount: 2500,recurring:{interval:frequency==='annually'?'year':'month',interval_count:frequency==='quarterly'?3:1} } }] }, latest_invoice: state.invoiceId, default_payment_method: state.paymentMethod })
 const invoice = () => ({ id: state.invoiceId, customer: 'cus_recovery', currency: 'usd', parent: { subscription_details: { subscription: 'sub_recovery' } }, status: state.paid ? 'paid' : 'open', amount_paid: state.paid ? 2500 : 0, attempt_count: state.attempt, next_payment_attempt: state.paid ? null : 1800000000, status_transitions: { paid_at: state.paid ? Math.floor(Date.now() / 1000) : null } })
 const outbound = async request => {
  const url = new URL(request.url), data = new URLSearchParams(await request.text())
  state.calls.push([request.method, url.pathname])
  assert.equal(url.hostname, 'api.stripe.com')
  if (url.pathname === '/v1/customers' && request.method === 'POST') return Response.json({ id: data.get('email')==='nico.second@example.org'?'cus_second':'cus_recovery' })
  if (url.pathname === '/v1/checkout/sessions' && request.method === 'POST') {
   if(data.get('customer')==='cus_second'){second.intent=data.get('subscription_data[metadata][coffer_intent]');return Response.json({id:'cs_second',url:'https://checkout.stripe.com/c/pay/cs_second'})}
   state.intent = data.get('subscription_data[metadata][coffer_intent]')
   assert.ok(state.intent)
   return Response.json({ id: 'cs_recovery', url: 'https://checkout.stripe.com/c/pay/cs_recovery' })
  }
  if(url.pathname==='/v1/subscriptions/sub_second')return Response.json({id:'sub_second',customer:'cus_second',metadata:{coffer_intent:second.intent},status:second.canceled?'canceled':'past_due',cancel_at_period_end:false,items:{data:[{quantity:1,price:{unit_amount:2500,recurring:{interval:frequency==='annually'?'year':'month',interval_count:frequency==='quarterly'?3:1}}}]},latest_invoice:second.invoiceId,default_payment_method:null})
  if(url.pathname==='/v1/invoices/'+second.invoiceId)return Response.json({id:second.invoiceId,customer:'cus_second',currency:'usd',parent:{subscription_details:{subscription:'sub_second'}},status:'open',amount_paid:0,attempt_count:4,next_payment_attempt:second.canceled?null:1800000000})
  if(url.pathname==='/v1/customers/cus_second')return Response.json({id:'cus_second',invoice_settings:{default_payment_method:null}})
  if (url.pathname === '/v1/customers/cus_recovery' && request.method === 'GET') return Response.json({id:'cus_recovery',invoice_settings:{default_payment_method:null}})
  if (url.pathname === '/v1/payment_methods/'+state.paymentMethod && request.method === 'GET') {
   const date=new Date(),expiry=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+state.expiryOffset,1))
   return Response.json({id:state.paymentMethod,customer:'cus_recovery',type:'card',card:{exp_year:expiry.getUTCFullYear(),exp_month:expiry.getUTCMonth()+1,last4:'4242'}})
  }
  if (url.pathname === '/v1/subscriptions/sub_recovery' && request.method === 'GET') return Response.json(subscription())
  if (url.pathname === '/v1/invoices/' + state.invoiceId && request.method === 'GET') return Response.json(invoice())
  if (url.pathname === '/v1/billing_portal/configurations' && request.method === 'POST') {
   assert.equal(data.get('features[payment_method_update][enabled]'), 'true')
   return Response.json({ id: 'bpc_recovery' })
  }
  if (url.pathname === '/v1/billing_portal/sessions' && request.method === 'POST') {
   assert.equal(data.get('customer'), 'cus_recovery')
   assert.equal(data.get('flow_data[type]'), 'payment_method_update')
   state.cardUpdated = true
   return Response.json({ url: 'https://billing.stripe.com/p/session/card-update' })
  }
  assert.fail(`Unexpected network request ${request.method} ${url.pathname}`)
 }
 await run(async h => {
  const person = await donor(h, 'Rae Recovery', {city:'Henderson',region:'KY',postalCode:'42420'})
  await h.command('solicitation.set',{donorId:person.id,version:0,type:'stop',startsOn:new Date().toISOString().slice(0,10)})
  await h.api('/api/coffer/giving/campaigns', { name: 'Monthly reading', slug: 'monthly-reading', description: 'Reading for all.', fund: 'Reading', goal: '1000.00' })
  const checkout = await h.request('/give/monthly-reading/checkout', form({ name: 'Rae Recovery', email: 'rae.recovery@example.org', amount: '25.00', frequency,'cf-turnstile-response':'synthetic-coffer-security-token', requestId: randomUUID() }))
  assert.equal(checkout.status, 303, await checkout.text())
  const deliver = async (id, type, invoiceId=state.invoiceId) => {
   const timestamp = Math.floor(Date.now() / 1000), body = JSON.stringify({ id, type, data: { object: { id: invoiceId } } })
   const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
   const response = await h.mf.dispatchFetch(h.origin + '/api/coffer/giving/webhook', { method: 'POST', headers: { host: new URL(h.origin).host, 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` }, body })
   assert.equal(response.status, 200, await response.text())
  }
  const recovery = async () => (await h.get('/api/coffer/agent')).recovery
  await Promise.all([deliver('evt_failure_a', 'invoice.payment_failed'), deliver('evt_failure_b', 'invoice.payment_failed')])
  await deliver('evt_failure_a', 'invoice.payment_failed')
  assert.equal(h.messages.length, 1, 'Concurrent events claim one card-update invitation per invoice')
  let data = await recovery()
  assert.equal(data.rows.length, 1)
  assert.equal(data.rows[0].state, 'waiting')
  assert.equal(data.rows[0].notice_state, 'sent')
  assert.equal(data.rows[0].next_attempt_at, 1800000000)
  assert.equal((await h.get(`/api/coffer/donors/${person.id}`)).gifts.length, 0)
  const noSession = await h.request('/api/coffer/agent/recovery/run', { method: 'POST', body: {}, as: '' })
  assert.equal(noSession.status, 401)
  await h.api('/api/coffer/agent/recovery/action', { action: 'pause', why: 'Pause while reviewing provider configuration.' })
  const beforePause = state.calls.length
  const paused = await h.api('/api/coffer/agent/recovery/run', {})
  assert.equal(paused.enabled, false)
  assert.equal(state.calls.length, beforePause, 'A paused schedule makes no provider requests')
  await h.api('/api/coffer/agent/recovery/action', { action: 'resume', why: 'Provider configuration reviewed.' })
  state.attempt = 2
  await h.api('/api/coffer/agent/recovery/run', {})
  data = await recovery()
  assert.equal(data.rows[0].attempt_count, 2)
  assert.equal(h.messages.length, 1, 'Daily/manual reconciliation never repeats the invitation')
  const link = new URL(h.messages[0].text.match(/https?:\/\/[^\s<>]+\/giving\/portal\/confirm\?token=[a-f0-9]+/)[0])
  const confirmed = await h.request('/giving/portal/confirm', form({ token: link.searchParams.get('token') }))
  assert.equal(confirmed.status, 303)
  const donorCookie = confirmed.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const card = await h.request('/giving/portal/card', form({ subscription: 'sub_recovery' }, donorCookie))
  assert.equal(card.status, 303, await card.text())
  assert.equal(new URL(card.headers.get('location')).hostname, 'billing.stripe.com')
  assert.equal(state.cardUpdated, true)
  state.paid = true; state.attempt = 3
  // Simulate a missed payment-success webhook: daily/manual reconciliation must
  // recover the real ledger through the existing invoice path.
  const recovered = await h.api('/api/coffer/agent/recovery/run', {})
  assert.equal(recovered.checked, 1)
  data = await recovery()
  assert.equal(data.rows[0].state, 'recovered')
  assert.equal(data.rows[0].attempt_count,3,'Recovery records the original attempt and two retries')
  assert.equal(data.rows[0].next_attempt_at, null)
  await deliver('evt_paid', 'invoice.paid')
  await deliver('evt_late_failure', 'invoice.payment_failed')
  const history = await h.get(`/api/coffer/donors/${person.id}`)
  assert.equal(history.gifts.length, 1)
  assert.equal(history.gifts[0].reference, 'in_recovery')
  assert.equal(history.gifts[0].amount_cents, 2500)
  assert.equal(history.subscriptions[0].recovered, 1)
  assert.equal(h.messages.length, 1)
  assert.equal(state.calls.some(([method, path]) => method === 'POST' && /invoices\/.*\/pay|payment_intents/.test(path)), false, 'Recovery never charges independently of Stripe retry settings')
  const activity = (await h.get('/api/coffer/agent')).activity
  assert.ok(activity.some(row => row.kind === 'recovery.recovered' && row.subject_id === 'in_recovery' && row.why))
  const pause = activity.find(row => row.kind === 'recovery.pause')
  assert.ok(pause.actor_id && pause.why && pause.undo_kind)
  const secondPerson=await donor(h,'Nico Second')
  assert.equal((await h.request('/give/monthly-reading/checkout',form({name:'Nico Second',email:'nico.second@example.org',amount:'25.00',frequency,'cf-turnstile-response':'synthetic-coffer-security-token',requestId:randomUUID()}))).status,303)
  await deliver('evt_second_failure','invoice.payment_failed',second.invoiceId)
  await h.api('/api/coffer/agent/recovery/run', {})
  data = await recovery()
  assert.equal(data.rows.find(row => row.invoice_id === 'in_lapsed').state, 'waiting')
  assert.equal(h.messages.length, 2, 'A new failed invoice has its own single invitation')
  second.canceled = true
  await h.api('/api/coffer/agent/recovery/run', {})
  data = await recovery()
  assert.equal(data.rows.find(row => row.invoice_id === 'in_lapsed').state, 'lapsed')
  assert.equal(data.rows.find(row => row.invoice_id === 'in_lapsed').next_attempt_at, null)
  assert.equal((await h.get(`/api/coffer/donors/${person.id}`)).gifts.length, 1, 'An exhausted/canceled plan creates no extra gift')
  assert.equal(h.messages.length, 2)
  const owner=(await h.get('/auth/session')).operator
  let tasks=(await h.get('/api/coffer/tasks')).tasks
  const fallback=tasks.find(t=>t.source_key==='recovery:in_lapsed')
  assert.equal(fallback.owner_id,owner.id,'No relationship manager falls back to the owner')
  assert.equal(fallback.donor_id,secondPerson.id)
  const manager=await h.person('recovery.manager@example.test')
  const portfolio=await h.command('portfolio.save',{name:'Monthly supporter care',managerId:manager.id,untouchedDays:30})
  await h.command('portfolio.assign',{donorId:secondPerson.id,portfolioId:portfolio.id})
  second.invoiceId='in_managed_lapse';second.canceled=false
  await deliver('evt_managed_failure','invoice.payment_failed',second.invoiceId)
  second.canceled=true
  await Promise.all([deliver('evt_managed_exhausted_a','invoice.updated',second.invoiceId),deliver('evt_managed_exhausted_b','invoice.updated',second.invoiceId)])
  tasks=(await h.get('/api/coffer/tasks')).tasks
  const managed=tasks.filter(t=>t.source_key==='recovery:in_managed_lapse')
  assert.equal(managed.length,1,'Concurrent exhausted outcomes create one ordinary task per invoice')
  assert.equal(managed[0].owner_id,manager.id,'The current portfolio relationship manager owns follow-up')
  assert.equal(managed[0].status,'open')
  assert.ok((await h.get('/api/coffer/audit?action=recovery.task_created')).rows.some(row=>row.subject_id===managed[0].id))
  // Restore the active provider plan and use its real default method, without
  // retaining the network edge's last four digits or other card details.
  state.canceled=false;state.paid=true;state.invoiceId='in_recovery';state.paymentMethod='pm_recovery_expiry'
  await deliver('evt_active_again','invoice.paid')
  const portalMessages=()=>h.messages.filter(m=>m.text.includes('/giving/portal/confirm?'))
  const beforeExpiry=portalMessages().length
  await h.api('/api/coffer/agent/recovery/run',{})
  assert.equal(portalMessages().length,beforeExpiry,'A card two calendar months away sends no warning')
  state.expiryOffset=1
  await Promise.all([h.api('/api/coffer/agent/recovery/run',{}),h.api('/api/coffer/agent/recovery/run',{})])
  assert.equal(portalMessages().length,beforeExpiry+1,'Concurrent checks claim one expiry warning')
  assert.match(portalMessages().at(-1).subject,/expires next month/)
  assert.equal((await recovery()).expiryNotices[0].state,'sent')
  await h.api('/api/coffer/agent/recovery/run',{})
  assert.equal(portalMessages().length,beforeExpiry+1,'Repeated reconciliation never resends the warning')
  const portable=await archive(h)
  assertNoCardLastFour(portable)
  await run(async fresh=>{await restore(fresh,portable);assert.deepEqual((await fresh.get('/api/coffer/agent')).recovery.expiryNotices,(await recovery()).expiryNotices)})
  if(process.env.COFFER_RECOVERY_BROWSER){const {recoveryBrowser}=await import('./recovery-browser.mjs');await recoveryBrowser(h,{directory:process.env.COFFER_RECOVERY_BROWSER})}
  assert.equal(portalMessages().length,beforeExpiry+1,'Native checks use the same single-attempt claim')
  state.paymentMethod='pm_replacement'
  await h.api('/api/coffer/agent/recovery/run',{})
  assert.ok(!JSON.stringify(await archive(h)).includes('pm_recovery_expiry'),'Replacing a default method deletes its old opaque reference')
  const target=await donor(h,'Rae Separate Record'),comparison=await h.get(`/api/coffer/duplicates/compare?source=${person.id}&target=${target.id}`)
  const merged=await h.command('donor.merge',{sourceDonorId:person.id,donorId:target.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.equal((await recovery()).expiryNotices.length,0,'Merging away deletes the card-expiry metadata')
  assert.ok(!JSON.stringify(await archive(h)).includes('pm_replacement'))
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  await h.api('/api/coffer/agent/recovery/run',{})
  await h.command('donor.erase',{donorId:person.id,confirm:'ERASE'})
  assert.equal((await recovery()).expiryNotices.length,0)
  assert.ok(!JSON.stringify(await archive(h)).includes('pm_replacement'),'Erasure removes the opaque payment-method reference')
 }, {entry:'tests/fixed-clock-worker.ts', bindings: { STRIPE_SECRET_KEY: 'synthetic-coffer-6000', STRIPE_WEBHOOK_SECRET: secret }, outbound })
 }
})

test('DEV-002 / GIVE-003: explicit standing approval and donor permissions govern scheduled notices, named-lead review, real portal stops and recovery attribution',async()=>{
 const {recoveryNoticesJourney}=await import('./recovery-notices-journey.mjs')
 for(const frequency of ['monthly','quarterly','annually'])await recoveryNoticesJourney(frequency)
})

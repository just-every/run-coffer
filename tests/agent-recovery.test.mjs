import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { run, donor } from './harness.mjs'

const secret = 'whsec_recovery_network_edge'
const form = (values, as = '') => ({ method: 'POST', as, headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: new URLSearchParams(values).toString() })

// Stripe and mail are the only fake boundaries. Operator authentication, donor
// portal, webhook processing, scheduled reconciliation and ledger run unchanged.
test('failed monthly gift sends one card link, follows Stripe retries, and recovers after a card update', async () => {
 const state = { intent: null, attempt: 1, paid: false, canceled: false, cardUpdated: false, calls: [], invoiceId: 'in_recovery' }
 const subscription = () => ({ id: 'sub_recovery', customer: 'cus_recovery', metadata: { coffer_intent: state.intent }, status: state.canceled ? 'canceled' : state.paid ? 'active' : 'past_due', cancel_at_period_end: false, items: { data: [{ price: { unit_amount: 2500 } }] }, latest_invoice: state.invoiceId })
 const invoice = () => ({ id: state.invoiceId, customer: 'cus_recovery', currency: 'usd', parent: { subscription_details: { subscription: 'sub_recovery' } }, status: state.paid ? 'paid' : 'open', amount_paid: state.paid ? 2500 : 0, attempt_count: state.attempt, next_payment_attempt: state.paid ? null : 1800000000, status_transitions: { paid_at: state.paid ? Math.floor(Date.now() / 1000) : null } })
 const outbound = async request => {
  const url = new URL(request.url), data = new URLSearchParams(await request.text())
  state.calls.push([request.method, url.pathname])
  assert.equal(url.hostname, 'api.stripe.com')
  if (url.pathname === '/v1/customers' && request.method === 'POST') return Response.json({ id: 'cus_recovery' })
  if (url.pathname === '/v1/checkout/sessions' && request.method === 'POST') {
   state.intent = data.get('subscription_data[metadata][coffer_intent]')
   assert.ok(state.intent)
   return Response.json({ id: 'cs_recovery', url: 'https://checkout.stripe.com/c/pay/cs_recovery' })
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
  const person = await donor(h, 'Rae Recovery')
  await h.api('/api/coffer/giving/campaigns', { name: 'Monthly reading', slug: 'monthly-reading', description: 'Reading for all.', fund: 'Reading', goal: '1000.00' })
  const checkout = await h.request('/give/monthly-reading/checkout', form({ name: 'Rae Recovery', email: 'rae.recovery@example.org', amount: '25.00', frequency: 'monthly', requestId: randomUUID() }))
  assert.equal(checkout.status, 303, await checkout.text())
  const deliver = async (id, type) => {
   const timestamp = Math.floor(Date.now() / 1000), body = JSON.stringify({ id, type, data: { object: { id: state.invoiceId } } })
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
  state.invoiceId = 'in_lapsed'; state.paid = false; state.attempt = 1
  // A missed first-failure webhook must also be discovered on an active plan.
  await h.api('/api/coffer/agent/recovery/run', {})
  data = await recovery()
  assert.equal(data.rows.find(row => row.invoice_id === 'in_lapsed').state, 'waiting')
  assert.equal(h.messages.length, 2, 'A new failed invoice has its own single invitation')
  state.canceled = true
  await h.api('/api/coffer/agent/recovery/run', {})
  data = await recovery()
  assert.equal(data.rows.find(row => row.invoice_id === 'in_lapsed').state, 'lapsed')
  assert.equal(data.rows.find(row => row.invoice_id === 'in_lapsed').next_attempt_at, null)
  assert.equal((await h.get(`/api/coffer/donors/${person.id}`)).gifts.length, 1, 'An exhausted/canceled plan creates no extra gift')
  assert.equal(h.messages.length, 2)
 }, { bindings: { STRIPE_SECRET_KEY: 'sk_test_recovery_edge', STRIPE_WEBHOOK_SECRET: secret }, outbound })
})

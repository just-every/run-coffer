#!/usr/bin/env node
// MANUAL ONLY: inject STRIPE_SECRET_KEY with the parent's private injector,
// then run `node tests/giving-form-live.mjs` in the owned heavy UI and server slot.
// No key arguments, provider mocks, Stripe CLI, screenshots or disk artifacts.
import assert from 'node:assert/strict'
import {createHmac, randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {run, reviewed} from './harness.mjs'
import {givingFormLiveBrowser} from './giving-form-live-browser.mjs'

const objectId = object => typeof object === 'string' ? object : object?.id
const safeCode = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(value) ? value : undefined
const totals = rows => rows.reduce((sum, row) => ({gross_cents: sum.gross_cents + row.gross_cents, fee_cents: sum.fee_cents + row.fee_cents, net_cents: sum.net_cents + row.net_cents}), {gross_cents: 0, fee_cents: 0, net_cents: 0})

export async function givingFormLiveJourney() {
 const sessions = new Map(), customers = new Set(), cleanup = [], gifts = []
 let phase = 'validate-injected-test-key', failure, providerError
 const stage = value => {phase = value}
 const providerRefusal = (status, error) => {providerError = {status, code: safeCode(error?.code), type: safeCode(error?.type), parameter: safeCode(error?.param)}}
 // Never read secret files or print this environment value.
 const key = process.env.STRIPE_SECRET_KEY?.trim()
 const webhookSecret = randomUUID()
 let apiVersion
 const remember = async (response, path, method) => {
  const value = await response.clone().json().catch(() => null)
  if (!response.ok) providerRefusal(response.status, value?.error)
  if (response.ok && method === 'POST' && path === '/v1/customers') customers.add(value.id)
  if (response.ok && method === 'POST' && path === '/v1/checkout/sessions') sessions.set(value.id, {id: value.id, livemode: value.livemode, amount_total: value.amount_total})
  if (response.ok && typeof value?.livemode === 'boolean') assert.equal(value.livemode, false, 'Only test-mode Stripe objects are allowed')
 }
 const send = async (url, options) => {
  assert.equal(new URL(url).origin, 'https://api.stripe.com', 'Only Stripe API outbound is allowed')
  const response = await fetch(url, {...options, redirect: 'manual', signal: AbortSignal.timeout(30000)})
  await remember(response, new URL(url).pathname, options.method ?? 'GET')
  return response
 }
 const stripe = async (path, {method = 'GET', params, idempotency} = {}) => {
  const response = await send('https://api.stripe.com/v1/' + path, {method, headers: {authorization: 'Bearer ' + key, 'Stripe-Version': apiVersion, ...(params ? {'content-type': 'application/x-www-form-urlencoded'} : {}), ...(idempotency ? {'Idempotency-Key': idempotency} : {})}, ...(params ? {body: new URLSearchParams(params)} : {})})
  assert.ok(response.ok, 'Real Stripe API request refused')
  return response.json()
 }
 // Forward the actual Worker request and response unchanged. Only the harness
 // owns mail and Turnstile fakes; this callback never fabricates Stripe data.
 const outbound = async request => {
  const method = request.method
  return send(request.url, {method, headers: Object.fromEntries(request.headers), ...(['GET', 'HEAD'].includes(method) ? {} : {body: await request.arrayBuffer()})})
 }
 const waitFor = async (read, ready, label, milliseconds = 60000) => {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
   const result = await read()
   if (ready(result)) return result
   await delay(1000)
  }
  throw new Error(label)
 }
 try {
  assert.ok(key && /^(?:sk|rk)_test_/.test(key), 'Inject a Stripe test secret key; live keys are refused')
  // Share the app's actual pinned API version without introducing another pin.
  apiVersion = (await readFile('src/coffer/giving/stripe.ts', 'utf8')).match(/STRIPE_API_VERSION\s*=\s*'([^']+)'/)?.[1]
  assert.ok(apiVersion, 'The app declares its Stripe API version')
  await run(async h => {
   stage('prepare-native-fixtures')
   await reviewed(h)
   await h.command('fund.define', {name: 'Tutoring', restriction: 'purpose', detail: 'Neighborhood tutoring'})
   for (const definition of [
    {key: 'reading_interests', label: 'Reading interests', kind: 'constituent', type: 'text', entry: 'pick-many', choices: ['Books', 'Tutoring']},
    {key: 'books', label: 'Books to sponsor', kind: 'gift', type: 'number'},
    {key: 'visit_date', label: 'Visit date', kind: 'gift', type: 'date'},
    {key: 'match_ok', label: 'Employer match available', kind: 'constituent', type: 'checkbox'},
    {key: 'class_year', label: 'Class year', kind: 'constituent', type: 'year'},
    {key: 'budget', label: 'Budget', kind: 'gift', type: 'currency'},
   ]) await h.command('custom.define', definition)
   const campaign = await h.api('/api/coffer/giving/campaigns', {name: 'synthetic-coffer-7001', slug: 'synthetic-coffer-7001', description: 'Keep the reading room open.', fund: 'Reading', goal: '5000', imageBase64: (await readFile('tests/fixtures/campaign-page/story.png')).toString('base64'), imageType: 'image/png', imageDescription: 'Riverbend reading room mark', publicMedia: true, feeCoverEnabled: 'yes', feeCoverRateBps: 290, feeCoverFixedCents: 30})
   campaign.name='synthetic-coffer-7001'
   const waitPaid = id => waitFor(() => stripe('checkout/sessions/' + encodeURIComponent(id)), session => session.status === 'complete' && session.payment_status === 'paid', 'Stripe did not confirm the browser payment')
   const verify = async result => {
    const {session, label, email, date, width, surface} = result
    assert.equal(session.livemode, false)
    assert.equal(session.amount_total, 5000)
    assert.equal(session.currency, 'usd')
    const payment = await stripe('payment_intents/' + encodeURIComponent(objectId(session.payment_intent)))
    assert.equal(payment.status, 'succeeded')
    assert.equal(payment.amount_received, 5000)
    const charge = await waitFor(() => stripe('charges/' + encodeURIComponent(objectId(payment.latest_charge))), charge => Boolean(charge.balance_transaction), 'The paid charge has no balance transaction')
    assert.equal(charge.paid, true)
    assert.equal(charge.amount, 5000)
    const balance = await stripe('balance_transactions/' + encodeURIComponent(objectId(charge.balance_transaction)))
    assert.equal(balance.amount, 5000)
    assert.ok(Number.isSafeInteger(balance.fee) && balance.fee > 0)
    assert.equal(balance.net, balance.amount - balance.fee)
    // Relay a genuine Stripe Event into the local webhook door. The payload
    // comes from Stripe, byte-for-byte; only its local delivery HMAC is ours.
    // paymentEvent then independently fetches charge and balance facts again.
    const events = await waitFor(() => stripe('events?type=charge.succeeded&limit=100&created[gte]=' + (payment.created - 5)), events => events.data.some(event => event.data?.object?.id === charge.id), 'Stripe charge event is not available')
    const eventId = events.data.find(event => event.data?.object?.id === charge.id).id
    const eventResponse = await send('https://api.stripe.com/v1/events/' + encodeURIComponent(eventId), {method: 'GET', headers: {authorization: 'Bearer ' + key, 'Stripe-Version': apiVersion}})
    assert.ok(eventResponse.ok)
    const raw = await eventResponse.text(), timestamp = Math.floor(Date.now() / 1000)
    const signature = createHmac('sha256', webhookSecret).update(timestamp + '.' + raw).digest('hex')
    const delivered = await h.request('/api/coffer/giving/webhook', {method: 'POST', as: '', raw, headers: {'stripe-signature': 't=' + timestamp + ',v1=' + signature}})
    assert.equal(delivered.status, 200, 'The native webhook accepts the real Stripe event')
    const donor = (await h.get('/api/coffer/donors')).donors.find(donor => donor.email === email)
    assert.ok(donor, 'The paid browser gift created a donor')
    const history = await h.get('/api/coffer/donors/' + donor.id)
    assert.equal(history.gifts.length, 1)
    const gift = history.gifts[0]
    assert.equal(gift.amount_cents, 5000)
    assert.equal(gift.reference, payment.id)
    assert.equal(gift.fund, 'Tutoring')
    assert.equal(gift.source, 'stripe')
    assert.deepEqual(history.consents.map(consent => consent.status), ['granted'])
    const captures = await h.get('/api/coffer/giving/campaigns/' + campaign.id + '/responses')
    const capture = captures.responses.find(response => response.gift_id === gift.id)
    assert.ok(capture)
    assert.equal(capture.donor_id, donor.id)
    assert.equal(capture.employer, 'Riverbend Library')
    assert.equal(capture.comment, label)
    assert.deepEqual(Object.fromEntries(capture.answers.map(answer => [answer.key, answer.value])), {reading_interests: ['Books', 'Tutoring'], books: '3', visit_date: date, match_ok: 'false', class_year: '2024', budget: '12575'})
    assert.equal(history.customValues.length, 6)
    assert.equal(history.customValues.find(value => value.field_key === 'budget').record_id, gift.id)
    assert.equal(history.customValues.find(value => value.field_key === 'budget').value, '"12575"')
    assert.equal(history.customValues.find(value => value.field_key === 'reading_interests').record_id, donor.id)
    assert.equal(history.letters.length, 1)
    const receipt = await h.get('/api/coffer/letters/' + history.letters[0].batch_id)
    const letter = receipt.letters.find(letter => letter.donor_id === donor.id)
    assert.ok(letter)
    assert.equal(letter.amount_cents, 5000)
    assert.ok(letter.body.includes('$50.00') && letter.template_kind)
    assert.equal(h.messages.filter(message => JSON.stringify(message.to).includes(email) && message.text?.includes('$50.00')).length, 1)
    const fees = await h.get('/api/coffer/payments/fees')
    const line = fees.lines.find(line => line.id === balance.id)
    assert.ok(line, 'Actual Stripe processing fees were recorded through the webhook')
    assert.equal(line.gift_id, gift.id)
    assert.equal(line.form_id, campaign.id)
    assert.equal(line.campaign_id, campaign.id)
    assert.equal(line.fund, 'Tutoring')
    assert.deepEqual([line.amount_cents, line.fee_cents, line.net_cents], [balance.amount, balance.fee, balance.net])
    const attribution = await h.get('/api/coffer/reports/attribution')
    const expected = (gifts.length + 1) * 5000
    assert.equal(attribution.channel.find(row => row.key === 'form').amountCents, expected)
    assert.equal(attribution.campaign.find(row => row.key === campaign.id).amountCents, expected)
    assert.equal((await h.get('/api/coffer/giving/campaigns/' + campaign.id)).raisedCents, expected)
    const summary = {width, surface, sessionId: session.id, paymentIntentId: payment.id, chargeId: charge.id, balanceTransactionId: balance.id, donorId: donor.id, giftId: gift.id, formId: campaign.id, campaignId: campaign.id, livemode: false, amount_cents: 5000, fee_cents: balance.fee, net_cents: balance.net, outcome: 'paid-and-recorded'}
    gifts.push(summary)
    return summary
   }
   await givingFormLiveBrowser(h, campaign, {sessions, waitPaid, verify, stage, providerRefusal})
   stage('verify-fee-groups')
   const fees = await h.get('/api/coffer/payments/fees')
   const expected = {gross_cents: 20000, fee_cents: gifts.reduce((sum, gift) => sum + gift.fee_cents, 0), net_cents: gifts.reduce((sum, gift) => sum + gift.net_cents, 0)}
   assert.deepEqual(fees.totals, expected)
   for (const groups of [fees.byForm, fees.byCampaign, fees.byFund]) assert.deepEqual(totals(groups), expected)
  }, {bindings: {STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: webhookSecret}, outbound})
 } catch (error) {
  // Playwright errors can contain Checkout URLs and client secrets. Never print an
  // error message, stack, response body, headers, environment or payment URL.
  failure = {stage: phase, name: safeCode(error?.name), provider: providerError}
 } finally {
  // Discover the latest state again, including a payment that succeeded just
  // before a browser or assertion failure. Clean only objects created by this run.
  if (key && apiVersion) {
   for (const {id} of sessions.values()) {
    try {
     const session = await stripe('checkout/sessions/' + encodeURIComponent(id))
     const paymentId = objectId(session.payment_intent)
     if (paymentId) {
      const payment = await stripe('payment_intents/' + encodeURIComponent(paymentId))
      if (payment.status === 'succeeded') {
       const refund = await stripe('refunds', {method: 'POST', params: {payment_intent: paymentId}, idempotency: 'synthetic-coffer-cleanup-' + paymentId})
       assert.equal(refund.status, 'succeeded')
       cleanup.push({sessionId: id, paymentIntentId: paymentId, refundId: refund.id, amount_cents: refund.amount, outcome: 'refunded'})
      }
     }
     if (session.status === 'open') {
      const expired = await stripe('checkout/sessions/' + encodeURIComponent(id) + '/expire', {method: 'POST', params: {}})
      assert.equal(expired.status, 'expired')
      cleanup.push({sessionId: id, outcome: 'expired'})
     }
    } catch {cleanup.push({sessionId: id, outcome: 'cleanup-failed', provider: providerError})}
   }
   for (const id of customers) {
    try {
     const customer = await stripe('customers/' + encodeURIComponent(id), {method: 'DELETE'})
     assert.equal(customer.deleted, true)
     cleanup.push({customerId: id, outcome: 'deleted'})
    } catch {cleanup.push({customerId: id, outcome: 'cleanup-failed', provider: providerError})}
   }
  }
 }
 const ok = !failure && gifts.length === 4 && cleanup.every(item => item.outcome !== 'cleanup-failed')
 return {ok, livemode: false, gifts, cleanup, ...(failure ? {failure} : {})}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const summary = await givingFormLiveJourney()
 console.log(JSON.stringify(summary))
 if (!summary.ok) process.exitCode = 1
}

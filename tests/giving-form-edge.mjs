import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'

// The payment network boundary only. Application state always goes through HTTP.
export function givingFormEdge() {
 const sessions = new Map(), charges = new Map(), entries = []
 let sequence = 0
 const now = Math.floor(Date.now() / 1000)
 const outbound = async request => {
  const url = new URL(request.url), path = url.pathname, params = new URLSearchParams(await request.text())
  assert.equal(url.hostname, 'api.stripe.com')
  if (path === '/v1/customers') return Response.json({id: 'cus_form_' + (++sequence)})
  if (path === '/v1/checkout/sessions') {
   const id = 'cs_form_' + sequence, total = Number(params.get('line_items[0][price_data][unit_amount]'))
   assert.equal(params.get('mode'), 'payment')
   assert.equal(params.get('adaptive_pricing[enabled]'), 'false', 'A gift quoted in USD cannot be converted at payment')
   const intent = params.get('metadata[coffer_intent]'), customer = params.get('customer')
   assert.equal(params.get('payment_intent_data[metadata][coffer_intent]'), intent)
   const session = {id, url: 'https://checkout.stripe.com/c/pay/' + id, metadata: {coffer_intent: intent}, customer, currency: 'usd', amount_total: total, status: 'complete', payment_status: 'paid', payment_intent: 'pi_form_' + sequence}
   sessions.set(id, session)
   const charge = {id: 'ch_form_' + sequence, paid: true, status: 'succeeded', amount: total, currency: 'usd', created: now, metadata: {coffer_intent: intent}, customer, payment_intent: session.payment_intent, balance_transaction: 'txn_form_' + sequence, amount_refunded: 0}
   charges.set(charge.id, charge)
   entries.push({id: charge.balance_transaction, type: 'charge', source: charge.id, amount: total, fee: 179, net: total - 179, currency: 'usd', created: now})
   return Response.json(session)
  }
  const session = [...sessions.values()].find(s => path === '/v1/checkout/sessions/' + s.id || path === '/v1/payment_intents/' + s.payment_intent)
  if (session) return Response.json(path.includes('/payment_intents/') ? {id: session.payment_intent, status: 'succeeded', currency: 'usd', amount_received: session.amount_total, created: now} : session)
  if (path === '/v1/invoice_payments') return Response.json({data: [], has_more: false})
  if (path.startsWith('/v1/charges/') && charges.has(path.slice(12))) return Response.json(charges.get(path.slice(12)))
  if (path === '/v1/payouts/po_form') return Response.json({id: 'po_form', status: 'paid', arrival_date: now, amount: entries.reduce((s, e) => s + e.net, 0), currency: 'usd', automatic: true, reconciliation_status: 'completed'})
  if (path.startsWith('/v1/balance_transactions/')) return Response.json(entries.find(e=>e.id===path.slice('/v1/balance_transactions/'.length)))
  if (path === '/v1/balance_transactions') return Response.json({data: entries, has_more: false})
  assert.fail('Unexpected giving-form payment request ' + path)
 }
 const paidBeforeReturn=async(h,session,secret,expectedStatus=200)=>{
  const charge=[...charges.values()].find(c=>c.payment_intent===session.payment_intent)
  const raw=JSON.stringify({id:'synthetic-coffer-paid-'+charge.id,type:'charge.succeeded',data:{object:{id:charge.id}}}),timestamp=Math.floor(Date.now()/1000)
  const signature=createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex')
  const response=await h.mf.dispatchFetch(h.origin+'/api/coffer/giving/webhook',{method:'POST',headers:{host:new URL(h.origin).host,'content-type':'application/json','stripe-signature':`t=${timestamp},v1=${signature}`},body:raw})
  assert.equal(response.status,expectedStatus,await response.text())
 }
 return {sessions, charges, entries, outbound, paidBeforeReturn}
}

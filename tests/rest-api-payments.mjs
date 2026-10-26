import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'

/** Only the provider boundary is faked; signed charge/refund intake is native. */
export function apiPaymentSource(){
 const secret='synthetic-coffer-4200',at=Date.parse('2026-10-27T12:00:00.000Z')/1000
 const charge={id:'ch_syntheticcoffer4201',paid:true,status:'succeeded',amount:10000,currency:'usd',created:at,metadata:{fund:'Unrestricted'},billing_details:{name:'Riverbend payment donor',email:'synthetic-coffer-4202@example.test'},balance_transaction:'txn_syntheticcoffer4203',amount_refunded:0}
 const refund={id:'re_syntheticcoffer4204',status:'succeeded',charge:charge.id,balance_transaction:'txn_syntheticcoffer4205'}
 const chargeEntry={id:charge.balance_transaction,type:'charge',source:charge.id,amount:10000,fee:300,net:9700,currency:'usd',created:at}
 const refundEntry={id:refund.balance_transaction,type:'refund',source:refund,amount:-2500,fee:0,net:-2500,currency:'usd',created:at}
 const objects=new Map([['/v1/charges/'+charge.id,charge],['/v1/refunds/'+refund.id,refund],['/v1/balance_transactions/'+chargeEntry.id,chargeEntry],['/v1/balance_transactions/'+refundEntry.id,refundEntry]])
 return {
  bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-4206',STRIPE_WEBHOOK_SECRET:secret},
  outbound:async request=>{
   const url=new URL(request.url)
   assert.equal(url.hostname,'api.stripe.com')
   assert.equal(request.method,'GET','API scope proof never makes a provider mutation')
   assert.ok(objects.has(url.pathname),'Expected provider read '+url.pathname)
   return Response.json(objects.get(url.pathname))
  },
  populate:async h=>{
   for(const [eventId,type,id] of [['synthetic-coffer-4207','charge.succeeded',charge.id],['synthetic-coffer-4208','refund.created',refund.id]]){
    const raw=JSON.stringify({id:eventId,type,data:{object:{id}}}),signature=createHmac('sha256',secret).update(at+'.'+raw).digest('hex')
    const response=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{'stripe-signature':`t=${at},v1=${signature}`}})
    assert.equal(response.status,200,await response.text())
   }
   const donor=(await h.get('/api/coffer/donors')).donors.find(d=>d.email==='synthetic-coffer-4202@example.test')
   assert.ok(donor)
   const native=await h.get('/api/coffer/donors/'+donor.id)
   return {donorId:donor.id,gifts:native.gifts,netCents:native.totals.lifetimeCents}
  },
 }
}

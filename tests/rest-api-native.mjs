import assert from 'node:assert/strict'

/** Provider edges only. Consent, address history and rule claims remain native. */
export function apiNativeEdges(){
 const state={addressCalls:0,addressFailure:false,emailFailure:false,suppressions:0,contacts:new Map(),notices:[],noticeFailure:false,plans:new Map(),planWrites:0}
 const outbound=async request=>{
  const u=new URL(request.url)
  if(u.hostname==='us-street.api.smarty.com'){
   state.addressCalls++;assert.equal(request.method,'POST');assert.ok(request.headers.get('authorization')?.startsWith('Basic '))
   if(state.addressFailure)return new Response(null,{status:503})
   const rows=await request.json()
   return Response.json(rows.map((a,i)=>({input_id:a.input_id,input_index:i,delivery_line_1:a.street.toUpperCase().replace('STREET','ST'),delivery_line_2:a.street2,components:{city_name:a.city.toUpperCase(),state_abbreviation:a.state.toUpperCase(),zipcode:a.zipcode.slice(0,5),plus4_code:'1234'},analysis:{dpv_match_code:'Y',dpv_vacant:'N',dpv_no_stat:'N',dpv_footnotes:'AABB'}})))
  }
  if(u.hostname==='mango.example.test'){
   if(u.pathname.endsWith('/segments'))return Response.json({segments:[]})
   if(u.pathname.endsWith('/events'))return Response.json({events:[],nextCursor:0})
   if(request.method==='GET'&&u.pathname.endsWith('/contacts')){
    if(state.emailFailure)return new Response(null,{status:503})
    const email=u.searchParams.get('email'),contact=state.contacts.get(email)
    return Response.json({contacts:contact?[{email,emailStatus:contact}]:[]})
   }
   const body=await request.json()
   if(u.pathname.endsWith('/suppressions')){
    state.suppressions++;assert.ok(body.idempotencyKey);state.contacts.set(body.email,'suppressed');return Response.json({})
   }
   assert.deepEqual(body,{},'Connecting checks permissions without creating contacts or sending')
   return Response.json({error:'invalid'},{status:400})
  }
  if(u.hostname==='hooks.slack.com'){
   assert.equal(request.method,'POST');state.notices.push(await request.json())
   return new Response(state.noticeFailure?'uncertain':'ok',{status:state.noticeFailure?503:200})
  }
  if(u.hostname==='api.stripe.com'&&state.plans.has(u.pathname.split('/').at(-1))){
   const plan=state.plans.get(u.pathname.split('/').at(-1))
   if(request.method==='POST'){
    state.planWrites++;assert.ok(request.headers.get('idempotency-key'))
    const p=new URLSearchParams(await request.text())
    assert.equal(p.get('proration_behavior'),'none')
    if(p.has('pause_collection[behavior]'))plan.pause_collection={behavior:p.get('pause_collection[behavior]')}
    if(p.has('pause_collection'))plan.pause_collection=null
    if(p.has('cancel_at_period_end'))plan.cancel_at_period_end=p.get('cancel_at_period_end')==='true'
    if(p.has('items[0][price_data][unit_amount]'))plan.items.data[0].price.unit_amount=Number(p.get('items[0][price_data][unit_amount]'))
   }else assert.equal(request.method,'GET')
   return Response.json(plan)
  }
  return null
 }
 return {state,outbound}
}

export async function addressEntry(h,write,checked,edges,{donorPath,donorInput}){
 const address={...donorInput,addressLine1:'1 synthetic-coffer-4250 street',city:'synthetic-coffer-4251',region:'CA',postalCode:'90210'}
 const create={method:'POST',keyName:'synthetic-coffer-4252'}
 const entered=await write('/donors',{...address,email:'synthetic-coffer-4253@example.test'},create)
 const path='/donors/'+entered.value.id
 assert.equal((await checked(path,{},'/donors/{id}')).value.data.address_line1,'1 SYNTHETIC-COFFER-4250 ST')
 const detail=await h.get('/api/coffer/donors/'+entered.value.id+'/addresses')
 assert.ok(detail.history.some(row=>row.source==='smarty'&&row.address_line1===address.addressLine1))
 assert.equal(edges.state.addressCalls,1)
 await write('/donors',{...address,email:'synthetic-coffer-4253@example.test'},create)
 assert.equal(edges.state.addressCalls,1,'Replay does not repeat address processing')
 const update={...address,version:2,addressLine1:'2 synthetic-coffer-4254 street'}
 edges.state.addressFailure=true
 await write(donorPath,update,{keyName:'synthetic-coffer-4255',status:502},'/donors/{id}')
 assert.equal((await checked(donorPath,{},'/donors/{id}')).value.data.version,2,'A provider failure leaves the native donor untouched')
 edges.state.addressFailure=false
 await write(donorPath,update,{keyName:'synthetic-coffer-4255'},'/donors/{id}')
 assert.equal((await checked(donorPath,{},'/donors/{id}')).value.data.address_line1,'2 SYNTHETIC-COFFER-4254 ST')
}

export async function consentSync(h,write,checked,edges,{donorId,email,day}){
 await h.command('marketing.connectMango',{origin:'https://mango.example.test',credential:'synthetic-coffer-4260'})
 edges.state.contacts.set(email,'subscribed')
 const path='/donors/'+donorId+'/consents',body={channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-4261',capturedOn:day}
 await write(path,body,{method:'POST'},'/donors/{id}/consents')
 const preference=async()=>(await h.get('/api/coffer/donors/'+donorId)).marketingPreference
 assert.equal((await preference()).state,'subscribed')
 const withdrawal={...body,status:'withdrawn'},options={method:'POST',keyName:'synthetic-coffer-4262'}
 await write(path,withdrawal,options,'/donors/{id}/consents')
 const count=(await h.get('/api/coffer/donors/'+donorId)).consents.length
 assert.equal((await preference()).state,'suppressed');assert.equal(edges.state.suppressions,1)
 await write(path,withdrawal,options,'/donors/{id}/consents')
 assert.equal(edges.state.suppressions,1,'Replayed withdrawal does not repeat a confirmed suppression')
 assert.equal((await h.get('/api/coffer/donors/'+donorId)).consents.length,count,'Replayed consent does not duplicate evidence')
 await write(path,body,{method:'POST'},'/donors/{id}/consents')
 assert.equal((await checked(path,{},'/donors/{id}/consents')).value.data.find(row=>row.channel==='email').status,'withdrawn','The sender opt-out remains authoritative over a new local grant')
 edges.state.emailFailure=true
 await write(path,body,{method:'POST'},'/donors/{id}/consents')
 assert.equal((await preference()).state,'pending','An unavailable provider leaves sending blocked')
 edges.state.emailFailure=false
}

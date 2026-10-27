import assert from 'node:assert/strict'

/** Twilio is the only fake: registration flows use the real settings command. */
export function smsRegistrationEdge(account,sender){
 const service='synthetic-coffer-40',campaign='synthetic-coffer-41'
 const state={status:'VERIFIED',registered:true,mock:false,unavailable:false,account,checks:0}
 return {state,service,campaign,async outbound(request){
  assert.equal(request.method,'GET')
  assert.equal(request.headers.get('authorization')?.startsWith('Basic '),true)
  if(state.unavailable)return Response.json({message:'Synthetic provider outage'},{status:503})
  const url=new URL(request.url)
  if(url.pathname===`/v1/Services/${service}/Compliance/Usa2p/${campaign}`){
   state.checks++
   return Response.json({sid:campaign,account_sid:state.account,messaging_service_sid:service,campaign_status:state.status,mock:state.mock,date_updated:'2026-10-15T00:00:00Z'})
  }
  assert.equal(url.pathname,`/v1/Services/${service}/PhoneNumbers`)
  return Response.json({phone_numbers:state.registered?[{phone_number:sender,account_sid:account,service_sid:service}]:[],meta:{next_page_url:null}})
 },async refresh(h,options={}){
  const {status,...readOptions}=options
  const current=await h.get('/api/coffer/sms/registration',readOptions)
  return h.command('sms.registration.refresh',{messagingServiceSid:service,campaignSid:campaign,version:current.version},options)
 }}
}

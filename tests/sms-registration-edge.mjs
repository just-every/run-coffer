import assert from 'node:assert/strict'
import {createHash,createHmac} from 'node:crypto'

/** Twilio is the only fake: registration flows use the real settings command. */
export function smsRegistrationEdge(account,sender,token){
 const service='synthetic-coffer-40',campaign='synthetic-coffer-41',numberCampaign='synthetic-coffer-50',numberSid='synthetic-coffer-51'
 const state={status:'VERIFIED',registered:true,mock:false,unavailable:false,account,checks:0}
 return {state,service,campaign,numberCampaign,numberSid,async outbound(request){
  assert.equal(request.method,'GET')
  assert.equal(request.headers.get('authorization')?.startsWith('Basic '),true)
  if(state.unavailable)return Response.json({message:'Synthetic provider outage'},{status:503})
  const url=new URL(request.url)
  if(url.pathname===`/v1/Services/${service}/Compliance/Usa2p/${campaign}`){
   state.checks++
   return Response.json({sid:campaign,account_sid:state.account,messaging_service_sid:service,campaign_status:state.status,mock:state.mock,date_updated:'2026-10-15T00:00:00Z'})
  }
  assert.equal(url.pathname,`/v1/Services/${service}/PhoneNumbers`)
  return Response.json({phone_numbers:state.registered?[{sid:numberSid,phone_number:sender,account_sid:account,service_sid:service}]:[],meta:{next_page_url:null}})
 },async refresh(h,options={}){
  const {status,...readOptions}=options
  const current=await h.get('/api/coffer/sms/registration',readOptions)
  return h.command('sms.registration.refresh',{messagingServiceSid:service,campaignSid:campaign,numberCampaignSid:numberCampaign,version:current.version},options)
 },async receipt(h,{status='registered',kind,id='synthetic-coffer-80',when='2026-10-15T16:00:00Z',data={},signature,raw,requestStatus=200}={}){
  const suffix=kind??({registered:'number-registration.successful',pending_registration:'number-registration.pending',failure:'number-registration.failed',pending_deregistration:'number-deregistration.pending',unregistered:'number-deregistration.successful'})[status]
  const payload=[{specversion:'1.0',id,type:'com.twilio.messaging.compliance.'+suffix,datacontenttype:'application/json',data:{accountsid:account,messagingservicesid:service,phonenumbersid:numberSid,phonenumber:sender.slice(1),campaignsid:numberCampaign,externalstatus:status,updateddate:Date.parse(when),...data}}]
  const body=JSON.stringify(payload),path='/api/coffer/sms/registration/events?bodySHA256='+createHash('sha256').update(body).digest('hex')
  const signed=signature??createHmac('sha1',token).update(h.origin+path).digest('base64')
  const response=await h.request(path,{method:'POST',as:'',raw:raw??body,headers:{'content-type':'application/json','x-twilio-signature':signed,'x-test-now':when}})
  const result=await response.json();assert.equal(response.status,requestStatus,JSON.stringify(result));return result
 }}
}

import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
export const form=values=>({method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(values).toString()})
export function recognitionEdges(){
 const sessions=new Map(),payments=new Map(),messages=[];let serial=0
 const outbound=async request=>{
  const url=new URL(request.url)
  if(url.hostname==='api.sendgrid.com'){
   assert.equal(url.pathname,'/v3/mail/send');messages.push(await request.json())
   return new Response(null,{status:202,headers:{'x-message-id':`recognition-mail-${messages.length}`}})
  }
  assert.equal(url.hostname,'api.stripe.com')
  const p=new URLSearchParams(await request.text())
  if(url.pathname==='/v1/customers'&&request.method==='POST')return Response.json({id:`cus_recognition_${++serial}`})
  if(url.pathname==='/v1/checkout/sessions'&&request.method==='POST'){
   const n=sessions.size+1,id=`cs_recognition_${n}`,pi=`pi_recognition_${n}`
   const session={id,url:`https://checkout.stripe.com/c/pay/${id}`,metadata:{coffer_intent:p.get('metadata[coffer_intent]')},customer:p.get('customer'),currency:'usd',amount_total:Number(p.get('line_items[0][price_data][unit_amount]')),status:'complete',payment_status:'paid',payment_intent:pi}
   assert.equal(p.get('mode'),'payment');sessions.set(id,session)
   payments.set(pi,{id:pi,status:'succeeded',currency:'usd',amount_received:session.amount_total,created:Date.parse('2026-09-15T16:00:00Z')/1000})
   return Response.json(session)
  }
  if(url.pathname.startsWith('/v1/checkout/sessions/')){const value=sessions.get(url.pathname.split('/').at(-1));assert.ok(value);return Response.json(value)}
  if(url.pathname.startsWith('/v1/payment_intents/')){const value=payments.get(url.pathname.split('/').at(-1));assert.ok(value);return Response.json(value)}
  assert.fail(`Unexpected Stripe edge ${request.method} ${url.pathname}`)
 }
 return {outbound,sessions,messages}
}
export async function giveRecognition(h,values){
 const input={requestId:randomUUID(),frequency:'once',...values},response=await h.request('/give/autumn-reading/checkout',form(input))
 assert.equal(response.status,303,await response.text())
 const sessionId=new URL(response.headers.get('location')).pathname.split('/').at(-1)
 const completed=await h.request('/giving/thanks?session_id='+sessionId);assert.equal(completed.status,200,await completed.text())
 return {input,sessionId}
}
export async function recognitionMember(h,edge,email='data-entry-recognition@example.test'){
 assert.equal((await h.request('/app/people/invite',form({email,role:'member',displayName:'Data entry'}))).status,303)
 const mail=edge.messages.findLast(m=>m.personalizations.some(p=>p.to.some(to=>to.email===email)))
 const link=mail.content.find(c=>c.type==='text/plain').value.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]
 const response=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:new URL(link).searchParams.get('token')}});assert.equal(response.status,303)
 return response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
}

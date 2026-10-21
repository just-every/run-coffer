import assert from 'node:assert/strict'
import {recognitionEdges} from './recognition-edge.mjs'

/** Only sender boundaries are simulated; no product commands or data are faked. */
export function solicitationEdges() {
 const giving=recognitionEdges(),contacts=new Map(),lists=new Map()
 let serial=600
 const outbound=async request=>{
  const url=new URL(request.url)
  if(url.hostname==='api.sendgrid.com')return giving.outbound(request)
  assert.equal(url.origin,'https://mango.example.test')
  assert.ok(url.pathname.startsWith('/api/integrations/v1/'))
  const path=url.pathname.slice('/api/integrations/v1'.length),body=request.method==='GET'?null:await request.json()
  if(path==='/segments')return Response.json({segments:[...lists.keys()].map(name=>({id:name,name}))})
  if(path==='/events')return Response.json({events:[],nextCursor:'0'})
  if(path==='/campaigns/coffer-connection-check/send')return Response.json({error:'invalid_request'},{status:400})
  if(path==='/contacts'&&request.method==='PUT'){
   if(!body.email)return Response.json({error:'invalid_request'},{status:400})
   assert.equal(body.subscribe,true)
   assert.ok(body.consent?.evidence,'List membership carries the actual Coffer consent evidence')
   const contact={id:`synthetic-coffer-${++serial}`,email:body.email,emailStatus:'subscribed',segmentIds:[body.segmentName]}
   contacts.set(body.email,contact)
   if(!lists.has(body.segmentName))lists.set(body.segmentName,new Set())
   lists.get(body.segmentName).add(body.email)
   return Response.json({contact})
  }
  if(path==='/contacts'&&request.method==='GET')return Response.json({contacts:contacts.has(url.searchParams.get('email'))?[contacts.get(url.searchParams.get('email'))]:[]})
  assert.fail(`Unexpected solicitation sender request ${request.method} ${path}`)
 }
 return {outbound,messages:giving.messages,contacts,lists}
}

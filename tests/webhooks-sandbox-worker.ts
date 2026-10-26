// Disposable live proof entry. Production HTTP handlers and delivery are unchanged.
import { authResponse, runtimeBindings, type Bindings } from '../src/auth.server'
import { cofferResponse } from '../src/coffer/http'
import { rejectedResponse } from '../src/base/rejected-response'
import { runWebhooks } from '../src/coffer/webhooks/delivery'

type Sandbox = Bindings & { SANDBOX_SECRET: string }
export const privateEndpoint = 'https://127.0.0.1.sslip.io/'

export default {
 async fetch(request: Request, env: Sandbox) {
  const path = new URL(request.url).pathname
  if (path.startsWith('/_sandbox/')) {
   if (request.headers.get('authorization') !== 'Bearer ' + env.SANDBOX_SECRET) return new Response(null, {status:404})
   if (path === '/_sandbox/ready') return Response.json({ready:true})
   if (path === '/_sandbox/tick' && request.method === 'POST') {
    const {at} = await request.json() as {at:string}
    const chosen = new Date(at)
    if (!Number.isFinite(chosen.getTime()) || Math.abs(chosen.getTime()-Date.now()) > 240000) return new Response(null,{status:400})
    await runWebhooks(runtimeBindings(env),chosen)
    return Response.json({completed:true})
   }
   if (path === '/_sandbox/private-network' && request.method === 'POST') {
    try {
     const response = await fetch(privateEndpoint,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),body:'synthetic-coffer-1'})
     const body = await response.text()
     // Report only the denial classification, never an arbitrary response body.
     return Response.json({status:response.status,prohibited:/prohibited IP|private (?:IP|address|network)|internal (?:IP|address|network)|error code:\s*1002/i.test(body),code:/error code:\s*(\d+)/i.exec(body)?.[1]??null})
    } catch (error) {
     const message = error instanceof Error ? error.message : ''
     return Response.json({status:null,prohibited:/prohibited IP|private (?:IP|address|network)|internal (?:IP|address|network)|not permitted.*(?:IP|address)/i.test(message),code:null})
    }
   }
   return new Response(null,{status:404})
  }
  const response = await authResponse(request,env) ?? await cofferResponse(request,env) ?? new Response('Not found',{status:404})
  response.headers.set('x-coffer-sandbox-route',path)
  return rejectedResponse(request,response)
 }
}

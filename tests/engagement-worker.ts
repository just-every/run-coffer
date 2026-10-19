// Test transport for the Email Routing network edge; the actual receiveReply
// handler owns matching, deduplication, storage and forwarding decisions.
import worker from './worker'
import { receiveReply } from '../src/coffer/communications/replies'
const RealDate=Date
export default {async fetch(request:Request,env:any) {
 const value=request.headers.get('x-test-now'),instant=value?RealDate.parse(value):RealDate.now()
 globalThis.Date=class extends RealDate {constructor(...args:any[]){super(...(args.length?args:[instant]) as [any])}static now(){return instant}} as DateConstructor
 try {
  if(new URL(request.url).pathname==='/test-email') {
   const input:any=await request.json(),bytes=new TextEncoder().encode(input.raw),forwarded:string[]=[]
   let rejected:string|null=null
   await receiveReply({from:input.from,to:input.to,headers:new Headers(input.headers),raw:new Blob([bytes]).stream(),rawSize:bytes.length,
    setReject(reason:string){rejected=reason},async forward(to:string){forwarded.push(to)}} as ForwardableEmailMessage,env)
   return Response.json({rejected,forwarded})
  }
  return await worker.fetch(request,env)
 }finally{globalThis.Date=RealDate}
}}

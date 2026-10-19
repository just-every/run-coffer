// Test-only clock supplied on the real HTTP request; production has no clock door.
import worker from './worker'
const RealDate=Date
export default { async fetch(request:Request,env:any) {
 const value=request.headers.get('x-test-now'),instant=value ? RealDate.parse(value) : RealDate.now()
 globalThis.Date=class extends RealDate {
  constructor(...args:any[]){super(...(args.length ? args : [instant]) as [any])}
  static now(){return instant}
 } as DateConstructor
 try{return await worker.fetch(request,env)}finally{globalThis.Date=RealDate}
} }

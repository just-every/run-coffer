// Test-only clock supplied on the real HTTP request; production has no clock door.
import { AsyncLocalStorage } from 'node:async_hooks'
import worker from './worker'
const RealDate=Date
const clock=new AsyncLocalStorage<number>()
// Overlapping requests must keep their own instant after another request ends.
// Restoring the global Date in a request's finally leaks wall time into its peers.
globalThis.Date=class extends RealDate {
 constructor(...args:any[]){super(...(args.length ? args : [clock.getStore()??RealDate.now()]) as [any])}
 static now(){return clock.getStore()??RealDate.now()}
} as DateConstructor
export default { scheduled:worker.scheduled, async fetch(request:Request,env:any) {
 const value=request.headers.get('x-test-now'),instant=value ? RealDate.parse(value) : (env.COFFER_TEST_NOW ? RealDate.parse(env.COFFER_TEST_NOW) : RealDate.now())
 return clock.run(instant,()=>worker.fetch(request,env))
} }

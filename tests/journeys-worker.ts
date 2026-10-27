import worker from './engagement-worker'
import { runWelcome } from '../src/coffer/communications/welcome'
import { runScheduledJourneys } from '../src/coffer/communications/journey-runner'
export default {fetch:worker.fetch,async scheduled(controller:ScheduledController,env:any){
 await runWelcome(env,new Date(controller.scheduledTime))
 await runScheduledJourneys(env,new Date(controller.scheduledTime))
}}

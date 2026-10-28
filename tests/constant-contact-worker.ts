import worker from './engagement-worker'
import { runMarketingSync } from '../src/coffer/communications/scheduler'
export default {fetch:worker.fetch,async scheduled(controller:ScheduledController,env:any){await runMarketingSync(env,new Date(controller.scheduledTime))}}

import worker from './worker'
import { runAgentJobs } from '../src/coffer/agent/jobs'
export default {
 fetch:worker.fetch,
 async scheduled(controller:ScheduledController,env:any) {
  await worker.scheduled(controller,env)
  await runAgentJobs(env,new Date(controller.scheduledTime))
 }
}

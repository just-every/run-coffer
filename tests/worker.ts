import { runScheduledTexts } from '../src/coffer/sms-scheduler'
import { advanceDevelopmentReports } from '../src/coffer/agent/development-report-scheduler'
import { runCallRankingJob } from '../src/coffer/call-ranking-scheduler'
import { runTaskReminders } from '../src/coffer/call-tasks'
import { runWebhooks } from '../src/coffer/webhooks/delivery'
import { runScheduledReports } from '../src/coffer/report-scheduler'
import { runPledgeFollowups } from '../src/coffer/pledge-followups'
import { prepareJanuaryStatements } from '../src/coffer/annual-scheduler'
import { advanceNcoa } from '../src/coffer/addresses/scheduler'
import { advancePledgeTasks } from '../src/coffer/pledges'
import { advanceMeetingBriefs } from '../src/coffer/meeting-briefs'
import { advanceRecurringTasks } from '../src/coffer/recurring-tasks'
// The HTTP ownership chain used by the deployed Worker, without the unrelated
// TanStack asset entry. Mail is the only external boundary faked by the harness.
import { rejectedResponse } from '../src/base/rejected-response'
import { authResponse } from '../src/auth.server'
import { cofferResponse } from '../src/coffer/http'
export default { async scheduled(controller: ScheduledController, env: any) { await runScheduledTexts(env,new Date(controller.scheduledTime)); await advanceDevelopmentReports(env,new Date(controller.scheduledTime)); await runTaskReminders(env,new Date(controller.scheduledTime)); await runWebhooks(env,new Date(controller.scheduledTime)); await runScheduledReports(env,new Date(controller.scheduledTime)); await prepareJanuaryStatements(env,new Date(controller.scheduledTime)); await advanceNcoa(env,new Date(controller.scheduledTime)); await advancePledgeTasks(env,new Date(controller.scheduledTime)); if(new Date(controller.scheduledTime).getUTCHours()===13&&new Date(controller.scheduledTime).getUTCMinutes()===0){await runPledgeFollowups(env,new Date(controller.scheduledTime));await runCallRankingJob(env,new Date(controller.scheduledTime))}; await advanceRecurringTasks(env,new Date(controller.scheduledTime)); await advanceMeetingBriefs(env,new Date(controller.scheduledTime)) }, async fetch(request: Request, env: any) { const response = await authResponse(request, env) ?? await cofferResponse(request, env) ?? new Response('Not found', { status: 404 }); return rejectedResponse(request, response) } }

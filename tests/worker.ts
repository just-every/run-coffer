import { advanceMeetingBriefs } from '../src/coffer/meeting-briefs'
import { advanceRecurringTasks } from '../src/coffer/recurring-tasks'
// The HTTP ownership chain used by the deployed Worker, without the unrelated
// TanStack asset entry. Mail is the only external boundary faked by the harness.
import { rejectedResponse } from '../src/base/rejected-response'
import { authResponse } from '../src/auth.server'
import { cofferResponse } from '../src/coffer/http'
export default { async scheduled(controller: ScheduledController, env: any) { await advanceRecurringTasks(env,new Date(controller.scheduledTime)); await advanceMeetingBriefs(env,new Date(controller.scheduledTime)) }, async fetch(request: Request, env: any) { const response = await authResponse(request, env) ?? await cofferResponse(request, env) ?? new Response('Not found', { status: 404 }); return rejectedResponse(request, response) } }

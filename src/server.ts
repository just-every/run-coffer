import { runTaskReminders } from './coffer/call-tasks'
import { runWebhooks } from './coffer/webhooks/delivery'
import { runScheduledReports } from './coffer/report-scheduler'
import { runPledgeFollowups } from './coffer/pledge-followups'
import { prepareJanuaryStatements } from './coffer/annual-scheduler'
import { advanceNcoa } from './coffer/addresses/scheduler'
import { advanceMeetingBriefs } from './coffer/meeting-briefs'
import { advanceRecurringTasks } from './coffer/recurring-tasks'
import { runWelcome } from './coffer/communications/welcome'
import { receiveReply } from './coffer/communications/replies'
import { runMarketingSync } from './coffer/communications/scheduler'
import { withDemo } from './modules/demo/index.mjs'
import { rejectedResponse } from './base/rejected-response'
import start from '@tanstack/react-start/server-entry'
import { Hono } from 'hono'
import { dispatch } from './base/dispatch'
import { staticAssetResponse } from './base/static-assets'
import { deploymentHealth } from './base/deployment-health'
import { lobbyResponse } from './base/lobby'
import { setupStateResponse } from './base/setup-state'
import { authResponse, runtimeBindings, type Bindings } from './auth.server'
import { identity } from './identity'
import { runAgentJobs } from './coffer/agent/jobs'
import { advancePledgeTasks, runPledgeReminders } from './coffer/pledges'
import { cofferResponse } from './coffer/http'
import { seedDemo } from './demo'

const api = new Hono<{ Bindings: Bindings }>()
api.get('/health', (context) => context.json({ status: 'ok', ...deploymentHealth(context.env) }))

// Start documents keep their own cache policy and add no-transform, so no proxy
// rewrites the HTML React hydrates (Cloudflare's email address obfuscation
// honours it; src/base/hydration/README.md).
function noTransform(response: Response): Response {
  const headers = new Headers(response.headers), policy = headers.get('cache-control')
  headers.set('cache-control', policy ? `${policy}, no-transform` : 'no-transform')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default withDemo<Bindings, ExportedHandler<Bindings>>({
  async email(message,env) { await receiveReply(message,runtimeBindings(env)) },
  async scheduled(controller, env, execution) {
    execution.waitUntil(runMarketingSync(runtimeBindings(env),new Date(controller.scheduledTime)))
    execution.waitUntil(runWelcome(runtimeBindings(env),new Date(controller.scheduledTime)))
    const tick=new Date(controller.scheduledTime)
    execution.waitUntil(runTaskReminders(runtimeBindings(env),tick))
    execution.waitUntil(runWebhooks(runtimeBindings(env),tick))
    execution.waitUntil(runScheduledReports(runtimeBindings(env),tick))
    execution.waitUntil(prepareJanuaryStatements(runtimeBindings(env),tick))
    execution.waitUntil(advanceNcoa(runtimeBindings(env),tick))
    execution.waitUntil(advanceMeetingBriefs(runtimeBindings(env),tick))
    execution.waitUntil(advanceRecurringTasks(runtimeBindings(env),tick))
    execution.waitUntil(advancePledgeTasks(runtimeBindings(env),tick))
    if(tick.getUTCHours()===13 && tick.getUTCMinutes()===0) {
      execution.waitUntil(runPledgeReminders(runtimeBindings(env),tick))
      execution.waitUntil(runPledgeFollowups(runtimeBindings(env),tick))
      execution.waitUntil(runAgentJobs(runtimeBindings(env),tick))
    }
  },
  async fetch(request, env, execution) {
    const asset = await staticAssetResponse(request, env)
    if (asset) return asset
    const auth = await authResponse(request, env)
    if (auth) return auth
    // The installed variant: the Lobby at / and the public claim state it reads.
    // Local dev serves the saved origin's data at its own port (RER_DEV_ORIGIN).
    const state = await setupStateResponse(request, runtimeBindings(env))
    if (state) return state
    const lobby = await lobbyResponse(request, runtimeBindings(env), identity)
    if (lobby) return lobby
    const coffer = await cofferResponse(request, env)
    if (coffer) return rejectedResponse(request, coffer)
    return rejectedResponse(request, await dispatch(request, () => api.fetch(request, env, execution), async () => noTransform(await start.fetch(request))))
  },
} satisfies ExportedHandler<Bindings>, { seed: seedDemo })

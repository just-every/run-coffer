import { fail, one } from '../db'
import { campaign } from '../giving/campaigns'
import { portalContext } from '../giving/portal-identity'
import { portalSession } from '../giving/portal'
import { givingBody, givingRedirect } from '../giving/http'
import type { GivingEnv } from '../giving/stripe'
import { ownState, saveTeam, savePage, publicPage, leaderboard } from './service'
import { savePeerRecognition } from './recognition'
import { peerDashboard, peerPublicPage, peerLeaderboard } from './ui'

const headers = {'cache-control': 'no-store', 'referrer-policy': 'no-referrer'}
export async function peerResponse(request: Request, env: GivingEnv): Promise<Response | null> {
 const url = new URL(request.url), path = url.pathname
 if (!path.startsWith('/giving/peer')) return null
 const publicMatch = path.match(/^\/giving\/peer\/(pages|leaderboard)\/([a-z0-9-]+)$/)
 if (publicMatch) {
  if (request.method !== 'GET') fail('method_not_allowed', 'Use the fundraising page.', 405)
  if (publicMatch[1] === 'pages') {
   const value = await publicPage({db:env.DB}, publicMatch[2])
   return url.searchParams.get('format') === 'json' ? Response.json(value, {headers}) : peerPublicPage(value)
  }
  const record = await one({db:env.DB}, 'SELECT slug FROM cf_campaigns WHERE id=? AND active=1', publicMatch[2])
  if (!record) fail('not_found', 'That campaign is unavailable.', 404)
  const current = await campaign({db:env.DB}, record.slug), value = await leaderboard({db:env.DB}, current.id)
  return url.searchParams.get('format') === 'json' ? Response.json(value, {headers}) : peerLeaderboard(value, {id:current.id, name:current.name})
 }
 const donor = await portalSession(request, env)
 if (!donor) return givingRedirect('/giving/portal')
 const c = await portalContext(env, donor)
 if (request.method === 'GET' && (path === '/giving/peer' || path === '/giving/peer/state')) {
  const state = await ownState(c, donor.id)
  return path.endsWith('/state') ? Response.json(state, {headers}) : peerDashboard(state, url.searchParams.get('saved') === '1')
 }
 if (request.method !== 'POST') fail('method_not_allowed', 'Use your fundraising forms.', 405)
 if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) fail('form_required', 'Use your fundraising form.', 415)
 const p = Object.fromEntries(new URLSearchParams(await givingBody(request)))
 const result = path === '/giving/peer/teams' ? await saveTeam(c, donor.id, p)
  : path === '/giving/peer/pages' ? await savePage(c, donor.id, p)
  : path === '/giving/peer/recognition' ? await savePeerRecognition(c, donor.id, p)
  : fail('not_found', 'That fundraising action is unavailable.', 404)
 return url.searchParams.get('format') === 'json' ? Response.json(result, {headers}) : givingRedirect('/giving/peer?saved=1')
}

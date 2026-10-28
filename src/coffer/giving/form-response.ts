import { givingFormResponses } from './form-responses'
import { requireRole } from '../auth'
import { fail, one, type Context } from '../db'
import { page } from '../ui/common'
import { givingBody, givingRedirect } from './http'
import { getGivingForm, saveGivingForm } from './form-configuration'
import { givingFormSettings, givingFormsSettings, givingFormSettingsInput } from './form-manage-ui'

export async function givingFormResponse(request: Request, c: Context): Promise<Response | null> {
 const url = new URL(request.url), api = url.pathname.startsWith('/api/')
 const responses = url.pathname.match(/^\/api\/coffer\/giving\/campaigns\/([^/]+)\/responses$/)
 if(responses){if(request.method!=='GET')fail('method_not_allowed','Use GET.',405);return Response.json({responses:await givingFormResponses(c,decodeURIComponent(responses[1]))})}
 const match = url.pathname.match(/^\/api\/coffer\/giving\/campaigns\/([^/]+)\/form$/) ?? url.pathname.match(/^\/app\/settings\/giving-forms(?:\/([^/]+))?$/)
 if (!match) return null
 requireRole(c.actor, ['owner', 'admin'], 'configure giving forms')
 const id = match[1] ? decodeURIComponent(match[1]) : null
 if (request.method === 'GET') {
  if (api) {
   const campaign = await one(c, 'SELECT * FROM cf_campaigns WHERE id=?', id)
   if (!campaign) fail('NOT_FOUND', 'Choose a campaign.', 404)
   return Response.json(await getGivingForm(c, campaign))
  }
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const content = id ? await givingFormSettings(c, id, url.searchParams.has('saved')) : await givingFormsSettings(c)
  const response = await page('Donation form settings', content.replace('<script src=', `<script nonce="${nonce}" src=`), c.actor, 200, '/app/settings')
  response.headers.set('content-security-policy', response.headers.get('content-security-policy') + `; script-src 'nonce-${nonce}'; connect-src 'self'`)
  return response
 }
 if (request.method !== 'POST' || !id) fail('method_not_allowed', 'Use the form settings.', 405)
 const raw = await givingBody(request)
 let input
 if (api) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail('INPUT', 'Send JSON.', 415)
  try { input = JSON.parse(raw) } catch { fail('INPUT', 'Send a JSON object.', 400) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INPUT', 'Send a JSON object.', 400)
 } else input = givingFormSettingsInput(new URLSearchParams(raw))
 const result = await saveGivingForm(c, id, input)
 return api || request.headers.get('accept') === 'application/json' ? Response.json(result) : givingRedirect('/app/settings/giving-forms/' + encodeURIComponent(id) + '?saved=1')
}

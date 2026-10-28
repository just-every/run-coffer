import { campaigns } from '../giving/campaigns'
import { givingBody, givingRedirect } from '../giving/http'
import { checkout } from '../giving/checkout'
import { givingConnection } from '../giving/connections'
import type { GivingEnv } from '../giving/stripe'
import { fail, type Context } from '../db'
import { page } from '../ui/common'
import { membershipJoinPage, membershipSettings, membershipsPage } from './ui'
import { createMembershipLevel, membershipLevel, membershipStaff, membershipState, prepareMembershipReminders, retireMembershipLevel } from './service'

export async function publicMembershipResponse(request:Request,env:GivingEnv):Promise<Response|null>{
 const match=new URL(request.url).pathname.match(/^\/giving\/memberships\/([a-z0-9-]+)(\/checkout)?$/)
 if(!match)return null
 const level=await membershipLevel({db:env.DB},match[1])
 if(request.method==='GET'&&!match[2]){
  const security=await givingConnection(env,'turnstile'),nonce=crypto.randomUUID().replaceAll('-','')
  const response=await page('Join '+level.name,membershipJoinPage(level,security?.siteKey??'')+`<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`)
  response.headers.set('content-security-policy',response.headers.get('content-security-policy')!.replace("form-action 'self'","form-action 'self' https://checkout.stripe.com")+`; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com`)
  return response
 }
 if(request.method!=='POST'||!match[2])fail('METHOD','Use the membership form.',405)
 if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))fail('FORM','Send the membership form.',415)
 const input=Object.fromEntries(new URLSearchParams(await givingBody(request)))
 if(input.authorizeRenewal!=='yes')fail('AUTHORIZATION','Explicitly authorize this recurring membership before continuing.',400)
 if(String(level.version)!==input.levelVersion)fail('LEVEL_CHANGED','Reload the level before authorizing its terms.',409)
 const session=await checkout(env,request,level.campaign_slug,input,undefined,level)
 if(typeof session.url!=='string'||new URL(session.url).hostname!=='checkout.stripe.com')fail('CHECKOUT','The secure checkout is not available.',409)
 return givingRedirect(session.url)
}
export async function membershipResponse(request:Request,c:Context,read:()=>Promise<Record<string,any>>):Promise<Response|null>{
 const path=new URL(request.url).pathname,api=path==='/api/coffer/memberships',config=path==='/app/settings/memberships'
 if(!api&&!config&&path!=='/app/giving/memberships')return null
 membershipStaff(c)
 if(request.method==='POST'){
  const p=await read(),result=p.action==='create'?await createMembershipLevel(c,p):p.action==='retire'?await retireMembershipLevel(c,p):p.action==='reminders'?await prepareMembershipReminders(c):fail('INPUT','Choose a membership action.',400)
  return api?Response.json(result,{headers:{'cache-control':'no-store'}}):givingRedirect(config?'/app/settings/memberships':'/app/giving/memberships')
 }
 if(request.method!=='GET')fail('METHOD','Use the membership form.',405)
 const state=await membershipState(c)
 if(api)return Response.json(state,{headers:{'cache-control':'no-store'}})
 return page(config?'Membership settings':'Memberships',config?membershipSettings(state,await campaigns(c,true)):membershipsPage(state),c.actor,200,config?'/app/settings':'/app/giving')
}

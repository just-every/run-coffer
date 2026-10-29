import { enterMembership, renewalMembership } from './entry'
import { portalSession } from '../giving/portal'
import { membershipEntryPage } from './ui'
import { all, text } from '../db'
import { membershipReminder, sendMembershipReminder } from './reminders'
import { reminderPage } from './ui'
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
 const url=new URL(request.url),match=url.pathname.match(/^\/giving\/memberships\/([a-z0-9-]+)(\/checkout)?$/)
 if(!match)return null
 let level=await membershipLevel({db:env.DB},match[1])
 const renew=async(id:string)=>{
  const donor=await portalSession(request,env)
  if(!donor)fail('SIGN_IN_REQUIRED','Sign in to your giving account before renewing an existing membership.',401)
  await renewalMembership({db:env.DB},id,donor.id,level)
  level={...level,renewal_membership_id:id,renewal_donor_id:donor.id,renewal_name:donor.name,renewal_email:donor.email}
 }
 if(request.method==='GET'&&!match[2]){
  if(url.searchParams.has('renew'))await renew(text(url.searchParams.get('renew'),'Membership',100))
  const security=await givingConnection(env,'turnstile'),nonce=crypto.randomUUID().replaceAll('-','')
  const response=await page('Join '+level.name,membershipJoinPage(level,security?.siteKey??'')+`<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`)
  response.headers.set('content-security-policy',response.headers.get('content-security-policy')!.replace("form-action 'self'","form-action 'self' https://checkout.stripe.com")+`; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com`)
  return response
 }
 if(request.method!=='POST'||!match[2])fail('METHOD','Use the membership form.',405)
 if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))fail('FORM','Send the membership form.',415)
 const input=Object.fromEntries(new URLSearchParams(await givingBody(request)))
 const mode=input.paymentMode??'renewing'
 if(!['renewing','once'].includes(mode))fail('INPUT','Choose automatic renewal or a single term.',400)
 if(mode==='renewing'&&input.authorizeRenewal!=='yes'||mode==='once'&&input.confirmTerm!=='yes')fail('AUTHORIZATION','Explicitly authorize the selected membership payment and term before continuing.',400)
 if(input.renewMembershipId){
  if(mode!=='once')fail('INPUT','Renew this fixed-term membership with a single payment.',400)
  await renew(text(input.renewMembershipId,'Membership',100))
  input.name=level.renewal_name;input.email=level.renewal_email
 }
 level={...level,auto_renew:mode==='renewing'?1:0}
 if(String(level.version)!==input.levelVersion)fail('LEVEL_CHANGED','Reload the level before authorizing its terms.',409)
 const session=await checkout(env,request,level.campaign_slug,input,undefined,level)
 if(typeof session.url!=='string'||new URL(session.url).hostname!=='checkout.stripe.com')fail('CHECKOUT','The secure checkout is not available.',409)
 return givingRedirect(session.url)
}
export async function membershipResponse(request:Request,c:Context,read:()=>Promise<Record<string,any>>):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname,api=path==='/api/coffer/memberships',config=path==='/app/settings/memberships'
 if(!api&&!config&&path!=='/app/giving/memberships')return null
 membershipStaff(c)
 if(request.method==='POST'){
  const p=await read(),result=p.action==='entry'?await enterMembership(c,p):p.action==='sendReminder'?await sendMembershipReminder(c,p):p.action==='create'?await createMembershipLevel(c,p):p.action==='retire'?await retireMembershipLevel(c,p):p.action==='reminders'?await prepareMembershipReminders(c):fail('INPUT','Choose a membership action.',400)
  return api?Response.json(result,{headers:{'cache-control':'no-store'}}):givingRedirect(config?'/app/settings/memberships':'/app/giving/memberships')
 }
 if(request.method!=='GET')fail('METHOD','Use the membership form.',405)
 if(url.searchParams.has('entry')){
  const state=await membershipState(c),gifts=await all(c,`SELECT g.id,g.donor_id,g.amount_cents,g.goods_cents,g.received_on,d.name FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.kind='gift' AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_membership_payments p WHERE p.gift_id=g.id) ORDER BY g.received_on DESC,g.id LIMIT 200`)
  return page('Enter a membership',membershipEntryPage(state,gifts),c.actor,200,'/app/giving')
 }
 if(url.searchParams.has('reminder')){
  const current=await membershipReminder(c,url.searchParams.get('reminder')!)
  return api?Response.json(current,{headers:{'cache-control':'no-store'}}):page('Review renewal request',reminderPage(current),c.actor,200,'/app/giving')
 }
 const state=await membershipState(c)
 if(api)return Response.json(state,{headers:{'cache-control':'no-store'}})
 return page(config?'Membership settings':'Memberships',config?membershipSettings(state,await campaigns(c,true)):membershipsPage(state),c.actor,200,config?'/app/settings':'/app/giving')
}

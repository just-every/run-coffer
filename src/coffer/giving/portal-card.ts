import { commit, event, fail, guard, one, sha256, sql } from '../db'
import { ownPlan, validatePlan } from './portal-plans'
import { portalContext, type PortalDonor } from './portal-identity'
import { stripe, type GivingEnv } from './stripe'
import type { Row } from '../db'

const redirect=(location:string)=>new Response(null,{status:303,headers:{location,'cache-control':'no-store','referrer-policy':'no-referrer'}})
async function cardConfiguration(env: GivingEnv) {
 const stored = await one<{ value: string }>({db:env.DB}, "SELECT value FROM cf_giving_config WHERE key='donor_card_configuration'")
 if (stored) {
  const config = await stripe(env, `billing_portal/configurations/${encodeURIComponent(stored.value)}`)
  const features = config.features ?? {}
  const onlyCardUpdates = ['customer_update', 'invoice_history', 'subscription_cancel', 'subscription_update'].every(name => features[name]?.enabled === false)
   && Object.keys(features).every(name => name === 'payment_method_update' || features[name]?.enabled !== true)
  if (config.id === stored.value && config.active === true && features.payment_method_update?.enabled === true && onlyCardUpdates && config.login_page?.enabled === false) return stored.value
  fail('portal_configuration_changed', 'Card updates are unavailable because the payment portal configuration changed. Contact the organization.', 503)
 }
 const config = await stripe(env, 'billing_portal/configurations', {
  'features[payment_method_update][enabled]': true,
  'features[customer_update][enabled]': false,
  'features[invoice_history][enabled]': false,
  'features[subscription_cancel][enabled]': false,
  'features[subscription_update][enabled]': false,
  'login_page[enabled]': false,
  default_return_url: `${new URL(env.AUTH_ORIGIN).origin}/giving/portal`,
 }, `coffer-donor-card-${await sha256(new URL(env.AUTH_ORIGIN).origin)}`)
 if (typeof config.id !== 'string' || !config.id.startsWith('bpc_')) fail('stripe_error', 'Stripe returned an unreadable portal configuration.', 502)
 await env.DB.prepare("INSERT INTO cf_giving_config(key,value) VALUES('donor_card_configuration',?) ON CONFLICT(key) DO NOTHING").bind(config.id).run()
 return config.id
}


const methodRef=(value:any):string|null=>typeof value==='string'?value:value?.id??null
async function paymentMethod(env:GivingEnv,own:Row,current:Row){
 const customer=await stripe(env,'customers/'+encodeURIComponent(own.customer_id))
 if(customer.id!==own.customer_id||customer.deleted)fail('subscription_changed','This payment account could not be verified.',409)
 const customerMethod=methodRef(customer.invoice_settings?.default_payment_method),direct=methodRef(current.default_payment_method)
 return {effective:direct??customerMethod,customerMethod,direct}
}
export async function updatePaymentMethod(env:GivingEnv,donor:PortalDonor,data:URLSearchParams){
 const {c,own}=await ownPlan(env,donor,data.get('subscription')??''),current=await stripe(env,'subscriptions/'+encodeURIComponent(own.id))
 validatePlan(current,own)
 if(['canceled','incomplete_expired'].includes(current.status))fail('plan_ended','This recurring gift has ended.',409)
 const before=await paymentMethod(env,own,current),id=crypto.randomUUID(),returnUrl=new URL(env.AUTH_ORIGIN).origin+'/giving/portal/card-return?request='+id
 const previous={previousPaymentMethodHash:before.effective?await sha256(before.effective):null,previousCustomerMethodHash:before.customerMethod?await sha256(before.customerMethod):null}
 const result=await stripe(env,'billing_portal/sessions',{customer:own.customer_id,configuration:await cardConfiguration(env),return_url:returnUrl,'flow_data[type]':'payment_method_update','flow_data[after_completion][type]':'redirect','flow_data[after_completion][redirect][return_url]':returnUrl},'coffer-card-'+id)
 let destination:URL
 try{destination=new URL(result.url)}catch{fail('stripe_error','Stripe returned an unreadable portal address.',502)}
 if(destination.protocol!=='https:'||destination.hostname!=='billing.stripe.com'||destination.username||destination.password||destination.port)fail('stripe_error','Stripe returned an unexpected portal address.',502)
 // complete denotes the successful hosted handoff, not a replaced payment
 // method. Only the verified return can record paymentMethodUpdated.
 await commit(c,[sql("INSERT INTO cf_portal_changes(id,donor_id,subscription_id,action,state,request,created_at) VALUES(?,?,?,'card','complete',?,?)",id,donor.id,own.id,JSON.stringify(previous),c.now),event(c,'portal.paymentMethodUpdateStarted','subscription',own.id,donor.id,{requestId:id})])
 return redirect(destination.href)
}
export async function paymentMethodReturn(env:GivingEnv,donor:PortalDonor,id:string){
 const c=await portalContext(env,donor),request=await one(c,"SELECT * FROM cf_portal_changes WHERE id=? AND donor_id=? AND action='card'",id,donor.id)
 if(!request)fail('not_found','That payment update is not available on your account.',404)
 if(request.completed_at)return redirect('/giving/portal?card=updated')
 const {own}=await ownPlan(env,donor,request.subscription_id),current=await stripe(env,'subscriptions/'+encodeURIComponent(own.id));validatePlan(current,own)
 let after=await paymentMethod(env,own,current)
 const before=JSON.parse(request.request)
 // Hosted updates change the customer's invoice default. For a legacy plan
 // with an explicit subscription default, make that plan follow the newly
 // confirmed customer method, then verify the actual effective method again.
 if(after.direct&&after.customerMethod&&await sha256(after.customerMethod)!==before.previousCustomerMethodHash&&after.customerMethod!==after.direct){
  await commit(c,[])
  const changed=await stripe(env,'subscriptions/'+encodeURIComponent(own.id),{default_payment_method:''},'coffer-card-follow-'+id)
  validatePlan(changed,own)
  after=await paymentMethod(env,own,changed)
 }
 if(!after.effective||await sha256(after.effective)===before.previousPaymentMethodHash)return redirect('/giving/portal?card=unchanged')
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_portal_changes WHERE id=? AND completed_at IS NULL)','change_recorded','This payment update is already recorded.',id),sql("UPDATE cf_portal_changes SET completed_at=?,request='{}' WHERE id=?",c.now,id),event(c,'portal.paymentMethodUpdated','subscription',own.id,donor.id,{requestId:id})])
 return redirect('/giving/portal?card=updated')
}

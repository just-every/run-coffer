import { all, one, type Context } from '../db'
import { box, e, field, form, select } from '../ui/common'
import { protectionState } from './protection'
import { givingKeywords } from './connections'
export async function textGivingSettings(c: Context) {
 if (!['owner','admin'].includes(c.actor.role)) return ''
 const configured=await one(c,"SELECT name FROM cf_giving_connections WHERE name='twilio'"),campaigns=await all(c,'SELECT id,name FROM cf_campaigns ORDER BY name'),keywords=await givingKeywords(c)
 return await fraudSettings(c) + box('Text-to-give', `<p>Connect your registered Twilio number and set its incoming-message webhook to <code>${e(c.env!.AUTH_ORIGIN)}/api/coffer/sms/webhook</code>. A keyword request gets one private giving link valid for 15 minutes. It never grants marketing permission. STOP immediately suppresses further links and withdraws existing SMS permission. Keys are encrypted in this installation and never displayed or included in backups.</p><p>${configured?'Twilio settings saved.':'No saved Twilio connection.'}</p>`+
 form('giving.connectTwilio',field('Twilio account','account','text','','required autocomplete="off"')+field('Twilio auth token','token','password','','required autocomplete="new-password"')+field('Registered Twilio number','from','tel','','required placeholder="+12025550101"'),'Save Twilio connection')+
 (campaigns.length?form('giving.keyword',field('Giving keyword','keyword','text','','required pattern="[A-Za-z][A-Za-z0-9]{1,29}"')+select('Giving campaign','campaignId',campaigns.map(r=>[r.id,r.name] as [string,string]))+field('Defined appeal (optional)','appeal'),'Claim giving keyword'):'<p>Publish a campaign before claiming a keyword.</p>')+
 `<ul>${keywords.map(k=>`<li><strong>${e(k.keyword)}</strong> → <a href="/give/${e(k.slug)}">${e(k.name)}</a>${k.appeal?' · '+e(k.appeal):''}</li>`).join('')}</ul>`)
}

async function fraudSettings(c: Context) {
 const paused=(await protectionState(c)).filter(r=>r.paused),configured=await one(c,"SELECT name FROM cf_giving_connections WHERE name='turnstile'")
 return box('Giving protection',`<p>${configured?'Turnstile verification is connected. Failed or unavailable checks refuse checkout.':'Turnstile is not connected. All public checkout is closed until you connect it.'}</p><p>Ten attempts per address per minute. Ten failures comprising at least half of a form’s attempts in a minute pause it until an owner or admin reviews and resumes it. This panel is the persistent admin alert. Card limits and automatic fraud refunds are not available yet.</p>`+
 form('giving.protection',field('Turnstile site key','siteKey','text','','required')+field('Turnstile secret','secret','password','','required autocomplete="new-password"'),'Connect giving protection')+
 paused.map(p=>`<div role="alert"><p><strong>${e(p.name)} is paused</strong> · ${e(p.alerted_at)} · ${p.failures} failures</p>${form('giving.resume','<p>Review payment activity in Stripe before reopening gifts.</p>','Resume giving',{campaignId:p.campaign_id})}</div>`).join(''))
}

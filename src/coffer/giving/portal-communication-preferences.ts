import { fail } from '../db'
import { communicationPreferences, COMMUNICATION_TOPICS, saveCommunicationPreferences } from '../communications/preference-store'
import { box, e, hidden, select } from '../ui/common'
import { portalContext, type PortalDonor } from './portal-identity'
import type { GivingEnv } from './stripe'

export async function communicationPreferenceForms(env:GivingEnv,donor:PortalDonor){
 const c=await portalContext(env,donor),preferences=await communicationPreferences(c,donor.id)
 return box('Topics and appeal frequency',`<p>Choose topics separately for each channel. Appeal limits count submitted requests in the organization's calendar month or quarter. These choices do not grant channel permission or change your donation-request restrictions. Receipts, statements and existing pledge reminders keep their separate permissions.</p>${preferences.channels.map(p=>`<details><summary>${e(p.channel[0].toUpperCase()+p.channel.slice(1))}: ${e(p.topics.join(', ')||'no marketing topics')} · ${e(p.frequency)}</summary>${p.inherited.length?'<p>Choices retained from merged records also apply. Staff can help reconcile those original choices.</p>':''}<form method="post" action="/giving/portal/communications">${hidden('action','preferences')}${hidden('channel',p.channel)}${hidden('version',p.version)}<fieldset><legend>${e(p.channel)} topics</legend>${COMMUNICATION_TOPICS.map(topic=>`<label><input type="checkbox" name="topics" value="${topic}" ${p.ownTopics.includes(topic)?'checked':''}> ${e(topic[0].toUpperCase()+topic.slice(1))}</label>`).join('')}</fieldset>${select('Appeals per '+p.channel,'frequency',[['unlimited','No additional frequency limit'],['monthly','At most one per calendar month'],['quarterly','At most one per calendar quarter']],p.ownFrequency)}<label><input type="checkbox" name="confirm" value="yes" required> I confirm these ${e(p.channel)} preferences.</label><button>Save ${e(p.channel)} preferences</button></form></details>`).join('')}`)
}
export async function savePortalCommunicationPreferences(env:GivingEnv,donor:PortalDonor,data:URLSearchParams){
 if(data.has('donorId')&&data.get('donorId')!==donor.id)fail('FORBIDDEN','Only your own communication preferences can be changed.',403)
 const c=await portalContext(env,donor)
 return saveCommunicationPreferences(c,{donorId:donor.id,channel:data.get('channel'),version:data.get('version'),topics:data.getAll('topics'),frequency:data.get('frequency'),confirm:data.get('confirm')},donor.id)
}

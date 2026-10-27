import { all, guard, today, type Context, type Stmt } from '../db'
import { settings } from '../settings'
import { currentPreference, preferenceIdentity, type CommunicationChannel, type CommunicationTopic } from './preference-store'

/** Calendar periods use the organization's local date, separate from the
 * donor's all-channel solicitation limits. Only durable asks consume a slot. */
async function preferenceQuery(c:Pick<Context,'db'> & {now?:string},donorIds:string[],channel:CommunicationChannel,topic:CommunicationTopic,run?:{kind:string;id:string}){
 const day=today((await settings(c)).timezone,new Date(c.now??Date.now())),quarter=String(Math.floor((Number(day.slice(5,7))-1)/3)*3+1).padStart(2,'0')
 const monthStart=day.slice(0,7)+'-01',quarterStart=day.slice(0,5)+quarter+'-01'
 const topicBlocked=`EXISTS(SELECT 1 FROM cf_communication_preferences p WHERE ${currentPreference} AND ${preferenceIdentity('p.donor_id')}=t.value AND p.channel=? AND NOT EXISTS(SELECT 1 FROM json_each(p.topics) WHERE value=?))`
 const frequencyBlocked=`EXISTS(SELECT 1 FROM cf_communication_preferences p WHERE ${currentPreference} AND ${preferenceIdentity('p.donor_id')}=t.value AND p.channel=? AND p.frequency<>'unlimited' AND EXISTS(SELECT 1 FROM cf_solicitation_asks a WHERE ${preferenceIdentity('a.donor_id')}=t.value AND a.channel=p.channel AND a.asked_on BETWEEN CASE p.frequency WHEN 'monthly' THEN ? ELSE ? END AND ? AND NOT(a.kind=? AND a.run_id=?)))`
 const query=`SELECT t.value AS donor_id,CASE WHEN ${topicBlocked} THEN 'topic' ${topic==='appeals'?`WHEN ${frequencyBlocked} THEN 'frequency'`:''} ELSE NULL END AS reason FROM json_each(?) t`
 const params:unknown[]=[channel,topic,...(topic==='appeals'?[channel,monthStart,quarterStart,day,run?.kind??'',run?.id??'']:[]),JSON.stringify([...new Set(donorIds)])]
 return {query,params}
}
export async function communicationReasons(c:Pick<Context,'db'> & {now?:string},donorIds:string[],channel:CommunicationChannel,topic:CommunicationTopic='appeals',run?:{kind:string;id:string}){
 if(!donorIds.length)return new Map<string,string|null>()
 const {query,params}=await preferenceQuery(c,donorIds,channel,topic,run)
 return new Map<string,string|null>((await all(c,query,...params)).map(r=>[r.donor_id,r.reason]))
}
export async function communicationGuards(c:Context,donorIds:string[],channel:CommunicationChannel,topic:CommunicationTopic|null,run:{kind:string;id:string}):Promise<Stmt[]>{
 if(!topic||!donorIds.length)return []
 const {query,params}=await preferenceQuery(c,donorIds,channel,topic,run)
 return [guard(`NOT EXISTS(SELECT 1 FROM (${query}) WHERE reason IS NOT NULL)`,'COMMUNICATION_RESTRICTED','A recipient is excluded by their current topic or frequency preference. Prepare again.',...params)]
}

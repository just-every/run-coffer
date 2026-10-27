import { all, choice, commit, event, fail, guard, id, integer, sql, today, type Context, type Row } from '../db'
import { settings } from '../settings'

type PreferenceContext=Omit<Context,'actor'> & {actor:Omit<Context['actor'],'role'> & {role:Context['actor']['role']|'donor'}}

export const COMMUNICATION_CHANNELS=['email','mail','sms','phone'] as const
export const COMMUNICATION_TOPICS=['newsletter','appeals','events'] as const
export const COMMUNICATION_FREQUENCIES=['unlimited','monthly','quarterly'] as const
export type CommunicationTopic=typeof COMMUNICATION_TOPICS[number]
export type CommunicationChannel=typeof COMMUNICATION_CHANNELS[number]
export const preferenceIdentity=(column:string)=>`COALESCE((SELECT into_id FROM cf_donor_merges WHERE donor_id=${column}),${column})`
export const currentPreference=`p.version=(SELECT MAX(v.version) FROM cf_communication_preferences v WHERE v.donor_id=p.donor_id AND v.channel=p.channel)`

/** Original choices remain distinct after a merge. The reader returns their
 * intersection of topics and strictest appeal frequency without granting consent. */
export async function communicationPreferences(c:Pick<Context,'db'>,donorId:string){
 const history=await all(c,`SELECT p.* FROM cf_communication_preferences p WHERE ${preferenceIdentity('p.donor_id')}=? ORDER BY p.recorded_at,p.donor_id,p.channel,p.version`,donorId)
 return {channels:COMMUNICATION_CHANNELS.map(channel=>{
  const originals=history.filter(p=>p.channel===channel&&!history.some(v=>v.channel===channel&&v.donor_id===p.donor_id&&v.version>p.version))
  const own=originals.find(p=>p.donor_id===donorId)
  const topics=COMMUNICATION_TOPICS.filter(topic=>originals.every(p=>JSON.parse(p.topics).includes(topic)))
  const frequency=originals.some(p=>p.frequency==='quarterly')?'quarterly':originals.some(p=>p.frequency==='monthly')?'monthly':'unlimited'
  return {channel,version:own?.version??0,topics,frequency,ownTopics:own?JSON.parse(own.topics):[...COMMUNICATION_TOPICS],ownFrequency:own?.frequency??'unlimited',inherited:originals.filter(p=>p.donor_id!==donorId).map(p=>({...p,topics:JSON.parse(p.topics)}))}
 }),history:history.map(p=>({...p,topics:JSON.parse(p.topics)}))}
}

/** The trusted portal adapter supplies its authenticated own identity. Native
 * staff writes remain owner or admin only; neither door grants a channel. */
export async function saveCommunicationPreferences(c:PreferenceContext,p:Row,portalDonorId?:string,providerSource?:'constant-contact'|'mango'|'mailchimp'){
 const donorId=id(p.donorId,'Donor'),channel=choice(p.channel,COMMUNICATION_CHANNELS,'communication channel'),version=integer(Number(p.version),'Preference version',0)
 if(portalDonorId){if(c.actor.id!=='donor:'+portalDonorId||donorId!==portalDonorId)fail('FORBIDDEN','Only your own communication preferences can be changed.',403)}
 else if(!['owner','admin'].includes(c.actor.role))fail('FORBIDDEN','Only an owner or admin records communication preferences.',403)
 if(p.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm these communication preferences.',400)
 if(typeof p.topics==='string')p.topics=[p.topics]
 if(p.topics===undefined)p.topics=[]
 if(!Array.isArray(p.topics))fail('INPUT','Choose communication topics.',400)
 const topics=[...new Set(p.topics.map((topic:unknown)=>choice(topic,COMMUNICATION_TOPICS,'communication topic')))].sort()
 const frequency=choice(p.frequency,COMMUNICATION_FREQUENCIES,'appeal frequency'),source=portalDonorId?'portal':providerSource??'person',day=today((await settings(c)).timezone,new Date(c.now))
 await commit(c,[guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL AND d.constituent_status='active' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`,'DONOR_CHANGED','Choose a current donor.',donorId),
  guard('COALESCE((SELECT MAX(version) FROM cf_communication_preferences WHERE donor_id=? AND channel=?),0)=?','PREFERENCE_CHANGED','Communication preferences changed. Reload before saving.',donorId,channel,version),
  sql('INSERT INTO cf_communication_preferences VALUES(?,?,?,?,?,?,?,?)',donorId,channel,version+1,JSON.stringify(topics),frequency,source,c.now,c.actor.name),
  sql(`INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by) VALUES(?,?,COALESCE((SELECT status FROM cf_consents WHERE donor_id=? AND channel=? ORDER BY id DESC LIMIT 1),'withdrawn'),?,?,?, ?,?)`,donorId,channel,donorId,channel,source,'Communication preferences version '+(version+1)+'; channel permission retained',day,c.now,c.actor.name),
  event(c,'communication.preferences','donor',donorId,donorId,{channel,version:version+1,topics,frequency,source}),
 ])
 return communicationPreferences(c,donorId)
}
export async function preferenceCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(command!=='communication.preferences')return undefined
 return saveCommunicationPreferences(c,p)
}

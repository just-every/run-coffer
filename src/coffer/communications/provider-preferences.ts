import { commit, event, fail, sql, text, type Context, type Row } from '../db'
import { givingConnection, sealGiving } from '../giving/connections'
import type { GivingEnv } from '../giving/stripe'
import { communicationPreferences, COMMUNICATION_TOPICS, saveCommunicationPreferences } from './preference-store'

/** Provider topic identifiers are installation-specific configuration. Their
 * encrypted connection rows do not travel in an archive or imply permission. */
export async function providerPreferenceCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(command!=='marketing.topicMapping')return undefined
 if(!['owner','admin'].includes(c.actor.role))fail('FORBIDDEN','Only an owner or admin maps provider preferences.',403)
 if(!['mango','mailchimp'].includes(p.provider))fail('INPUT','Choose Mango or Mailchimp.',400)
 if(p.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm these provider preference fields.',400)
 if(!c.env)fail('EMAIL_NOT_CONNECTED','The installation configuration is unavailable.',503)
 const topics=Object.fromEntries(COMMUNICATION_TOPICS.filter(topic=>p[topic+'Id']).map(topic=>[topic,text(p[topic+'Id'],'Provider topic identifier',100)]))
 const frequencyField=p.frequencyField?text(p.frequencyField,'Appeal frequency field',100):null
 const sealed=await sealGiving(c.env as GivingEnv,{topics,frequencyField})
 await commit(c,[sql('INSERT INTO cf_giving_connections VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET sealed=excluded.sealed,updated_at=excluded.updated_at',p.provider+'-preferences',sealed,c.now),event(c,command,'settings','email-preferences',null,{provider:p.provider,topics:Object.keys(topics),frequencyField:!!frequencyField})])
 return {provider:p.provider,mappedTopics:Object.keys(topics),frequencyField:!!frequencyField}
}

/** Import only stricter current answers. A provider list or field never grants
 * channel consent, re-enables a removed topic or loosens an appeal cap. */
export async function importProviderPreferences(c:Context,donorId:string,provider:'mango'|'mailchimp'|'constant-contact',contact:Row|null,validateOnly=false){
 if(provider==='constant-contact')return // Its mapped preferences use the existing encrypted connection and parser.
 if(!c.env)return
 const mapping=await givingConnection(c.env as GivingEnv,provider+'-preferences')
 if(!mapping)return
 const mapped=COMMUNICATION_TOPICS.filter(topic=>mapping.topics?.[topic])
 if(!mapped.length&&!mapping.frequencyField)return
 if(!contact)fail('PROVIDER_PREFERENCE_RESPONSE','The provider did not return the configured preference answers. Sending stays held.',502)
 const current=(await communicationPreferences(c,donorId)).channels.find(p=>p.channel==='email')!
 if(mapped.length&&(provider==='mango'
  ?!Array.isArray(contact.segmentIds)||contact.segmentIds.some((value:unknown)=>typeof value!=='string'||!value)
  :!contact.interests||typeof contact.interests!=='object'||Array.isArray(contact.interests)||mapped.some(topic=>typeof contact.interests[mapping.topics[topic]]!=='boolean')))
  fail('PROVIDER_PREFERENCE_RESPONSE','The provider did not return the configured topic choices. Sending stays held.',502)
 const topics=current.ownTopics.filter((topic:string)=>!mapped.includes(topic as typeof mapped[number])||(provider==='mango'?contact.segmentIds.includes(mapping.topics[topic]):contact.interests[mapping.topics[topic]]===true))
 let frequency=current.ownFrequency
 if(mapping.frequencyField){
  const value=contact.fields?.[mapping.frequencyField]
  if(!['unlimited','monthly','quarterly'].includes(value))fail('PROVIDER_PREFERENCE_RESPONSE','The configured appeal frequency must be unlimited, monthly or quarterly. Sending stays held.',502)
  const limits=['unlimited','monthly','quarterly'];if(limits.indexOf(value)>limits.indexOf(frequency))frequency=value
 }
 if(!validateOnly&&(JSON.stringify([...topics].sort())!==JSON.stringify([...current.ownTopics].sort())||frequency!==current.ownFrequency))await saveCommunicationPreferences(c,{donorId,channel:'email',version:current.version,topics,frequency,confirm:'yes'},undefined,provider)
}

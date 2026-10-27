import { commit, event, fail, id, one, sql, text, today, type Context, type Row } from '../db'
import { settings } from '../settings'
import { givingConnection, sealGiving } from '../giving/connections'
import type { GivingEnv } from '../giving/stripe'
import { communicationPreferences, COMMUNICATION_TOPICS, saveCommunicationPreferences } from './preference-store'

/** Constant Contact documents contact status reads for unsubscribes. Its
 * partner billing webhook is not a contact-consent notification. */
export async function syncConstantContactDonor(c:Context,donorId:string,selectedEmail?:string){
 if(!c.env)return {configured:false}
 const connection=await givingConnection(c.env as GivingEnv,'constant-contact')
 if(!connection)return {configured:false}
 const donor=await one(c,`SELECT d.email,(SELECT MAX(id) FROM cf_consents WHERE donor_id=d.id AND channel='email') AS consent_id FROM cf_donors d WHERE id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`,donorId)
 if(!donor?.email&&!selectedEmail)return {configured:true,matched:false}
 const email=selectedEmail??donor!.email
 const url=new URL('https://api.cc.email/v3/contacts');url.searchParams.set('email',email);url.searchParams.set('include','list_memberships,custom_fields');url.searchParams.set('status','all')
 const response=await fetch(url,{headers:{authorization:'Bearer '+connection.token,accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000)})
 if(!response.ok)fail('CONSTANT_CONTACT_UNAVAILABLE','Constant Contact could not confirm current preferences. Sending remains held.',502)
 const data=await response.json() as Row
 if(!Array.isArray(data.contacts)||data.contacts.length>1)fail('CONSTANT_CONTACT_RESPONSE','Constant Contact returned an ambiguous contact answer.',502)
 const contact=data.contacts[0]
 if(!contact)return {configured:true,matched:false}
 if(contact.email_address?.address?.toLowerCase()!==email.toLowerCase()||!['explicit','implicit','unsubscribed','pending_confirmation','temp_hold','not_set'].includes(contact.email_address.permission_to_send))fail('CONSTANT_CONTACT_RESPONSE','Constant Contact did not confirm this email and its permission.',502)
 const permission=contact.email_address.permission_to_send
 if(permission!=='explicit'&&permission!=='implicit'){
  const day=today((await settings(c)).timezone,new Date(c.now))
  await commit(c,[sql(`INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by) SELECT ?,'email','withdrawn','constant-contact','Constant Contact current contact permission',?,?,? WHERE COALESCE((SELECT MAX(id) FROM cf_consents WHERE donor_id=? AND channel='email'),0)=? AND (SELECT status FROM cf_consents WHERE donor_id=? AND channel='email' ORDER BY id DESC LIMIT 1) IS NOT 'withdrawn'`,donorId,day,c.now,'Constant Contact preference sync',donorId,donor?.consent_id??0,donorId),event(c,'marketing.preferenceChecked','donor',donorId,donorId,{provider:'constant-contact',permission})])
 }
 const mapped=COMMUNICATION_TOPICS.filter(topic=>connection.lists?.[topic])
 if(mapped.length||connection.frequencyField){
  if(mapped.length&&!Array.isArray(contact.list_memberships))fail('CONSTANT_CONTACT_RESPONSE','Constant Contact did not return the configured topic memberships.',502)
  const preferences=await communicationPreferences(c,donorId),current=preferences.channels.find(p=>p.channel==='email')!
  const topics=current.ownTopics.filter((topic:string)=>!mapped.includes(topic as typeof mapped[number])||contact.list_memberships.includes(connection.lists[topic]))
  let frequency=current.ownFrequency
  if(connection.frequencyField){
   const value=Array.isArray(contact.custom_fields)?contact.custom_fields.find((field:Row)=>field.custom_field_id===connection.frequencyField)?.value:undefined
   if(!['unlimited','monthly','quarterly'].includes(value))fail('CONSTANT_CONTACT_RESPONSE','The mapped appeal frequency must be unlimited, monthly or quarterly. Sending stays held.',502)
   const limits=['unlimited','monthly','quarterly'];if(limits.indexOf(value)>limits.indexOf(frequency))frequency=value
  }
  if(JSON.stringify([...topics].sort())!==JSON.stringify([...current.ownTopics].sort())||frequency!==current.ownFrequency)await saveCommunicationPreferences(c,{donorId,channel:'email',version:current.version,topics,frequency,confirm:'yes'},undefined,'constant-contact')
 }
 return {configured:true,matched:true,permission}
}

/** A preference-only connection. Tokens are encrypted with the installation
 * key and excluded from archives with the existing giving connections. */
export async function constantContactCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(!['marketing.constantContactConnect','marketing.constantContactSync','marketing.constantContactDisconnect'].includes(command))return undefined
 if(!['owner','admin'].includes(c.actor.role))fail('FORBIDDEN','Only an owner or admin manages provider preference synchronization.',403)
 if(!c.env)fail('CONSTANT_CONTACT_UNAVAILABLE','The installation connection is unavailable.',503)
 if(command==='marketing.constantContactDisconnect'){
  await commit(c,[sql("DELETE FROM cf_giving_connections WHERE name='constant-contact'"),event(c,command,'settings','constant-contact',null)])
  return {configured:false}
 }
 if(command==='marketing.constantContactConnect'){
  if(p.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm this preference-only provider connection.',400)
  const token=text(p.token,'Constant Contact access token',4000),lists=Object.fromEntries(COMMUNICATION_TOPICS.filter(topic=>p[topic+'ListId']).map(topic=>[topic,id(p[topic+'ListId'],'Constant Contact topic list')]))
  if(/\s/.test(token))fail('INPUT','Paste the access token without spaces.',400)
  const frequencyField=p.frequencyField?text(p.frequencyField,'Appeal frequency custom field ID',100):null
  const sealed=await sealGiving(c.env as GivingEnv,{token,lists,frequencyField})
  await commit(c,[sql("INSERT INTO cf_giving_connections VALUES('constant-contact',?,?) ON CONFLICT(name) DO UPDATE SET sealed=excluded.sealed,updated_at=excluded.updated_at",sealed,c.now),event(c,command,'settings','constant-contact',null,{topics:Object.keys(lists)})])
  return {configured:true,topics:Object.keys(lists)}
 }
 return syncConstantContactDonor(c,id(p.donorId,'Donor'))
}

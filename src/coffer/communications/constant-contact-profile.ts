import { nameMergeFields } from '../person-names'
import { fail, type Row } from '../db'
import { selectedProfileFields } from './profile-fields'
import type { Connection } from './connection'
import { ccContact, ccPart, ccRequest, constantContactContact } from './constant-contact-api'

/** Only profile subresources are written. Email permission is never included in
 * an update, so a provider unsubscribe survives a profile synchronization. */
export async function syncConstantContactProfile(conn:Connection,donor:Row,known?:Row|null):Promise<Row>{
 const existing=known===undefined?await constantContactContact(conn,donor.email):known
 if(existing&&existing.emailStatus!=='subscribed')return existing
 const fields={...nameMergeFields(donor),...selectedProfileFields(conn,donor)}
 if(Object.keys(fields).length>25)fail('CONSTANT_CONTACT_FIELDS','Constant Contact allows at most 25 custom fields per contact. Choose fewer shared fields.',409)
 const definitions=await ccRequest(conn,'/contact_custom_fields?limit=100')
 if(!Array.isArray(definitions.custom_fields)||definitions._links?.next)fail('CONSTANT_CONTACT_FIELDS','Constant Contact must return the complete custom field catalog before sharing profile values.',409)
 const values:Row[]=[]
 for(const [key,value] of Object.entries(fields)){
  const label='Coffer '+key
  if(label.length>50)fail('CONSTANT_CONTACT_FIELDS','A selected field name exceeds Constant Contact’s label limit.',409)
  let definition=definitions.custom_fields.find((field:Row)=>field.label===label)
  if(definition&&definition.type!=='string')fail('CONSTANT_CONTACT_FIELDS','A Constant Contact field has an incompatible type. No contact values were changed.',409)
  if(!definition){definition=await ccRequest(conn,'/contact_custom_fields','POST',{label,type:'string'});definitions.custom_fields.push(definition)}
  if(definition.label!==label||definition.type!=='string')fail('CONSTANT_CONTACT_RESPONSE','Constant Contact did not confirm a profile field definition.',502)
  ccPart(definition.custom_field_id)
  const rendered=String(value??'')
  if(rendered.length>255)fail('CONSTANT_CONTACT_FIELDS','A selected profile value exceeds Constant Contact’s limit. No value was truncated.',409)
  values.push({custom_field_id:definition.custom_field_id,value:rendered})
 }
 await conn.checkFields?.()
 if(existing&&existing.first_name===fields.first_name&&existing.last_name===fields.last_name&&values.every(value=>(existing.custom_fields??[]).some((field:Row)=>field.custom_field_id===value.custom_field_id&&field.value===value.value)))return existing
 if(!existing){
  const created=await ccRequest(conn,'/contacts','POST',{email_address:{address:donor.email,permission_to_send:'implicit'},create_source:'Account',first_name:fields.first_name,last_name:fields.last_name,custom_fields:values})
  return ccContact(created,donor.email)
 }
 const latest=await ccRequest(conn,'/contacts/'+ccPart(existing.contact_id)+'?include=custom_fields,list_memberships,phone_numbers,street_addresses')
 if(ccContact(latest,donor.email).emailStatus!=='subscribed')return ccContact(latest,donor.email)
 const profile:Row={update_source:'Account'}
 for(const key of ['first_name','last_name','job_title','company_name','birthday_month','birthday_day','anniversary','phone_numbers','street_addresses','list_memberships'])if(latest[key]!==undefined)profile[key]=latest[key]
 profile.first_name=fields.first_name;profile.last_name=fields.last_name
 profile.custom_fields=[...(latest.custom_fields??[]).filter((field:Row)=>!values.some(value=>value.custom_field_id===field.custom_field_id)),...values]
 if(profile.custom_fields.length>25)fail('CONSTANT_CONTACT_FIELDS','The selected and existing custom fields exceed Constant Contact’s limit. No contact values were changed.',409)
 return ccContact(await ccRequest(conn,'/contacts/'+ccPart(existing.contact_id),'PUT',profile),donor.email)
}
export async function suppressConstantContact(conn:Connection,email:string){
 const contact=await constantContactContact(conn,email)
 if(!contact||contact.emailStatus==='unsubscribed')return
 await ccRequest(conn,'/contacts/'+ccPart(contact.contact_id),'PUT',{update_source:'Account',email_address:{address:email,permission_to_send:'unsubscribed'},...Object.fromEntries(['first_name','last_name','job_title','company_name','birthday_month','birthday_day','anniversary'].filter(key=>contact[key]!==undefined).map(key=>[key,contact[key]]))})
 if((await constantContactContact(conn,email))?.emailStatus!=='unsubscribed')fail('CONSTANT_CONTACT_PREFERENCE','Constant Contact has not confirmed the withdrawal. Sending remains held.',502)
}

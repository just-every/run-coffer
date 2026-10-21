import { computedHouseholdNames, householdDefaults, householdMembers } from './household-names'
import { all, commit, event, fail, guard, id, integer, newId, one, optional, sql, text, type Context, type Row } from './db'

export const ORGANIZATION_TYPES = ['business','foundation','church','school','government body','donor-advised fund sponsor'] as const
export const informalName = (d:Row) => d.informal_salutation || d.nickname || d.first_name || d.name
export function organizationFields(p:Row,d:Row={}) {
 const kind=p.constituentKind??d.constituent_kind??'person'
 const value=(key:string,column=key)=>p[key]===undefined?d[column]??null:optional(p[key],key,200)
 const organizationType=value('organizationType','organization_type'),website=value('website'),ein=value('ein'),salutation=value('informalSalutation','informal_salutation')
 if(organizationType&&!ORGANIZATION_TYPES.includes(organizationType as any))fail('INPUT','Choose an organization type.',400)
 if(website){let url:URL;try{url=new URL(website)}catch{fail('INPUT','Use a complete https or http website address.',400)}if(!['https:','http:'].includes(url!.protocol)||url!.username||url!.password)fail('INPUT','Use a public https or http website address.',400)}
 if(ein&&!/^\d{2}-\d{7}$/.test(ein))fail('INPUT','Use an EIN in the form 12-3456789.',400)
 return {kind,organizationType,website,ein,salutation}
}
const current = `erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id)`
export async function organizationContactCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(command!=='organization.contact')return undefined
 const organizationId=id(p.donorId,'Organization'),contactId=id(p.contactDonorId,'Contact'),version=integer(p.version,'Version',1)
 const role=text(p.role,'Contact role',100),primary=p.primary===true||p.primary==='yes'
 await commit(c,[guard(`EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND constituent_kind='organization' AND ${current})`,'VERSION','Open the current organization before editing contacts.',organizationId,version),guard(`EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND constituent_kind='person' AND ${current})`,'CONTACT','Choose a current person record as the contact.',contactId),
  ...(primary?[sql('UPDATE cf_organization_contacts SET is_primary=0 WHERE organization_donor_id=?',organizationId)]:[]),
  sql(`INSERT INTO cf_organization_contacts(id,organization_donor_id,contact_donor_id,role,is_primary) VALUES(?,?,?,?,?) ON CONFLICT(organization_donor_id,contact_donor_id) DO UPDATE SET role=excluded.role,is_primary=excluded.is_primary`,newId(),organizationId,contactId,role,primary?1:0),
  sql('UPDATE cf_donors SET version=version+1 WHERE id=?',organizationId),event(c,command,'donor',organizationId,organizationId,{contactDonorId:contactId,primary})])
 return {id:organizationId,version:version+1}
}
export async function organizationState(c:{db:D1Database},donorId:string) {
 const contacts=await all(c,`SELECT r.*,d.name,d.informal_salutation,d.nickname,d.first_name FROM cf_organization_contacts r JOIN cf_donors d ON d.id=r.contact_donor_id WHERE r.organization_donor_id=? AND d.constituent_kind='person' AND d.erased_at IS NULL ORDER BY r.is_primary DESC,lower(d.name),r.id`,donorId)
 const organizations=await all(c,`SELECT r.*,d.name FROM cf_organization_contacts r JOIN cf_donors d ON d.id=r.organization_donor_id WHERE r.contact_donor_id=? AND d.constituent_kind='organization' AND d.erased_at IS NULL ORDER BY lower(d.name),r.id`,donorId)
 const relatedGifts=await all(c,`SELECT g.id,g.donor_id,g.received_on,g.created_at,g.amount_cents,g.fund,g.method,g.kind,d.name AS organization_name FROM cf_contribution_ledger g JOIN cf_donors d ON d.id=g.donor_id WHERE d.constituent_kind='organization' AND d.erased_at IS NULL AND EXISTS(SELECT 1 FROM cf_organization_contacts r WHERE r.organization_donor_id=d.id AND r.contact_donor_id=?) ORDER BY g.received_on DESC,g.created_at DESC,g.id DESC`,donorId)
 return {contacts,organizations,relatedGifts}
}
/** Address and greeting are separate from the constituent credited by the ledger. */
export async function letterRecipient(c:{db:D1Database},d:Row):Promise<Row> {
 if(d.constituent_status==='deceased'&&d.constituent_kind!=='organization')return {...d,...await survivorAddressing(c,d)}
 const contact=d.constituent_kind==='organization'?await one(c,`SELECT d.* FROM cf_organization_contacts r JOIN cf_donors d ON d.id=r.contact_donor_id WHERE r.organization_donor_id=? AND r.is_primary=1 AND d.erased_at IS NULL AND d.constituent_kind='person'`,d.id):null
 return {...d,letter_name:contact?`${d.name}\nAttn: ${contact.name}`:d.name,letter_salutation:contact?informalName(contact):d.name,
  letter_address:JSON.stringify({line1:d.address_line1,line2:d.address_line2,city:d.city,region:d.region,postalCode:d.postal_code,country:d.country,organization:d.constituent_kind==='organization',...(contact?{attention:contact.name,attentionDonorId:contact.id,salutation:informalName(contact)}:{})})}
}
/** A receipt for a gift on a deceased constituent's record goes to the surviving household or the estate, never to the deceased. */
async function survivorAddressing(c:{db:D1Database},d:Row) {
 const household=d.household_id?await one(c,'SELECT * FROM cf_households WHERE id=?',d.household_id):null
 const living=household?(await householdMembers(c,household.id)).filter(m=>m.constituent_status!=='deceased'):[]
 const address=JSON.stringify({line1:d.address_line1,line2:d.address_line2,city:d.city,region:d.region,postalCode:d.postal_code,country:d.country,organization:false})
 if(!household||!living.length){const estate=`Estate of ${d.name}`;return {letter_name:estate,letter_salutation:estate,letter_address:address}}
 const computed=computedHouseholdNames(living,household.head_donor_id,await householdDefaults(c))
 return {letter_name:household.addressee_override??computed.addressee,letter_salutation:household.informal_override??computed.informal,letter_address:address}
}

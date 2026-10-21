import { all, type Context, type Row } from '../db'
import { ORGANIZATION_TYPES } from '../organizations'
import { box, chip, e, field, form, select } from './common'

export const organizationFields = (d:Row={}) => `${select('Organization type','organizationType',[['','Not specified'],...ORGANIZATION_TYPES.map(x=>[x,x] as [string,string])],d.organization_type??'')}${field('Website','website','url',d.website??'')}${field('Organization EIN','ein','text',d.ein??'','pattern="[0-9]{2}-[0-9]{7}" placeholder="12-3456789"')}`
export async function organizationPanel(c:Context,d:Row,state:Row) {
 const staff=c.actor.role!=='agent'
 if(d.constituent_kind!=='organization')return state.organizations.length?box('Organization contacts',`<ul>${state.organizations.map((r:Row)=>`<li><a href="/app/donors/${e(r.organization_donor_id)}">${e(r.name)}</a> · ${e(r.role)}${r.is_primary?' · Primary contact':''}</li>`).join('')}</ul><p>Related gifts belong to the organization and do not increase your personal giving total.</p>`):''
 const people=staff?await all(c,`SELECT id,name FROM cf_donors d WHERE constituent_kind='person' AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) ORDER BY lower(name),id`):[]
 const list=`<ul class="list">${state.contacts.map((r:Row)=>`<li><a href="/app/donors/${e(r.contact_donor_id)}">${e(r.name)}</a> · ${e(r.role)} ${r.is_primary?chip('Primary contact'):''}</li>`).join('')}</ul>`
 const edit=staff?`<details><summary>Edit organization</summary>${form('donor.profile',organizationFields(d),'Save organization',{donorId:d.id,version:d.version})}</details><details><summary>Add or update organization contact</summary>${form('organization.contact',`${select('Person record','contactDonorId',people.map(r=>[r.id,r.name] as [string,string]))}${field('Contact role','role','text','','required maxlength="100"')}<label><input type="checkbox" name="primary" value="yes"> Primary contact for letters and receipts</label>`,'Save organization contact',{donorId:d.id,version:d.version})}</details>`:''
 return box('Organization',`<p>${e(d.organization_type??'Organization')}${d.ein?` · EIN ${e(d.ein)}`:''}</p>${d.website?`<p><a href="${e(d.website)}" rel="noreferrer">${e(d.website)}</a></p>`:''}${list}${edit}`,'organization')
}

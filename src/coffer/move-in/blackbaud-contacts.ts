import { CONTACT_TYPES } from '../contact-points'
import { email, fail, optional, text } from '../db'
import type { ParsedContact } from './types'

type Row=Record<string,any>
const error=(message:string):never=>fail('SKY_CONTACTS',message+' Nothing was applied.',400)

/** Read every current contact, preserving source identities and primary flags.
 * Unsupported historical periods are refused, never silently filtered out. */
export function blackbaudContacts(points:Row[],kind:ParsedContact['kind'],donorId:string,types:Row) {
 if(points.some(v=>v.constituent_id!==donorId||v.inactive||v.start||v.end||v.seasonal_start||v.seasonal_end))error('Inactive, dated or seasonal source contacts require a separate migration.')
 if(points.length&&points.filter(v=>kind==='address'?v.preferred===true:v.primary===true).length!==1)error('Each present contact kind needs one explicit primary.')
 const contacts:ParsedContact[]=[],seen=new Set<string>()
 for(const v of points) {
  const type=Object.hasOwn(types,kind+':'+v.type)?types[kind+':'+v.type]:undefined
  if(!(CONTACT_TYPES[kind] as readonly unknown[]).includes(type)||type==='seasonal')error('Map each source contact type to a supported current native type.')
  const primary=kind==='address'?v.preferred:v.primary
  if(primary!==undefined&&typeof primary!=='boolean')error('The source contact primary flag must be Boolean.')
  let value:string
  if(kind==='email')value=email(v.address)??error('A source contact email is incomplete.')
  else if(kind==='phone')value=text(v.number,'Source phone',40)
  else {
   if(typeof v.address_lines!=='string')error('A source postal address is incomplete.')
   const lines=v.address_lines.split(/\r?\n/)
   if(lines.length>2)error('More than two source postal lines require a separate mapping.')
   value=JSON.stringify({line1:text(lines[0],'Source address'),line2:optional(lines[1],'Source address line 2'),city:text(v.city,'Source city',100),region:text(v.state,'Source state',100),postalCode:text(v.postal_code,'Source postal code',20),country:optional(v.country,'Source country',100)??'United States'})
  }
  if(seen.has(value))error('Repeated source contact values need review before applying.')
  seen.add(value)
  contacts.push({externalId:donorId+':'+kind+':'+v.id,kind,type,value,primary:primary===true,startsOn:null,endsOn:null})
 }
 return contacts
}

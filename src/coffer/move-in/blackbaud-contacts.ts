import { day } from './source-rows'
import { CONTACT_TYPES, contactSeasonsOverlap } from '../contact-points'
import { email, fail, optional, text } from '../db'
import type { ParsedContact } from './types'

type Row=Record<string,any>
const error=(message:string):never=>fail('SKY_CONTACTS',message+' Nothing was applied.',400)

/** Read every current contact, preserving source identities and primary flags.
 * Unsupported historical periods are refused, never silently filtered out. */
export function blackbaudContacts(points:Row[],kind:ParsedContact['kind'],donorId:string,types:Row,importDay:string) {
 if(points.some(v=>v.constituent_id!==donorId||v.inactive!==undefined&&typeof v.inactive!=='boolean'||kind!=='address'&&(v.start||v.end||v.seasonal_start||v.seasonal_end)))error('Dated, seasonal or incomplete source contacts require a separate migration.')
 if(points.some(v=>!v.inactive)&&points.filter(v=>!v.inactive&&(kind==='address'?v.preferred===true:v.primary===true)).length!==1)error('Each present contact kind needs one explicit primary.')
 const contacts:ParsedContact[]=[],seen=new Set<string>()
 for(const v of points) {
  const type=Object.hasOwn(types,kind+':'+v.type)?types[kind+':'+v.type]:undefined
  if(!(CONTACT_TYPES[kind] as readonly unknown[]).includes(type))error('Map each source contact type to a supported current native type.')
  const calendar=(value:any)=>{if(value===undefined||value===null)return null;const result=typeof value==='string'?day(value.slice(0,10)):'';return result||error('A source address period needs complete calendar dates.')}
  const sourceEffectiveFrom=calendar(v.start),sourceEffectiveThrough=calendar(v.end)
  if(sourceEffectiveFrom&&sourceEffectiveFrom>importDay||sourceEffectiveThrough&&sourceEffectiveThrough>importDay)error('Future absolute address periods need separate activation support; they are not made current automatically.')
  if(sourceEffectiveFrom&&sourceEffectiveThrough&&sourceEffectiveThrough<sourceEffectiveFrom||sourceEffectiveThrough&&!v.inactive)error('The source address dates and inactive state disagree.')
  const annual=(value:any)=>{if(!value||!Number.isInteger(value.m)||!Number.isInteger(value.d))error('A seasonal source address needs complete month and day bounds.');const normalized=`${String(value.m).padStart(2,'0')}-${String(value.d).padStart(2,'0')}`;if(!day('2000-'+normalized))error('Seasonal source bounds must be real month and day values.');return normalized}
  const hasSeason=v.seasonal_start!==undefined||v.seasonal_end!==undefined
  if(hasSeason!==(type==='seasonal'))error('Map a source seasonal address to the native seasonal type with both bounds.')
  const startsOn=hasSeason?annual(v.seasonal_start):null,endsOn=hasSeason?annual(v.seasonal_end):null
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
  if(!v.inactive&&seen.has(value))error('Repeated current source contact values need review before applying.')
  if(!v.inactive)seen.add(value)
  contacts.push({...(sourceEffectiveFrom||sourceEffectiveThrough?{sourceEffectiveFrom,sourceEffectiveThrough}:{}),active:v.inactive!==true,externalId:donorId+':'+kind+':'+v.id,kind,type,value,primary:primary===true,startsOn,endsOn})
 }
 const seasons=contacts.filter(p=>p.active&&p.type==='seasonal')
 if(seasons.some((p,i)=>seasons.slice(i+1).some(other=>contactSeasonsOverlap({starts_on:p.startsOn,ends_on:p.endsOn},{starts_on:other.startsOn,ends_on:other.endsOn}))))error('Seasonal source addresses overlap; native address choice would be ambiguous.')
 return contacts
}

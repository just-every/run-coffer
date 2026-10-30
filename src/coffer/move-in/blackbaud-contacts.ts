import { CONTACT_TYPES } from '../contact-points'
import { fail } from '../db'
import type { ParsedContact } from './types'

type Row=Record<string,any>
const error=(message:string):never=>fail('SKY_CONTACTS',message+' Nothing was applied.',400)

/** API collections are not narrowed to the numbered spreadsheet column limit.
 * Native primaries always come from an explicit source flag, never list order. */
export function blackbaudContacts(points:Row[],kind:'email'|'phone'|'address',personId:string,types:Row):ParsedContact[] {
 if(points.some(p=>p.constituent_id!==personId||p.inactive||p.start||p.end||p.seasonal_start||p.seasonal_end))error('Inactive, dated or seasonal source contacts need a separately reviewed migration.')
 if(points.length&&points.filter(p=>kind==='address'?p.preferred:p.primary).length!==1)error('Every present contact kind needs exactly one explicit source primary.')
 const result=points.map(p=>{
  const type=types[kind+':'+p.type]
  if(typeof type!=='string'||!(CONTACT_TYPES[kind] as readonly string[]).includes(type)||type==='seasonal')error('Map each source contact type to a supported native type.')
  let value:string
  if(kind==='email') {
   if(typeof p.address!=='string')error('Every email needs its source value.')
   value=p.address.trim().toLowerCase()
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))error('Review invalid source email values.')
  } else if(kind==='phone') {
   if(typeof p.number!=='string'||!p.number.trim()||p.number.length>40)error('Review invalid source phone values.')
   value=p.number.trim()
  } else {
   if(typeof p.address_lines!=='string')error('Every address needs its source street.')
   const lines=p.address_lines.split(/\r?\n/)
   if(lines.length>2||!lines[0]||![p.city,p.state,p.postal_code].every(v=>typeof v==='string'&&v.trim()))error('Review source address lines, city, region and postal code.')
   value=JSON.stringify({line1:lines[0],line2:lines[1]||'',city:p.city,region:p.state,postalCode:p.postal_code,country:p.country||'United States'})
  }
  return {externalId:personId+':'+kind+':'+p.id,kind,type,value,primary:!!(kind==='address'?p.preferred:p.primary),startsOn:null,endsOn:null}
 })
 if(new Set(result.map(p=>p.value)).size!==result.length)error('Review repeated source contact values rather than importing duplicates.')
 return result
}

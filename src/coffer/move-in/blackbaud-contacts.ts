import { CONTACT_TYPES } from '../contact-points'
import { day } from './source-rows'
import { fail } from '../db'
import type { ParsedContact } from './types'

type Row=Record<string,any>
const error=(message:string):never=>fail('SKY_CONTACTS',message+' Nothing was applied.',400)

/** API collections are not narrowed to the numbered spreadsheet column limit.
 * Native primaries always come from an explicit source flag, never list order. */
export function blackbaudContacts(points:Row[],kind:'email'|'phone'|'address',personId:string,types:Row,importDay:string):ParsedContact[] {
 if(points.some(p=>p.constituent_id!==personId))error('A source contact belongs to a different constituent.')
 const sourceDate=(value:any)=>{if(!value)return '';const d=typeof value==='string'?value.slice(0,10):Number.isInteger(value.y)&&Number.isInteger(value.m)&&Number.isInteger(value.d)?`${value.y}-${String(value.m).padStart(2,'0')}-${String(value.d).padStart(2,'0')}`:'';if(!day(d))error('Review incomplete source contact dates.');return d}
 const active=(p:Row)=>!p.inactive&&(!p.start||sourceDate(p.start)<=importDay)&&(!p.end||sourceDate(p.end)>=importDay)
 const current=points.filter(active)
 if(current.length&&current.filter(p=>kind==='address'?p.preferred:p.primary).length!==1)error('Every present contact kind needs exactly one explicit source primary.')
 const result=points.map(p=>{
  const type=types[kind+':'+p.type]
  if(typeof type!=='string'||!(CONTACT_TYPES[kind] as readonly string[]).includes(type))error('Map each source contact type to a supported native type.')
  const startsOn=sourceDate(p.start),endsOn=sourceDate(p.end),isActive=active(p)
  if(startsOn&&endsOn&&endsOn<startsOn||isActive&&endsOn&&endsOn>importDay)error('Future source contact expiry needs a separately scheduled native migration; no future expiry is silently omitted.')
  const annual=(value:any)=>{const d=typeof value==='string'?value.slice(-5):value&&Number.isInteger(value.m)&&Number.isInteger(value.d)?`${String(value.m).padStart(2,'0')}-${String(value.d).padStart(2,'0')}`:'';if(!/^\d{2}-\d{2}$/.test(d)||!day('2000-'+d))error('Review complete annual seasonal address dates.');return d}
  if((p.seasonal_start||p.seasonal_end)&&type!=='seasonal')error('Seasonal source addresses need a seasonal native type mapping.')
  const seasonStart=type==='seasonal'?annual(p.seasonal_start):null,seasonEnd=type==='seasonal'?annual(p.seasonal_end):null
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
  return {externalId:personId+':'+kind+':'+p.id,kind,type,value,primary:!!(kind==='address'?p.preferred:p.primary),active:isActive,source:`re-nxt source ${kind} ${p.id}${startsOn?' · starts '+startsOn:''}${endsOn?' · ends '+endsOn:''}${p.inactive?' · source inactive':''}`,sourceOn:startsOn&&startsOn<=importDay?startsOn:undefined,startsOn:seasonStart,endsOn:seasonEnd}
 })
 const seasonal=result.filter(p=>p.active&&p.type==='seasonal')
 const within=(d:string,p:ParsedContact)=>p.startsOn!<=p.endsOn!?d>=p.startsOn!&&d<=p.endsOn!:d>=p.startsOn!||d<=p.endsOn!
 if(seasonal.length>1&&Array.from({length:366},(_,i)=>new Date(Date.UTC(2000,0,1+i)).toISOString().slice(5,10)).some(d=>seasonal.filter(p=>within(d,p)).length>1))error('Source seasonal address periods cannot overlap.')
 if(new Set(result.map(p=>p.value)).size!==result.length)error('Review repeated source contact values rather than importing duplicates.')
 return result
}

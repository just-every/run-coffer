import { CONTACT_TYPES } from '../contact-points'
import { SourceRow,day } from './source-rows'
import type { ParsedDonor, ParsedContact } from './types'

/** Numbered columns are an explicitly documented configurable CSV report shape,
 * not a claim about a vendor's default export. Original types and primaries are
 * validated before any native row is planned. */
export function sourceContacts(r:SourceRow,donor:ParsedDonor) {
 if(!['emailType','phoneType','addressType'].some(k=>r.has(k))&&!(['email','phone','address'] as const).some(kind=>r.contactIndices(kind).some(n=>n>1)))return
 const contacts:ParsedContact[]=[]
 for(const kind of ['email','phone','address'] as const){
  const points:ParsedContact[]=[]
  for(const index of [1,...r.contactIndices(kind).filter(n=>n>1)]){
   const key=index===1?kind:kind+index
   let value=''
   if(kind==='address'){
    const a=index===1?{line1:donor.addressLine1,line2:donor.addressLine2,city:donor.city,region:donor.region,postalCode:donor.postalCode,country:donor.country||'United States'}:{line1:r.get(key+'Line1'),line2:r.get(key+'Line2'),city:r.get(key+'City'),region:r.get(key+'Region'),postalCode:r.get(key+'PostalCode'),country:r.get(key+'Country')||'United States'}
    if(a.line1){if(!a.city||!a.region||!a.postalCode)r.error('CONTACT_ADDRESS','An imported postal address needs street, city, state and postal code.',key+'Line1');value=JSON.stringify(a)}
   }else value=(index===1?donor[kind]:r.get(key)).trim()
   const rawType=r.get(key+'Type').toLowerCase(),flag=r.get(key+'Primary').toLowerCase()
   const type=rawType||(kind==='email'?(index===1?'personal':index===2?'work':'other'):kind==='phone'?(index===1?'mobile':index===2?'home':'work'):index===1?'home':index===2?'vacation':'other')
   const startsOn=r.get(key+'From'),endsOn=r.get(key+'Through')
   if(!value){if(rawType||flag||startsOn||endsOn)r.error('CONTACT_VALUE','Contact metadata needs its contact value.',key);continue}
   if(!(CONTACT_TYPES[kind] as readonly string[]).includes(type))r.error('CONTACT_TYPE','Choose a supported '+kind+' type.',key+'Type')
   if(flag&&!['yes','no','true','false','1','0'].includes(flag))r.error('CONTACT_PRIMARY','Primary is Yes or No.',key+'Primary')
   if(kind==='email'){value=value.toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))r.error('EMAIL','Export one valid email per contact column.',key)}
   if(kind==='phone'&&value.length>40)r.error('CONTACT_PHONE','Phone values hold at most 40 characters.',key)
   if(type==='seasonal'){for(const bound of [startsOn,endsOn])if(!/^\d{2}-\d{2}$/.test(bound)||!day('2000-'+bound))r.error('CONTACT_SEASON','Seasonal bounds are real MM-DD dates.',key+'From')}
   else if(startsOn||endsOn)r.error('CONTACT_SEASON','Only seasonal addresses have annual bounds.',key+'From')
   points.push({externalId:donor.externalId+':'+key,kind,type,value,primary:['yes','true','1'].includes(flag),startsOn:type==='seasonal'?startsOn:null,endsOn:type==='seasonal'?endsOn:null})
  }
  if(points.filter(p=>p.primary).length>1)r.error('CONTACT_PRIMARY','Choose exactly one primary per contact kind.',kind+'Primary')
  if(points.length&&!points.some(p=>p.primary))points[0].primary=true
  if(new Set(points.map(p=>p.value)).size!==points.length)r.error('CONTACT_DUPLICATE','Repeated contact values must appear once per person.',kind)
  const primary=points.find(p=>p.primary)
  if(primary){if(kind!=='address')donor[kind]=primary.value;else {const a=JSON.parse(primary.value);Object.assign(donor,{addressLine1:a.line1,addressLine2:a.line2,city:a.city,region:a.region,postalCode:a.postalCode,country:a.country})}}
  const seasonal=points.filter(p=>p.type==='seasonal'&&p.startsOn&&p.endsOn)
  const within=(d:string,p:ParsedContact)=>p.startsOn!<=p.endsOn!?d>=p.startsOn!&&d<=p.endsOn!:d>=p.startsOn!||d<=p.endsOn!
  if(seasonal.length>1&&Array.from({length:366},(_,i)=>new Date(Date.UTC(2000,0,1+i)).toISOString().slice(5,10)).some(d=>seasonal.filter(p=>within(d,p)).length>1))r.error('CONTACT_SEASON','Seasonal contact ranges cannot overlap.',kind+'From')
  contacts.push(...points)
 }
 donor.contacts=contacts
}

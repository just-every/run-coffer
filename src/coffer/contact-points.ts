import { all, choice, commit, date, email, event, fail, guard, id, integer, newId, one, optional, sql, text, today, type Context, type Row, type Stmt } from './db'
import { settings } from './settings'
import { enteredAddress } from './addresses/entry'
import { addressMove, stageAddressMove } from './address-history'

export const CONTACT_TYPES={email:['personal','work','other'],phone:['mobile','home','work'],address:['home','work','vacation','seasonal','other']} as const
const current=(donorId:string,version:number)=>guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','VERSION','This donor changed. Refresh before editing contacts.',donorId,version,donorId)
export const contactPoints=(c:{db:D1Database},donorId:string)=>all(c,'SELECT * FROM cf_contact_points WHERE donor_id=? AND active=1 ORDER BY kind,is_primary DESC,id',donorId)
const annualDay=(v:unknown,label:string)=>{const value=text(v,label,5);date('2000-'+value,label);return value}
const inRange=(day:string,from:string,to:string)=>from<=to?day>=from&&day<=to:day>=from||day<=to
const intersects=(a:Row,b:Row)=>Array.from({length:366},(_,i)=>new Date(Date.UTC(2000,0,1+i)).toISOString().slice(5,10)).some(day=>inRange(day,a.starts_on,a.ends_on)&&inRange(day,b.starts_on,b.ends_on))
export async function contactCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(command!=='contact.save')return
 const donorId=id(p.donorId,'Donor'),donorVersion=integer(Number(p.donorVersion),'Donor version',1),donor=await one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL',donorId)
 if(!donor)fail('NOT_FOUND','Choose a current donor.',404)
 const existing=p.contactId?await one(c,'SELECT * FROM cf_contact_points WHERE id=? AND donor_id=? AND active=1',id(p.contactId,'Contact point'),donorId):null
 if(p.contactId&&!existing)fail('NOT_FOUND','Choose a contact on this donor.',404)
 const kind=choice(p.kind??existing?.kind,['email','phone','address'],'contact kind'),type=choice(p.type,CONTACT_TYPES[kind],'contact type')
 if(existing&&kind!==existing.kind)fail('INPUT','A contact point keeps its kind.',400)
 const source=text(p.source??'staff','Source',100),sourceOn=date(p.sourceOn??today((await settings(c)).timezone,new Date(c.now)),'Source date')
 if(sourceOn>today((await settings(c)).timezone,new Date(c.now)))fail('INPUT','Contact source date cannot be in the future.',400)
 let value:string,verified:Stmt[]=[]
 if(kind==='email')value=email(p.value)??fail('INPUT','Enter an email address.',400)
 else if(kind==='phone')value=text(p.value,'Phone',40)
 else {
  let a=p.value??{line1:p.addressLine1,line2:p.addressLine2,city:p.city,region:p.region,postalCode:p.postalCode,country:p.country};if(typeof a==='string'){try{a=JSON.parse(a)}catch{fail('INPUT','Address must be a JSON object.',400)}}
  if(!a||typeof a!=='object'||Array.isArray(a))fail('INPUT','Enter a postal address.',400)
  const address={line1:text(a.line1,'Address line 1'),line2:optional(a.line2,'Address line 2'),city:text(a.city,'City',100),region:text(a.region,'State',100),postalCode:text(a.postalCode,'ZIP code',20),country:optional(a.country,'Country',100)??'United States'}
  value=JSON.stringify(address)
 }
 const points=await contactPoints(c,donorId),primary=points.find(r=>r.kind===kind&&r.is_primary),makePrimary=p.primary===true||p.primary==='yes'||existing?.is_primary===1||!primary
 const startsOn=type==='seasonal'?annualDay(p.startsOn,'Season starts (MM-DD)'):null,endsOn=type==='seasonal'?annualDay(p.endsOn,'Season ends (MM-DD)'):null
 if(type==='seasonal'&&points.some(r=>r.type==='seasonal'&&r.id!==existing?.id&&intersects({starts_on:startsOn,ends_on:endsOn},r)))fail('INPUT','Seasonal address ranges cannot overlap.',400)
 if(kind==='email'&&await one(c,`SELECT 1 FROM cf_contact_points p JOIN cf_donors d ON d.id=p.donor_id WHERE p.kind='email' AND p.value=? AND p.active=1 AND d.erased_at IS NULL AND d.id<>? AND (? IS NULL OR d.household_id IS NULL OR d.household_id<>?) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`,value,donorId,donor.household_id,donor.household_id))fail('DUPLICATE_EMAIL','An unrelated record uses this email. Review duplicates; no contact was changed.',409)
 const contactId=existing?.id??newId(),version=existing?integer(Number(p.version),'Contact version',1):0,writes:Stmt[]=[]
 if(makePrimary&&primary&&primary.id!==contactId)writes.push(sql('UPDATE cf_contact_points SET is_primary=0,version=version+1,source=?,source_on=?,updated_at=? WHERE id=?',source,sourceOn,c.now,primary.id))
 if(existing)writes.push(guard('EXISTS(SELECT 1 FROM cf_contact_points WHERE id=? AND version=?)','VERSION','This contact changed.',contactId,version),sql('UPDATE cf_contact_points SET type=?,value=?,is_primary=?,starts_on=?,ends_on=?,version=version+1,source=?,source_on=?,updated_at=? WHERE id=?',type,value,makePrimary?1:0,startsOn,endsOn,source,sourceOn,c.now,contactId))
 else writes.push(sql('INSERT INTO cf_contact_points VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?)',contactId,donorId,kind,type,value,makePrimary?1:0,startsOn,endsOn,1,source,sourceOn,c.now))
 if(makePrimary){
  writes.push(sql('INSERT INTO cf_contact_edit VALUES(1)'))
  if(kind==='email'||kind==='phone')writes.push(sql(`UPDATE cf_donors SET ${kind}=? WHERE id=?`,value,donorId))
  else {
   await commit(c,[])
   const a=JSON.parse(value),entry=await enteredAddress(c,{...donor,address_line1:a.line1,address_line2:a.line2,city:a.city,region:a.region,postal_code:a.postalCode,country:a.country}),d=entry.donor
   // Postal verification is independent of NCOA campaign passes, following DONOR-009.
   value=JSON.stringify({line1:d.address_line1,line2:d.address_line2,city:d.city,region:d.region,postalCode:d.postal_code,country:d.country})
   // Keep one history revision: normalize before the point write executes.
   const point=writes.find(s=>s.sql.startsWith('INSERT INTO cf_contact_points'));if(point)point.params[4]=value
   const update=writes.find(s=>s.sql.startsWith('UPDATE cf_contact_points SET type='));if(update)update.params[1]=value
   writes.push(...stageAddressMove(donorId,await addressMove(c,null),'staff'),sql('UPDATE cf_donors SET address_line1=?,address_line2=?,city=?,region=?,postal_code=?,country=? WHERE id=?',d.address_line1,d.address_line2,d.city,d.region,d.postal_code,d.country,donorId),sql('DELETE FROM cf_address_moves WHERE donor_id=?',donorId),...entry.statements)
  }
  writes.push(sql('DELETE FROM cf_contact_edit'))
 }
 await commit(c,[current(donorId,donorVersion),...writes,sql('UPDATE cf_donors SET version=version+1 WHERE id=?',donorId),event(c,command,'contact',contactId,donorId,{kind,type,primary:makePrimary,version:version+1})])
 return {id:contactId,donorId,version:version+1,donorVersion:donorVersion+1}
}

/** A chosen type never silently chooses between two contact points. */
export async function selectedContacts(c:{db:D1Database},d:Row,options:{day?:string;emailType?:string;addressType?:string}={}){
 const points=await contactPoints(c,d.id),day=options.day??today((await settings(c)).timezone)
 const select=(kind:'email'|'address',type?:string)=>{
  if(type){const selected=points.filter(p=>p.kind===kind&&p.type===type);if(selected.length>1)fail('CONTACT_AMBIGUOUS','Choose a type with one contact point. Review this donor’s contacts.');return selected[0]??null}
  return kind==='address'?points.find(p=>p.kind===kind&&p.type==='seasonal'&&inRange(day.slice(5,10),p.starts_on,p.ends_on))??points.find(p=>p.kind===kind&&p.is_primary):points.find(p=>p.kind===kind&&p.is_primary)
 }
 const emailPoint=select('email',options.emailType),addressPoint=select('address',options.addressType),a=addressPoint?JSON.parse(addressPoint.value):null
 return {...d,...(emailPoint?{email:emailPoint.value}:{}),...(a?{address_line1:a.line1,address_line2:a.line2,city:a.city,region:a.region,postal_code:a.postalCode,country:a.country}:{}),selected_email_contact_id:emailPoint?.id??null,selected_address_contact_id:addressPoint?.id??null}
}

/** Search values, never JSON property names, through every current contact point. */
export function contactSearchSql(donor:string,pattern:string){return `EXISTS(SELECT 1 FROM cf_contact_points cp WHERE cp.donor_id=${donor} AND cp.active=1 AND lower(CASE WHEN cp.kind='address' THEN COALESCE(json_extract(cp.value,'$.line1'),'')||' '||COALESCE(json_extract(cp.value,'$.line2'),'')||' '||COALESCE(json_extract(cp.value,'$.city'),'')||' '||COALESCE(json_extract(cp.value,'$.region'),'')||' '||COALESCE(json_extract(cp.value,'$.postalCode'),'')||' '||COALESCE(json_extract(cp.value,'$.country'),'') ELSE cp.value END) LIKE ${pattern} ESCAPE char(92))`}

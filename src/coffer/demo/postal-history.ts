import { all, type Row } from '../db'
import { frozenNameFields } from '../person-names'
import { letterRecipient } from '../organizations'

/** Seed the pantry's recorded postal history, not a new mailing or a provider
 * verification. Pending historical mail deliberately has no check snapshots:
 * the ordinary approval/export guards hold it until staff rebuild the run. */
export async function postalHistory(db:D1Database,segment:{givenSince:string|null;minTotalCents:number}) {
 const c={db},rows=await all(c,`SELECT d.*,k.id AS consent_id,k.status AS consent,
 (SELECT COALESCE(SUM(amount_cents),0) FROM cf_gifts g WHERE g.donor_id=d.id) AS total_cents,
 (SELECT COUNT(*) FROM cf_gift_balances g WHERE g.donor_id=d.id AND net_cents>0) AS gift_count,
 (SELECT MAX(received_on) FROM cf_gift_balances g WHERE g.donor_id=d.id AND net_cents>0) AS last_gift
 FROM cf_donors d LEFT JOIN cf_consents k ON k.id=(SELECT id FROM cf_consents WHERE donor_id=d.id AND channel='mail' ORDER BY id DESC LIMIT 1)
 WHERE d.erased_at IS NULL AND (? IS NULL OR (SELECT COALESCE(SUM(amount_cents),0) FROM cf_gifts g WHERE g.donor_id=d.id AND g.received_on>=?)>=?)
 ORDER BY lower(d.name),d.id`,segment.givenSince,segment.givenSince,Math.max(1,segment.minTotalCents))
 const excluded:Record<string,number>={'no consent recorded':0,'consent withdrawn':0,'no email address':0,'no postal address':0},recipients:Row[]=[]
 for(const d of rows){
  if(!d.consent)excluded['no consent recorded']++
  else if(d.consent!=='granted')excluded['consent withdrawn']++
  else if(!d.address_line1||!d.city||!d.postal_code)excluded['no postal address']++
  else recipients.push({donor_id:d.id,consent_id:d.consent_id,name:d.name,name_fields:frozenNameFields(await letterRecipient(c,d)),total_cents:d.total_cents,gift_count:d.gift_count,last_gift:d.last_gift,email:null,address:JSON.stringify({line1:d.address_line1,line2:d.address_line2,city:d.city,region:d.region,postalCode:d.postal_code,country:d.country})})
 }
 return {recipients,excluded}
}

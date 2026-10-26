import { commit, event, fail, guard, id, integer, one, sql, today, type Context, type Row } from '../db'
import { requireRole } from '../auth'
import { stageAddressMove } from '../address-history'
import { settings } from '../settings'
import { verifySmartyAddress } from './providers/smarty.server'
import { addressFingerprint, addressProcessing, checkStatement, postalAddress } from './state'

/** Enabling the provider is explicit. An unavailable provider never fabricates
 * a verification or replaces the address a person entered. */
export async function enteredAddress(c:Context,donor:Row) {
 const processing=await addressProcessing(c)
 if(c.transactionPlan){
  if(processing.enabled)fail('API_PROVIDER_EFFECT','Use native donor entry while address processing is enabled.',409)
  c.transactionPlan.statements.push(guard('NOT EXISTS(SELECT 1 FROM cf_address_processing WHERE enabled=1)','ADDRESS_CONNECTION_CHANGED','Address processing changed; use native donor entry.'))
  return {donor,statements:[]}
 }
 if(!processing.enabled)return {donor,statements:[]}
 const result=await verifySmartyAddress({address:postalAddress(donor),identity:{id:donor.id,name:donor.name,kind:donor.constituent_kind??'person'},authId:c.env?.SMARTY_AUTH_ID??'',authToken:c.env?.SMARTY_AUTH_TOKEN??''})
 if(result.status==='error')fail('ADDRESS_PROVIDER','Smarty could not verify this address. Nothing was saved; retry after checking the connection.',502)
 const replacement=result.address
 const normalized=replacement?{...donor,address_line1:replacement.street,address_line2:replacement.street2??null,city:replacement.city,region:replacement.state,postal_code:replacement.postalCode,country:replacement.country}:donor
 return {donor:normalized,statements:[guard('EXISTS(SELECT 1 FROM cf_address_processing WHERE id=1 AND enabled=1 AND version=?)','ADDRESS_CONNECTION_CHANGED','Address processing changed; refresh before saving.',processing.version),checkStatement(donor.id,await addressFingerprint(normalized),result,c.now),event(c,'address.verify','donor',donor.id,donor.id,{status:result.status,source:'smarty'})]}
}
export async function verifyExistingAddress(c:Context,p:Row) {
 requireRole(c.actor,['owner','admin','member'],'verify an address')
 const donorId=id(p.donorId,'Donor'),version=integer(Number(p.version),'Version',1)
 const d=await one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id)',donorId)
 if(!d)fail('NOT_FOUND','Choose a current donor.',404)
 if(d.version!==version)fail('VERSION','The donor changed. Refresh before verifying.')
 if(!(await addressProcessing(c)).enabled)fail('ADDRESS_NOT_CONNECTED','An owner must enable address processing first.')
 await commit(c,[])
 const checked=await enteredAddress(c,d),a=checked.donor,day=today((await settings(c)).timezone,new Date(c.now))
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','VERSION','The donor changed during verification. Refresh and verify again.',donorId,version,donorId),...stageAddressMove(donorId,day,'smarty'),sql('UPDATE cf_donors SET version=version+1,address_line1=?,address_line2=?,city=?,region=?,postal_code=?,country=? WHERE id=?',a.address_line1,a.address_line2,a.city,a.region,a.postal_code,a.country,donorId),sql('DELETE FROM cf_address_moves WHERE donor_id=?',donorId),...checked.statements])
 return {id:donorId,version:version+1}
}

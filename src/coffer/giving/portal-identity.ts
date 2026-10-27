import { commit, fail, one, sha256 } from '../db'
import type { GivingEnv } from './stripe'

export type PortalDonor={id:string;name:string;email:string|null;sessionHash:string}
// A shared mailbox cannot distinguish household members. Neither headship nor
// membership grants portal access to another person's financial history.
export const uniquePortalEmail=`(SELECT count(DISTINCT x.id) FROM cf_donors x WHERE x.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=x.id) AND (x.email=? OR EXISTS(SELECT 1 FROM cf_contact_points p WHERE p.donor_id=x.id AND p.kind='email' AND p.active=1 AND p.value=?)))=1`
export async function portalContext(env:GivingEnv,donor:PortalDonor){
 if(!donor.email||!await one({db:env.DB},`SELECT 1 WHERE ${uniquePortalEmail}`,donor.email,donor.email))fail('portal_identity_ambiguous','Please ask the organization for help. This email address does not identify one current donor.',403)
 const now=Date.now(),hash=await sha256(donor.email)
 const c={db:env.DB,now:new Date(now).toISOString(),actor:{id:'donor:'+donor.id,name:'Authenticated donor portal',role:'donor' as const},authority:{sql:`EXISTS(SELECT 1 FROM cf_donor_tokens t JOIN cf_donors d ON d.id=t.donor_id WHERE t.token_hash=? AND t.email_hash=? AND t.donor_id=? AND t.kind='session' AND t.used_at IS NULL AND t.expires_at>? AND d.erased_at IS NULL AND d.constituent_status='active' AND d.email=? AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)) AND ${uniquePortalEmail}`,params:[donor.sessionHash,hash,donor.id,now,donor.email,donor.email,donor.email]}}
 await commit(c,[])
 return c
}

import { all, fail, guard, one, sql, type Context, type Row, type Stmt } from '../db'
import { queueNcoa } from './commands'
import { addressFingerprint, addressProcessing } from './state'

/** Existing installations opt into the connected address-processing workflow.
 * The contract gap explicitly retains the older unverified export path until
 * rollout policy is settled; an enabled installation cannot bypass this gate. */
export async function mailPreflight(c:Context) {
 const connection=await addressProcessing(c)
 if(!connection.enabled)return null
 const pass=await one(c,"SELECT * FROM cf_ncoa_runs WHERE state='completed' AND consumed_appeal_id IS NULL AND connection_version=? ORDER BY completed_at DESC,id LIMIT 1",connection.version)
 if(pass)return pass
 const queued=await queueNcoa(c)
 fail('NCOA_PENDING','An address pass is queued. The scheduler processes it before this mailing; return to Addresses to review its results, then prepare the appeal.',409,{runId:queued.id})
}
export async function mailEligibility(c:{db:D1Database},donors:Row[]) {
 const result=new Map<string,{reason:string;check?:Row}>()
 if(!(await addressProcessing(c)).enabled)return result
 const checks=await all(c,'SELECT * FROM cf_address_checks WHERE donor_id IN(SELECT value FROM json_each(?))',JSON.stringify(donors.map(d=>d.id))),byId=new Map(checks.map(r=>[r.donor_id,r]))
 for(const donor of donors){
  const check=byId.get(donor.id)
  if(!check||check.fingerprint!==await addressFingerprint(donor))result.set(donor.id,{reason:'address not verified'})
  else if(check.status==='undeliverable')result.set(donor.id,{reason:'undeliverable address',check})
  else if(check.status!=='verified')result.set(donor.id,{reason:'address not verified',check})
 }
 return result
}
export async function mailSnapshot(c:Context,appealId:string,pass:Row|null,recipients:Row[]):Promise<Stmt[]> {
 if(!pass)return []
 const ids=JSON.stringify(recipients.map(r=>r.donor_id))
 const checks=await all(c,'SELECT s.*,m.fingerprint AS processed_fingerprint FROM cf_address_checks s JOIN cf_ncoa_members m ON m.donor_id=s.donor_id AND m.run_id=? WHERE s.donor_id IN(SELECT value FROM json_each(?))',pass.id,ids)
 if(checks.length!==recipients.length||checks.some(s=>s.status!=='verified'||s.processed_fingerprint!==s.fingerprint))fail('NCOA_STALE','A recipient changed or has no verified result in this pass. Prepare another address pass.')
 return [guard("EXISTS(SELECT 1 FROM cf_ncoa_runs r JOIN cf_address_processing p ON p.id=1 AND p.enabled=1 AND p.version=r.connection_version WHERE r.id=? AND r.state='completed' AND r.consumed_appeal_id IS NULL)",'NCOA_STALE','This address pass changed or was used by another mailing. Prepare another pass.',pass.id),
 sql('UPDATE cf_ncoa_runs SET consumed_appeal_id=? WHERE id=?',appealId,pass.id),
 ...checks.map(s=>sql('INSERT INTO cf_mail_address_snapshots VALUES(?,?,?,?,?)',appealId,s.donor_id,s.fingerprint,s.version,pass.id)),
 ...mailRunGuards(appealId)]
}
/** Snapshot-bearing mailings continue to check custody even after a connection
 * is disabled, rather than silently falling back to older unchecked exports. */
export function mailRunGuards(appealId:string):Stmt[] {
 return [guard(`NOT EXISTS(SELECT 1 FROM cf_mail_address_snapshots s LEFT JOIN cf_address_checks c ON c.donor_id=s.donor_id WHERE s.appeal_id=? AND (c.donor_id IS NULL OR c.status<>'verified' OR c.version<>s.check_version OR c.fingerprint<>s.fingerprint)) AND (NOT EXISTS(SELECT 1 FROM cf_mail_address_snapshots WHERE appeal_id=?) OR EXISTS(SELECT 1 FROM cf_address_processing WHERE id=1 AND enabled=1))`,'ADDRESS_CHANGED','A recipient address or verification changed. Discard the mailing and prepare a new address pass.',appealId,appealId)]
}
export async function mailAddressChanged(c:{db:D1Database},appealId:string) {
 return Boolean(await one(c,`SELECT 1 FROM cf_mail_address_snapshots s LEFT JOIN cf_address_checks c ON c.donor_id=s.donor_id WHERE s.appeal_id=? AND (c.donor_id IS NULL OR c.status<>'verified' OR c.version<>s.check_version OR c.fingerprint<>s.fingerprint) LIMIT 1`,appealId))
}

import { all, fail, guard, one, sql, type Context, type Row, type Stmt } from '../db'
import { queueNcoa } from './commands'
import { addressFingerprint, addressProcessing } from './state'

/** Every new postal audience requires the reviewed connection and a completed pass. */
export async function mailPreflight(c:Context) {
 const connection=await addressProcessing(c)
 if(!connection.enabled)fail('NCOA_NOT_CONNECTED','An owner or admin must connect and authorize address processing in Addresses before preparing postal mail.',409)
 const pass=await one(c,"SELECT * FROM cf_ncoa_runs WHERE state='completed' AND consumed_appeal_id IS NULL AND connection_version=? ORDER BY completed_at DESC,id LIMIT 1",connection.version)
 if(pass){if(!Number.isFinite(Date.parse(pass.completed_at))||pass.completed_at<cutoff(c)||pass.completed_at>c.now)fail('NCOA_STALE','This address pass is older than 95 days. Prepare another pass before this appeal.',409);return pass}
 const queued=await queueNcoa(c)
 fail('NCOA_PENDING','An address pass is queued. The scheduler processes it before this mailing; return to Addresses to review its results, then prepare the appeal.',409,{runId:queued.id})
}
export async function mailEligibility(c:{db:D1Database},donors:Row[]) {
 const result=new Map<string,{reason:string;check?:Row}>()
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
 ...mailRunGuards(c,appealId)]
}
/** Email is unaffected. Postal runs, including older prepared runs without
 * verification snapshots, must be rebuilt before approval or first export. */
const MAIL_VALID=`NOT EXISTS(SELECT 1 FROM cf_appeals a WHERE a.id=? AND a.channel='mail' AND (
 NOT EXISTS(SELECT 1 FROM cf_address_processing WHERE id=1 AND enabled=1)
 OR (SELECT COUNT(*) FROM cf_mail_address_snapshots WHERE appeal_id=a.id)<>a.recipients
 OR EXISTS(SELECT 1 FROM cf_appeal_recipients r LEFT JOIN cf_mail_address_snapshots s ON s.appeal_id=r.appeal_id AND s.donor_id=r.donor_id LEFT JOIN cf_address_checks c ON c.donor_id=s.donor_id WHERE r.appeal_id=a.id AND (s.donor_id IS NULL OR c.donor_id IS NULL OR c.status<>'verified' OR c.version<>s.check_version OR c.fingerprint<>s.fingerprint))
))`
const cutoff=(c:{now?:string})=>new Date(Date.parse(c.now??new Date().toISOString())-95*86400000).toISOString()
const PASS_VALID=`NOT EXISTS(SELECT 1 FROM cf_appeals a WHERE a.id=? AND a.channel='mail' AND EXISTS(SELECT 1 FROM cf_mail_address_snapshots s WHERE s.appeal_id=a.id AND NOT EXISTS(SELECT 1 FROM cf_ncoa_runs r JOIN cf_address_processing p ON p.id=1 WHERE r.id=s.ncoa_run_id AND r.state='completed' AND r.consumed_appeal_id=a.id AND r.connection_version=p.version AND r.completed_at>=? AND r.completed_at<=?)))`
export function mailRunGuards(c:{now?:string},appealId:string):Stmt[] {
 return [guard(PASS_VALID,'NCOA_STALE','This mailing needs a pass completed no more than 95 days before export. Prepare another pass.',appealId,cutoff(c),c.now??new Date().toISOString()),guard(MAIL_VALID,'ADDRESS_CHANGED','This mailing needs current address verification. Discard it and prepare a new address pass.',appealId)]
}
export async function mailAddressChanged(c:{db:D1Database;now?:string},appealId:string) {
 return !Boolean(await one(c,`SELECT 1 WHERE ${MAIL_VALID} AND ${PASS_VALID}`,appealId,appealId,cutoff(c),c.now??new Date().toISOString()))
}

import { addressFingerprint } from './addresses/state'
import { one, type Row } from './db'

/** Informational receipt review only: it never queues or waits on processing. */
export async function postalReview(c:{db:D1Database},donor:Row):Promise<'verified'|'unverified'>{
 const check=await one(c,'SELECT status,fingerprint FROM cf_address_checks WHERE donor_id=?',donor.id)
 return donor.address_line1&&check?.status==='verified'&&check.fingerprint===await addressFingerprint(donor)?'verified':'unverified'
}

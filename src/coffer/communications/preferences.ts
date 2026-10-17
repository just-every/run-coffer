import { all, commit, event, fail, one, sql, type Context, type Row } from '../db'
import { settings } from '../settings'
import { communicationsUnavailable, providerLabel, providerContact, captureProviderConsent, restricted, subscribed, suppressProvider } from './provider'

export async function reconcileDonor(c: Context, donorId: string, capture = false): Promise<Row> {
 const donor = await one(c, `SELECT d.*,k.id AS consent_id,k.status AS consent,k.evidence,k.captured_on FROM cf_donors d
 LEFT JOIN cf_consents k ON k.id=(SELECT id FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1)
 WHERE d.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`, donorId)
 if (!donor?.email) return { state:'no-address', allowed:false }
 const label=providerLabel(c.env)
 const unavailable = communicationsUnavailable(c.env)
 if (unavailable) fail('MANGO_UNAVAILABLE', unavailable, 503)
 let contact = await providerContact(c.env, donor.email)
 let state = 'pending', note = 'Confirm the donor’s subscription with the email provider before sending.'
 if (contact && restricted(contact) && donor.consent === 'granted') {
  // Never turn a provider opt-out into a grant, or overwrite a newer answer.
  await commit(c, [sql(`INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by)
   SELECT ?,'email','withdrawn','other',?,?,?,? WHERE
   (SELECT id FROM cf_consents WHERE donor_id=? AND channel='email' ORDER BY id DESC LIMIT 1)=?`, donor.id, `Unsubscribe or suppression recorded by ${label}`, c.now.slice(0,10), c.now, `${label} preference sync`, donor.id, donor.consent_id),
   event(c, 'marketing.unsubscribe', 'donor', donor.id, donor.id, { provider:label.toLowerCase() })])
  state = 'suppressed'; note = `${label}’s opt-out is recorded in Coffer.`
 } else if (donor.consent === 'withdrawn') {
  if (!contact || !restricted(contact)) await suppressProvider(c.env, donor.email)
  state = 'suppressed'; note = `${label} confirmed this email opt-out.`
 } else if (donor.consent !== 'granted') {
  state = 'no-consent'; note = 'No email consent is recorded in Coffer.'
 } else if (subscribed(contact)) {
  state = 'subscribed'; note = `Coffer consent and ${label} subscription agree.`
 } else if (!contact && capture) {
  const s = await settings(c)
  contact = await captureProviderConsent(c.env,donor,s.organisation)
  note = `${label} requires the donor’s confirmation. No appeal was sent.`
 }
 await commit(c, [sql(`INSERT INTO cf_preference_sync(donor_id,email,consent_id,remote_status,state,checked_at,note) VALUES(?,?,?,?,?,?,?)
 ON CONFLICT(donor_id) DO UPDATE SET email=excluded.email,consent_id=excluded.consent_id,remote_status=excluded.remote_status,state=excluded.state,checked_at=excluded.checked_at,note=excluded.note`,
 donor.id,donor.email,donor.consent_id,contact?.emailStatus ?? contact?.email_status ?? null,state,c.now,note)])
 return { state, allowed:state==='subscribed', note }
}
export async function syncPreferences(c: Context, donorIds?: string[]): Promise<Row> {
 const unavailable = communicationsUnavailable(c.env)
 if (unavailable) return { unavailable, synced:0 }
 const donors = await all(c, `SELECT d.id FROM cf_donors d LEFT JOIN cf_preference_sync p ON p.donor_id=d.id
 WHERE d.erased_at IS NULL AND d.email IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
 AND (? IS NULL OR d.id IN (SELECT value FROM json_each(?))) ORDER BY COALESCE(p.checked_at,''),d.id LIMIT 8`,donorIds?JSON.stringify(donorIds):null,donorIds?JSON.stringify(donorIds):null)
 let synced=0,pending=0
 for (const donor of donors) {
  try { await reconcileDonor(c,donor.id); synced++ } catch {
   pending++
   await commit(c,[sql(`INSERT INTO cf_preference_sync(donor_id,email,state,checked_at,note) SELECT id,email,'pending',?,'The email provider could not confirm preferences. Sending remains blocked until a successful check.' FROM cf_donors WHERE id=?
    ON CONFLICT(donor_id) DO UPDATE SET state='pending',checked_at=excluded.checked_at,note=excluded.note`,c.now,donor.id)])
  }
 }
 return { synced,pending }
}
export const preferenceState = (c: Context) => all(c, `SELECT p.*,d.name FROM cf_preference_sync p JOIN cf_donors d ON d.id=p.donor_id ORDER BY p.checked_at DESC LIMIT 50`)

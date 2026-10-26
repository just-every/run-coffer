import { requireRole } from './auth'
import { commit, event, fail, guard, id, integer, sql, type Context, type Row } from './db'

/** Release only the API-origin hold. Native reminder and follow-up eligibility
 * still decides whether any later run may contact this donor. */
export async function releasePledgeEmail(c: Context, p: Row): Promise<Row> {
 requireRole(c.actor, ['owner', 'admin'], 'release pledge email')
 if (c.actor.apiKey) fail('FORBIDDEN', 'Review pledge email in a native session.', 403)
 if (p.reviewed !== true && p.reviewed !== 'yes') fail('REVIEW_REQUIRED', 'Review this pledge, its schedule and current reminder wording before releasing email.', 400)
 const pledgeId = id(p.pledgeId, 'Pledge'), donorId = id(p.donorId, 'Donor')
 const version = integer(Number(p.version), 'Pledge version', 1)
 const donorVersion = integer(Number(p.donorVersion), 'Donor version', 1)
 const templateVersion = integer(Number(p.templateVersion), 'Reminder wording version', 1)
 const settingsVersion = integer(Number(p.settingsVersion), 'Organization version', 1)
 await commit(c, [
  guard(`EXISTS(SELECT 1 FROM cf_pledges p JOIN cf_donors d ON d.id=p.donor_id
   WHERE p.id=? AND p.donor_id=? AND p.version=? AND p.api_review_required=1
   AND d.version=? AND d.erased_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`,
   'VERSION', 'The pledge or donor changed, or this hold was already released. Open the current pledge and review again.', pledgeId, donorId, version, donorVersion),
  guard('EXISTS(SELECT 1 FROM cf_pledge_template WHERE id=1 AND version=?) AND EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)',
   'VERSION', 'Reminder wording or organization settings changed. Open the current pledge and review again.', templateVersion, settingsVersion),
  sql('UPDATE cf_pledges SET api_review_required=0,version=version+1 WHERE id=?', pledgeId),
  event(c, 'pledge.releaseEmail', 'pledge', pledgeId, donorId, { version, donorVersion, templateVersion, settingsVersion }),
 ])
 return { id: pledgeId, version: version + 1, api_review_required: false }
}

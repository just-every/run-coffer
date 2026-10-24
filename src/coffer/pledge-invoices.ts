import { pledgePaymentLink } from './pledge-checkout'
import { fail, id, one, today, type Context } from './db'
import { letterRecipient } from './organizations'
import { pledgeHistory } from './pledges'
import { settings } from './settings'

/** A live printable balance request, using the same projections as the donor
 * page. Preparing it never creates a gift, receipt or delivery claim. */
export async function pledgeInvoice(c: Context, pledgeId: string) {
 const pledge = await one(c, `SELECT p.donor_id FROM cf_pledges p JOIN cf_donors d ON d.id=p.donor_id
  WHERE p.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`, id(pledgeId, 'Pledge'))
 if (!pledge) fail('NOT_FOUND', 'That pledge does not exist on a current donor record.', 404)
 const [s, donor, pledges] = await Promise.all([settings(c), one(c, 'SELECT * FROM cf_donors WHERE id=?', pledge.donor_id), pledgeHistory(c, pledge.donor_id)])
 const current = pledges.find(p => p.id === pledgeId)!
 const paymentLinks=Object.fromEntries(await Promise.all(current.installments.filter((i:any)=>i.remaining_cents>0).map(async(i:any)=>[i.id,await pledgePaymentLink(c.env,i.id,new Date(c.now))])))
 return { paymentLinks, organization: s.organisation, day: today(s.timezone, new Date(c.now)), recipient: await letterRecipient(c, donor!), pledge: current }
}

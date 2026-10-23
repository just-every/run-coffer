import { all, commit, event, fail, guard, one } from '../db'
import { inKindAcknowledgment } from '../in-kind'
import { receiptNumber } from '../receipt-format'
import { box, e } from '../ui/common'
import { portalContext, type PortalDonor } from './portal-identity'
import type { GivingEnv } from './stripe'

/** Noncash property stays separate from monetary gifts and deductible totals.
 * Its own approved acknowledgment describes property without assigning value. */
export async function propertyHistory(env:GivingEnv,donor:PortalDonor){
 const c=await portalContext(env,donor)
 const [gifts,acks]=await Promise.all([
  all(c,'SELECT id,description,quantity,received_on FROM cf_in_kind_current WHERE donor_id=? ORDER BY received_on DESC,id',donor.id),
  all(c,'SELECT a.* FROM cf_in_kind_acknowledgments a JOIN cf_in_kind_gifts g ON g.id=a.in_kind_id WHERE g.donor_id=? ORDER BY a.created_at,a.id',donor.id),
 ])
 if(!gifts.length)return ''
 return box('Your property gifts',`<ul class="list">${gifts.map(g=>`<li>${e(g.received_on)} · ${e(g.description)} · quantity ${e(g.quantity)}${acks.filter(a=>a.in_kind_id===g.id).map(a=>a.void_reason?'<p>An earlier acknowledgment is void; a replacement needs the organization’s approval.</p>':`<p><a href="/giving/portal/property?ack=${encodeURIComponent(a.id)}" download>Download property acknowledgment ${e(receiptNumber(a))}</a></p>`).join('')}</li>`).join('')}</ul><p>Property is kept separate from cash giving and deductible totals. Its acknowledgment makes no appraisal or property-value claim.</p>`)
}
export async function downloadProperty(env:GivingEnv,donor:PortalDonor,acknowledgmentId:string){
 const c=await portalContext(env,donor),ack=await one(c,'SELECT a.* FROM cf_in_kind_acknowledgments a JOIN cf_in_kind_gifts g ON g.id=a.in_kind_id WHERE a.id=? AND g.donor_id=?',acknowledgmentId,donor.id)
 if(!ack)fail('not_found','That acknowledgment is not available on your account.',404)
 if(ack.void_reason)fail('VOID_RECEIPT','This acknowledgment is void. Contact the organization for an approved correction.',409)
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_in_kind_acknowledgments a JOIN cf_in_kind_gifts g ON g.id=a.in_kind_id WHERE a.id=? AND g.donor_id=? AND a.property_version=g.property_version AND a.void_reason IS NULL)','PROPERTY_CHANGED','This property acknowledgment needs a corrected approved copy.',ack.id,donor.id),event(c,'portal.documentDownloaded','property_acknowledgment',ack.id,donor.id,{kind:'property',receiptNumber:receiptNumber(ack)})])
 return inKindAcknowledgment(c,ack.id)
}

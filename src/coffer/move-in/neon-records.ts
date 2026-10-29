import { SourceRow } from './source-rows'
import type { ParsedImport } from './types'

/** A historical membership does not enable renewal or authorize a future charge. */
export function neonMembershipRow(r:SourceRow,out:ParsedImport) {
 if(out.source!=='neon'||!r.peek('membershipId'))return false
 const externalId=r.required('membershipId'),donorExternalId=r.required('donorId'),levelId=r.required('membershipLevelId'),levelName=r.required('membershipLevel'),termName=r.get('membershipTerm')
 const startsOn=r.date('membershipStarts'),endsOn=r.peek('membershipEnds')?r.date('membershipEnds'):null,status=r.required('membershipStatus'),feeCents=r.cents('membershipFee',true),giftExternalId=r.get('membershipGift')||null
 const auto=r.get('membershipAuto'),active=r.get('membershipActive')
 if(!['true','false'].includes(auto)||!['true','false'].includes(active))r.error('NEON_MEMBERSHIP','Source membership flags must be explicitly true or false.')
 if(endsOn&&endsOn<startsOn)r.error('NEON_MEMBERSHIP','The membership end precedes its start.')
 if(!['SUCCEEDED','FAILED','PENDING','CANCELED','WAITINGLIST','CANCEL_PENDING','DEFERRED','REFUNDED'].includes(status))r.error('NEON_MEMBERSHIP','Review the source membership status.')
 if(feeCents!==null)(out.memberships??=[]).push({location:r.location,externalId,donorExternalId,levelId,levelName,termName,startsOn,endsOn,status,feeCents,giftExternalId,sourceAutoRenewal:auto==='true',sourceActive:active==='true'})
 r.finish();return true
}

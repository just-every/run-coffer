import type { SourceRow } from './source-rows'
import type { ParsedImport } from './types'

/** Explicit source write-offs reduce promises, never received cash. */
export function neonPledgeAdjustmentRow(r:SourceRow,out:ParsedImport) {
 if(out.source!=='neon'||!r.peek('pledgeAdjustmentId'))return false
 const externalId=r.required('pledgeAdjustmentId'),donorExternalId=r.required('donorId'),pledgeExternalId=r.required('pledgeId'),installmentExternalId=r.required('installmentId'),on=r.date('adjustmentOn'),reason=r.required('adjustmentReason'),amountCents=r.cents('adjustmentAmount')
 if(amountCents!==null)(out.pledgeAdjustments??=[]).push({location:r.location,externalId,donorExternalId,pledgeExternalId,installmentExternalId,on,reason,amountCents})
 r.finish();return true
}

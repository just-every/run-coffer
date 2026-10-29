import { SourceRow } from './source-rows'
import type { ParsedImport } from './types'

export function neonEventRow(r:SourceRow,out:ParsedImport) {
 if(out.source!=='neon'||!r.peek('sourceEventId'))return false
 if(r.peek('sourceGuestId')){
  const attended=r.required('sourceAttended')
  if(!['true','false','unknown'].includes(attended))r.error('NEON_EVENT','Attendance must be explicit in the source; no check-in is inferred.')
  ;(out.eventGuests??=[]).push({location:r.location,externalId:r.required('sourceGuestId'),eventExternalId:r.required('sourceEventId'),donorExternalId:r.required('donorId'),attendeeExternalId:r.get('sourceAttendeeAccount')||null,giftExternalId:r.get('sourceEventGift')||null,registrationId:r.required('sourceRegistration'),ticketName:r.required('sourceTicket'),name:r.required('sourceAttendeeName'),email:r.get('sourceAttendeeEmail')||null,attended:attended==='unknown'?null:attended==='true',status:r.required('sourceRegistrationStatus')})
 }else (out.sourceEvents??=[]).push({location:r.location,externalId:r.required('sourceEventId'),name:r.required('sourceEventName'),startsOn:r.date('sourceEventStarts')})
 r.finish();return true
}

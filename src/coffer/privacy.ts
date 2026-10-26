/** Attendance contains personal attendee details, not financial ledger lines.
 * Remove linked registrations before deleting the donor; giving intents can
 * also identify a registration that has not yet acquired its donor reference. */
export function eventRegistrationErasureStatements(donorId: string, placeholderId: string, emails:string[]=[]) {
 return [{
  sql: `DELETE FROM cf_event_registrations WHERE donor_id=?
   OR (donor_id IS NULL AND lower(attendee_email) IN (SELECT lower(value) FROM json_each(?)))
   OR (is_buyer=1 AND intent_id IN (SELECT id FROM cf_giving_intents WHERE donor_id IN (?,?)))`,
  params: [donorId,JSON.stringify(emails),donorId,placeholderId],
 }]
}

/** Attendance contains personal attendee details, not financial ledger lines.
 * Remove linked registrations before deleting the donor; giving intents can
 * also identify a registration that has not yet acquired its donor reference. */
export function eventRegistrationErasureStatements(donorId: string, placeholderId: string) {
 return [{
  sql: `DELETE FROM cf_event_registrations WHERE donor_id=? OR intent_id IN
   (SELECT id FROM cf_giving_intents WHERE donor_id IN (?,?))`,
  params: [donorId, donorId, placeholderId],
 }]
}

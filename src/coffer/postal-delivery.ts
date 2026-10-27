import { ackMailPieceGuard, ackMailPieces, printableAckPieces } from './ack-mail-pieces'
import { batchLetters, currentLetterGifts, letterHash } from './acknowledgements'
import { manager } from './auth'
import { all, commit, event, fail, guard, id, integer, newId, one, sql, today, type Context, type Row, type Stmt } from './db'
import { postalAcknowledgments, postalOutcome } from './postal-acceptance'
import { postalAvailable, postalFile, postalRecipient, submitPostal } from './postal-provider'
import { settings } from './settings'

export { postalEvents } from './postal-events'
export { postalAvailable } from './postal-provider'

export async function postalSummary(c: Pick<Context, 'db'>, batchId: string) {
 return all(c, `SELECT p.*,count(d.letter_id) AS documents FROM cf_postal_deliveries p
  JOIN cf_postal_documents d ON d.delivery_id=p.id WHERE p.batch_id=? GROUP BY p.id ORDER BY p.requested_at,p.id`, batchId)
}

/** Explicit human authorization for the exact approved batch and postage. */
export async function postalCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'ack.sendPostal') return undefined
 if (!manager(c.actor)) fail('FORBIDDEN', 'Only the owner or an admin authorizes postal spending.', 403)
 const batchId = id(p.batchId, 'Batch'), version = integer(Number(p.version), 'Version', 1)
 const batch = await one(c, 'SELECT * FROM cf_ack_batches WHERE id=?', batchId)
 if (!batch) fail('NOT_FOUND', 'That letter batch does not exist.', 404)
 if (batch.version !== version) fail('VERSION', 'This batch changed. Refresh before mailing.')
 if (!['approved', 'exported'].includes(batch.status)) fail('NOT_APPROVED', 'Approve the exact letters before authorizing postal spending.')
 if (p.approvePostage !== true || p.contentHash !== batch.content_hash) fail('POSTAL_APPROVAL', 'Confirm postage and the extra address sheet for this exact approved batch before mailing.')
 if (!postalAvailable(c.env)) fail('POSTAL_UNAVAILABLE', 'Postal sending is disabled or incomplete. An owner must configure the Lob connection on the hosted installation.', 503)
 const letters = await batchLetters(c, batchId), pieces = await ackMailPieces(c, batchId)
 if (!pieces.length) fail('POSTAL_PIECES', 'Prepare a fresh batch with frozen postal pieces before using Lob.')
 if (await letterHash(batch.settings_version, letters, pieces) !== batch.content_hash) fail('CONTENT_CHANGED', 'These letters changed. Prepare and approve a fresh batch.')
 const attempts = await postalSummary(c, batchId), attempted = new Set(attempts.map(a => a.piece_id))
 const selected = pieces.filter(piece => !attempted.has(piece.id)).slice(0, 8)
 if (!selected.length) return { id: batchId, version, postal: attempts, remaining: 0 }
 const configuration = await settings(c), organisation = configuration.organisation
 const prepared = selected.map(piece => {
  const letterIds: string[] = JSON.parse(piece.letter_ids), documents = letters.filter(l => letterIds.includes(l.id))
  if (!documents.length || documents.length !== letterIds.length || documents.some(l => l.void_reason || l.printed_at || !['pending', 'print'].includes(l.route) || ['sending', 'uncertain', 'submitted', 'delivered'].includes(l.delivery_status))) fail('POSTAL_ALREADY_ROUTED', 'A piece contains a printed or previously submitted document. Review delivery before preparing another mailing.')
  const printable = printableAckPieces([piece], documents)[0]
  return { piece, documents: documents.map(letter => ({ letter, attempt: newId() })), attempt: newId(), to: postalRecipient(piece), file: postalFile(printable, organisation) }
 })
 const writes: Stmt[] = [
  guard("EXISTS(SELECT 1 FROM cf_ack_batches WHERE id=? AND version=? AND content_hash=? AND status IN ('approved','exported'))", 'VERSION', 'This batch changed. Refresh before mailing.', batchId, version, batch.content_hash),
  ackMailPieceGuard(batchId), currentLetterGifts(batchId),
  guard('NOT EXISTS(SELECT 1 FROM cf_acks a JOIN cf_donors d ON d.id=a.donor_id WHERE a.batch_id=? AND d.erased_at IS NOT NULL)', 'ERASED_DONOR', 'A donor was erased. Prepare a fresh batch.', batchId),
  sql('UPDATE cf_ack_batches SET version=version+1 WHERE id=?', batchId),
  event(c, command, 'acknowledgements', batchId, null, { contentHash: batch.content_hash, pieces: prepared.length, extraAddressSheet: true }),
 ]
 for (const item of prepared) {
  writes.push(guard('NOT EXISTS(SELECT 1 FROM cf_postal_deliveries WHERE piece_id=?)', 'POSTAL_CLAIMED', 'This piece already has a postal attempt. It will not be retried.', item.piece.id),
   sql("INSERT INTO cf_postal_deliveries(id,piece_id,batch_id,approved_hash,authorized_by,requested_at,state) VALUES(?,?,?,?,?,?,'sending')", item.attempt, item.piece.id, batchId, batch.content_hash, c.actor.id, c.now))
  for (const { letter, attempt } of item.documents) writes.push(
   guard("EXISTS(SELECT 1 FROM cf_acks a JOIN cf_donors d ON d.id=a.donor_id WHERE a.id=? AND a.route IN ('pending','print') AND a.delivery_status NOT IN ('sending','uncertain','submitted','delivered') AND a.printed_at IS NULL AND a.void_reason IS NULL AND d.erased_at IS NULL)", 'POSTAL_ALREADY_ROUTED', 'This document changed or was already submitted. Refresh before mailing.', letter.id),
   sql('INSERT INTO cf_postal_documents(delivery_id,letter_id,attempt_id) VALUES(?,?,?)', item.attempt, letter.id, attempt),
   sql("UPDATE cf_acks SET route='postal',attempt_id=?,message_id=NULL,delivery_status='sending',delivery_note='Postal submission is in progress. Do not send another copy until the provider outcome is known.' WHERE id=?", attempt, letter.id))
 }
 await commit(c, writes)
 for (const item of prepared) {
  // Re-check current authority, gift validity and erasure immediately before each
  // external transfer. A lost response or interrupted request remains claimed.
  await commit(c, [currentLetterGifts(batchId), guard('NOT EXISTS(SELECT 1 FROM cf_postal_documents p JOIN cf_acks a ON a.id=p.letter_id JOIN cf_donors d ON d.id=a.donor_id WHERE p.delivery_id=? AND d.erased_at IS NOT NULL)', 'ERASED_DONOR', 'This mailing contains an erased donor.', item.attempt)])
  const result = await submitPostal(c.env, item.attempt, item.piece, item.to, item.file)
  // Provider evidence persists even if the authorizing staff session expires
  // during the network call. This step can never initiate another submission.
  const outcome = postalOutcome(item.attempt, result, c.now)
  if (result.state === 'submitted') outcome.push(postalAcknowledgments(item.attempt, c.now, today(configuration.timezone, new Date(c.now)), c.actor))
  await c.db.batch(outcome.map(s => c.db.prepare(s.sql).bind(...s.params)))
 }
 return { id: batchId, version: version + 1, postal: await postalSummary(c, batchId), remaining: pieces.length - attempts.length - prepared.length }
}

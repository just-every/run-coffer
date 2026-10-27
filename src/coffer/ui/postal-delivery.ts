import { manager } from '../auth'
import { ackMailPieces } from '../ack-mail-pieces'
import { postalSummary } from '../postal-delivery'
import { postalAvailable } from '../postal-provider'
import type { Context, Row } from '../db'
import { box, chip, e, form } from './common'

/** Reuses the existing batch decision controls; configuration stays private. */
export async function postalDeliveryPanel(c: Context, batch: Row): Promise<string> {
 const attempts = await postalSummary(c, batch.id), pieces = await ackMailPieces(c, batch.id)
 const pending = pieces.filter(piece => !attempts.some(a => a.piece_id === piece.id)).length
 const history = attempts.length ? `<ul class="list">${attempts.map(a => `<li>${chip(a.state === 'submitted' ? 'Postal submission accepted' : a.state === 'rejected' ? 'Postal submission rejected' : 'Postal outcome uncertain', a.state === 'submitted' ? 'info' : 'warn')} · ${a.documents} documents${a.provider_message_id ? ` · Lob reference <code>${e(a.provider_message_id)}</code>` : ''}</li>`).join('')}</ul><p>Acceptance is not delivery. USPS tracking appears with each document. Uncertain submissions are held for provider review and never retried.</p>` : ''
 let action = ''
 if (manager(c.actor) && ['approved', 'exported'].includes(batch.status) && pending) {
  action = postalAvailable(c.env) ? form('ack.sendPostal', `<p>Lob will print and mail up to ${Math.min(8, pending)} frozen pieces. Your Lob account pays printing and first-class postage, including one extra address sheet per piece.</p><label><input type="checkbox" name="approvePostage" value="true" required> I authorize these charges for the approved pieces.</label>`, 'Authorize postal sending', { batchId: batch.id, version: batch.version, contentHash: batch.content_hash }) : '<p>Optional Lob sending is disabled. Configure the private postal connection on the hosted installation to authorize printing and postage.</p>'
 }
 return history || action ? box('Postal delivery', history + action) : ''
}

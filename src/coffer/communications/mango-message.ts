import type { Row } from '../db'
import { templateTokens } from '../template-fields'
import { e } from '../ui/common'

/** The provider's documented display-name token; other fields remain visibly flagged for review. */
const NAME = /\{\{\s*donor_name\s*\}\}/g
export const mangoText = (text: string) => text.replace(NAME, '{{displayName | fallback: "Friend"}}')

export function mangoMessage(message: Row) {
 const fields=[...new Set(templateTokens(`${message.subject}\n${message.body}`).map(t=>t.field).filter(key=>key!=='donor_name'))]
 return `<p><strong>Subject</strong></p><pre class="copy">${e(mangoText(message.subject))}</pre><p><strong>Message</strong></p><pre class="copy">${e(mangoText(message.body))}</pre>${fields.length?`<p class="notice">Before approving in Mango, map or replace these Coffer fields using Mango’s field picker: ${fields.map(key=>`<code>{{${e(key)}}}</code>`).join(', ')}. Selected profile fields are handed off under their published keys. Check the values and missing-value fallbacks in Mango; Coffer has not verified Mango’s rendering of this draft.</p>`:''}`
}

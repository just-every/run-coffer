import type { Row } from '../db'
import { e } from '../ui/common'

/** The provider's documented display-name token; other fields remain visibly flagged for review. */
const NAME = /\{\{\s*donor_name\s*\}\}/g, GIVING = /\{\{\s*(total_given|last_gift|gift_count)\s*\}\}/g
export const mangoText = (text: string) => text.replace(NAME, '{{displayName | fallback: "Friend"}}')

export function mangoMessage(message: Row) {
 const names = [...new Set([...`${message.subject}\n${message.body}`.matchAll(/{{\s*(prefix|first_name|middle_name|last_name|suffix|nickname|informal_salutation|formal_salutation|envelope_name)\s*}}/g)].map(m=>m[0]))]
 const giving = [...new Set([...`${message.subject}\n${message.body}`.matchAll(GIVING)].map(m => m[0]))]
 return `<p><strong>Subject</strong></p><pre class="copy">${e(mangoText(message.subject))}</pre><p><strong>Message</strong></p><pre class="copy">${e(mangoText(message.body))}</pre>${names.length ? `<p class="notice">Name fields ${names.map(n=>`<code>${e(n)}</code>`).join(', ')} are synced as contact fields. Map these to Mango’s field picker before approving; Coffer has not verified their rendering in Mango.</p>` : ''}${giving.length ? `<p class="notice">Mango fills in each donor’s name, but not giving figures. Before approving in Mango, rewrite the sentences that use ${giving.map(g => `<code>${e(g)}</code>`).join(', ')}.</p>` : ''}`
}

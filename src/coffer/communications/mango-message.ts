import type { Row } from '../db'
import { e } from '../ui/common'

/** Mango personalises a list campaign with the contact's name only. */
const NAME = /\{\{\s*donor_name\s*\}\}/g, GIVING = /\{\{\s*(total_given|last_gift|gift_count)\s*\}\}/g
export const mangoText = (text: string) => text.replace(NAME, '{{displayName | fallback: "Friend"}}')

export function mangoMessage(message: Row) {
 const giving = [...new Set([...`${message.subject}\n${message.body}`.matchAll(GIVING)].map(m => m[0]))]
 return `<p><strong>Subject</strong></p><pre class="copy">${e(mangoText(message.subject))}</pre><p><strong>Message</strong></p><pre class="copy">${e(mangoText(message.body))}</pre>${giving.length ? `<p class="notice">Mango fills in each donor’s name, but not giving figures. Before approving in Mango, rewrite the sentences that use ${giving.map(g => `<code>${e(g)}</code>`).join(', ')}.</p>` : ''}`
}

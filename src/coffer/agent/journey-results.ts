import { all, one } from '../db'

/** Bind only this installation's giving pages, once when a step is published.
 * The saved absolute links survive provider handoff and human-approved resends. */
export function journeyLinks(body: string, code: string, origin: string) {
 return body.replace(/https?:\/\/[^\s<>"']+|(?<![\w/])\/give\/[^\s<>"']+/g, token => {
  const suffix = token.match(/[.,;!?)\]]+$/)?.[0] ?? ''
  const raw = suffix ? token.slice(0, -suffix.length) : token
  let link: URL
  try { link = new URL(raw, origin) } catch { return token }
  if (link.origin !== new URL(origin).origin || !/^\/give\/[^/]+\/?$/.test(link.pathname)) return token
  link.searchParams.set('appeal', code)
  return link.href + suffix
 })
}

/** COMM-008 semantics: a code joins signed ledger facts, never timing or exits. */
export async function journeyResults(c: { db: D1Database }, code: string | null | undefined) {
 if (!code) return { bound: false as const, code: null, note: 'Unknown: this historical journey step has no response-code binding.' }
 const publication = await one(c, 'SELECT code FROM cf_journey_step_publications WHERE code=?', code)
 if (!publication) return { bound: false as const, code: null, note: 'Unknown: the journey publication binding is unavailable.' }
 const [entries, recipients] = await Promise.all([
  all(c, `SELECT l.gift_id,l.donor_id,l.amount_cents FROM cf_fund_ledger l
   JOIN cf_gift_appeals a ON a.gift_id=l.gift_id WHERE a.appeal=? COLLATE NOCASE`, code),
  all(c, 'SELECT donor_id FROM cf_welcome_steps WHERE response_code=? UNION SELECT donor_id FROM cf_journey_steps WHERE response_code=?', code, code),
 ])
 const gifts = new Map<string, { donor: string; cents: number }>()
 for (const entry of entries) {
  const gift = gifts.get(entry.gift_id) ?? { donor: entry.donor_id, cents: 0 }
  gift.cents += Number(entry.amount_cents)
  gifts.set(entry.gift_id, gift)
 }
 const positive = [...gifts.values()].filter(g => g.cents > 0)
 const donors = new Set(positive.map(g => g.donor))
 const responded = recipients.filter(r => donors.has(r.donor_id)).length
 const dollarsCents = entries.reduce((sum, entry) => sum + Number(entry.amount_cents), 0)
 return { bound: true as const, code: publication.code, recipients: recipients.length, responded,
  responseRate: recipients.length ? responded / recipients.length : null,
  gifts: positive.length, dollarsCents, averageGiftCents: positive.length ? Math.round(dollarsCents / positive.length) : null }
}

// The development agent's saved thank-you for the demo's recovered monthly donor.
// Drafting asks Anthropic for a note grounded in the donor's recorded facts; the demo
// has no AI key and makes no external calls, so it writes the note from those same
// facts and stores it through drafting's own store (agent/stewardship.ts storeDraft):
// the same citations, source snapshot, saved version, audit event and activity line.
import { sourceData, storeDraft } from '../agent/stewardship'
import { one, type Context, type Row } from '../db'
import { usd } from '../money'
import { longDate } from '../settings'

export async function demoThankYou(c: Context, donorId: string, signer: string) {
 if (await one(c, 'SELECT 1 FROM cf_stewardship_drafts WHERE donor_id=?', donorId)) return null // the seed may run again
 const source = await sourceData(c, donorId)
 const donor = source.sources.find(s => s.kind === 'donor')!, organisation = source.sources.find(s => s.kind === 'organisation')!
 const latest = source.sources.find(s => s.kind === 'gift' && s.facts.current_amount_cents > 0)
 if (!latest) return null
 const fund = source.sources.find(s => s.kind === 'fund' && s.facts.fund === latest.facts.original_fund && s.facts.current_amount_cents > 0)
 const first = String(donor.facts.name).split(/\s+/)[0], org = String(organisation.facts.organisation)
 const body = [`Dear ${first},`, '',
  `Thank you for your gift of ${usd(latest.facts.current_amount_cents)} to ${latest.facts.original_fund} on ${longDate(latest.facts.received_on)}.${fund ? ` Your gifts to ${fund.facts.fund} now come to ${usd(fund.facts.current_amount_cents)}, and everyone at ${org} is grateful for each one.` : ''}`, '',
  'With thanks,', signer, org].join('\n')
 const citations: Row[] = [donor, organisation, latest, ...(fund ? [fund] : [])].map(s => ({ sourceId: s.id }))
 return storeDraft(c, donorId, 'thank_you', source, { subject: `Thank you, ${first}`, body, citations })
}

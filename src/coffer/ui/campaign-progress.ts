import { campaignProgress } from '../campaign-progress'
import type { Context } from '../db'
import { box, e, empty, longDay, money } from './common'

export async function campaignProgressPage(c: Context, id: string) {
 const r = await campaignProgress(c, id), p = r.campaign
 const rows = r.entries.map(g => `<li><a href="/app/donors/${e(g.donor_id)}">${e(g.donor_name)}</a> · ${longDay(g.received_on)} · ${money(g.amount_cents)} · ${e(g.fund)} · ${e(g.method)}</li>`).join('')
 return box(p.name, `<p>${p.starts_on ? longDay(p.starts_on) : 'No start date'} to ${p.ends_on ? longDay(p.ends_on) : 'No end date'} · Goal ${money(p.goal_cents)}</p>
 <div class="stats"><div class="stat"><strong>${money(r.raisedCents)}</strong><span>received</span></div><div class="stat"><strong>${money(r.pledgedOutstandingCents)}</strong><span>pledged, still to come</span></div><div class="stat"><strong>${money(r.softCreditCents)}</strong><span>soft credit, separate recognition</span></div></div>
 <p>${r.donorCount} giving donors · ${r.newDonors} first-time donors · ${r.recurringDonors} recurring donors · ${r.giftCount} gifts · ${money(r.averageGiftCents)} average gift</p>
 <p>Includes this campaign and its nested phases. Received totals include dated refunds and reversals; dates describe the campaign plan and do not hide later corrections. Pledges and soft credits never increase received money. Donors and gifts count positive remaining campaign balances; first-time means their first remaining gift in Coffer. Average is net received divided by those gifts, rounded to the nearest cent. Recurring counts active, trialing and past-due plans not set to cancel.</p>
 <p>Funds: ${r.funds.map(e).join(', ')}.</p><p>Appeals: ${r.appeals.length ? r.appeals.map(a => e(a.name) + ' (' + e(a.code) + ')').join(', ') : 'None yet'}.</p>
 <ul>${r.forms.map(f => `<li><a href="${e(f.path)}">${e(f.name)} giving form</a></li>`).join('')}</ul>
 <p>Nested campaigns: ${r.campaigns.length > 1 ? r.campaigns.filter(x => x.id !== id).map(x => `<a href="/app/giving/campaigns/${e(x.id)}">${e(x.name)}</a> (${money(x.goal_cents)} goal)`).join(', ') : 'None yet'}.</p>`) + box('Received ledger entries', rows ? `<ul class="list">${rows}</ul>` : empty('No received gifts for this campaign.')) + box('Outstanding pledges', r.pledges.length ? `<ul class="list">${r.pledges.map(p => `<li><a href="/app/donors/${e(p.donor_id)}#pledges">${money(p.amount_cents)} pledged</a> · ${money(Math.max(0, p.outstanding_cents))} still to come · ${e(p.fund)}</li>`).join('')}</ul>` : empty('No campaign pledges.'))
}

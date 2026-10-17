import { person } from '../auth'
import { all, type Context, type Row } from '../db'
import { PROSPECT_STAGES, PROSPECT_STAGE_LABELS, prospects } from '../major-gifts'
import { area, box, chip, e, empty, field, form, money, select, when } from './common'

const stages: [string, string][] = PROSPECT_STAGES.map(stage => [stage, PROSPECT_STAGE_LABELS[stage]])

function prospectFields(owners: Row[], p: Row = {}): string {
 return `${field('Opportunity name', 'label', 'text', p.label ?? '', 'maxlength="200" placeholder="Major gift opportunity"')}
 <div class="fields">${select('Stage', 'stage', stages, p.stage ?? 'identify', 'required')}
 ${select('Prospect owner', 'ownerId', [['', 'Choose an active team member'], ...owners.map(o => [o.id, o.display_name] as [string, string])], p.owner_id ?? '', 'required')}
 ${field('Ask amount (USD)', 'askAmount', 'number', p.ask_amount_cents === undefined ? '' : (p.ask_amount_cents / 100).toFixed(2), 'required min="0" max="100000000" step="0.01" inputmode="decimal"')}
 ${field('Expected close date', 'expectedCloseOn', 'date', p.expected_close_on ?? '', 'required')}</div>
 ${area('Next step', 'nextStep', p.next_step ?? '', 'required maxlength="2000" rows="3"')}
 <p class="muted">An ask can be zero while identifying a prospect. This pipeline does not record a gift or a pledge.</p>`
}

function scoreDetails(p: Row): string {
 const s = p.engagement
 return `<details><summary>Engagement ${s.score}/100 · see inputs and points</summary>
 <dl class="engagement-inputs"><dt>Recency</dt><dd>${s.recency.lastOn ? `${e(when(s.recency.lastOn))} · ${s.recency.days} days ago` : 'No eligible gifts or conversations'} → ${s.recency.points}/25 points</dd>
 <dt>Giving frequency, last 365 days</dt><dd>${s.frequency.gifts} gifts → ${s.frequency.points}/25 points</dd>
 <dt>Giving amount, last 365 days</dt><dd>${e(money(s.amount.cents))} → ${s.amount.points}/25 points</dd>
 <dt>Conversations, last 365 days</dt><dd>${s.conversations.count} recorded calls, meetings or emails → ${s.conversations.points}/25 points</dd></dl></details>`
}

export async function majorGiftsPage(c: Context, url: URL): Promise<string> {
 const staff = person(c.actor)
 const [list, owners, donors] = await Promise.all([
  prospects(c),
  all(c, "SELECT id,display_name FROM oa_operators WHERE status='active' AND role IN ('owner','admin','member') ORDER BY lower(display_name),id"),
  staff ? all(c, `SELECT d.id,d.name,d.email FROM cf_donors d WHERE d.erased_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id) ORDER BY lower(d.name),d.id`) : Promise.resolve([]),
 ])
 const stage = url.searchParams.get('stage') ?? '', owner = url.searchParams.get('ownerId') ?? ''
 const filtered = list.filter(p => (!stage || p.stage === stage) && (!owner || p.owner_id === owner))
 const ownerOptions: [string, string][] = owners.map(o => [o.id, o.display_name])
 for (const p of list) if (!ownerOptions.some(([id]) => id === p.owner_id)) ownerOptions.push([p.owner_id, `${p.owner_name} (inactive)`])
 const filter = `<form method="get" action="/app/pipeline"><div class="fields">${select('Stage', 'stage', [['', 'All stages'], ...stages], stage)}${select('Owner', 'ownerId', [['', 'All owners'], ...ownerOptions], owner)}</div><button>Filter pipeline</button></form>`
 const summary = `<div class="stats">${PROSPECT_STAGES.map(s => {
  const rows = filtered.filter(p => p.stage === s)
  return `<div class="stat"><strong>${e(money(rows.reduce((n, p) => n + p.ask_amount_cents, 0)))}</strong><span>${e(PROSPECT_STAGE_LABELS[s])} · ${rows.length} opportunities</span></div>`
 }).join('')}</div>`
 const pipeline = filtered.length ? `<ul class="list">${filtered.map(p => `<li>
  <a href="/app/donors/${e(p.donor_id)}"><strong>${e(p.donor_name)}</strong></a> · ${e(p.label)} ${chip(PROSPECT_STAGE_LABELS[p.stage as typeof PROSPECT_STAGES[number]])}
  <p>${e(money(p.ask_amount_cents))} ask · expected ${e(when(p.expected_close_on))}<br>Owner: ${e(p.owner_name)} ${p.owner_status !== 'active' ? chip('Reassign owner', 'warn') : ''}</p>
  <p><strong>Next step:</strong> ${e(p.next_step)}</p>${scoreDetails(p)}
  ${staff ? `<details class="edit"><summary>Update opportunity</summary>${form('prospect.save', prospectFields(owners, p), 'Save opportunity', { id: p.id, donorId: p.donor_id, version: p.version })}</details>` : ''}
  </li>`).join('')}</ul>` : empty(list.length ? 'No opportunities match these filters.' : 'No major-gift prospects yet. Choose a donor and record the next step.')
 const create = staff ? box('Add an opportunity', donors.length && owners.length
  ? form('prospect.save', `${select('Donor', 'donorId', [['', 'Choose a donor'], ...donors.map(d => [d.id, `${d.name}${d.email ? ` · ${d.email}` : ''}`] as [string, string])], '', 'required')}${prospectFields(owners)}`, 'Add opportunity')
  : empty('Add a donor and an active team member before creating an opportunity.')) : ''
 return `${box('Pipeline', `${filter}${summary}<p class="muted">Each opportunity keeps its own ask and next step, including after donors are merged. Amounts are planned asks.</p>${pipeline}`)}
 <div class="grid"><div>${create}</div><div>${box('How engagement is scored', `<p>Scores use recorded activity as of the organization’s current date. Each component contributes up to 25 points, for a total of 100.</p>
 <ul><li>Recency: the most recent eligible gift or conversation earns 25 points within 30 days, 15 within 90 days, 5 within 365 days, otherwise 0.</li>
 <li>Frequency: 5 points per eligible gift in the last 365 calendar days, capped at 25.</li>
 <li>Amount: 5 points per complete $100 of eligible gifts in that period, capped at 25 ($500).</li>
 <li>Conversations: 5 points per recorded call, meeting or email in that period, capped at 25.</li></ul>
 <p class="muted">Reversed gifts and gifts with any refunded contribution are excluded. Future gifts and conversations, pledges, soft credits and planned asks do not score. The 365-day period includes today. The score describes recorded engagement; it does not estimate wealth or promise a gift.</p>`)}</div></div>`
}

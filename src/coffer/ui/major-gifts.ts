import { solicitationState } from '../solicitation'
import { solicitationBadge } from './solicitation'
import { manager, person } from '../auth'
import { all, today, type Context, type Row } from '../db'
import { filterOpportunities, opportunityStages, opportunityTotals, prospects } from '../major-gifts'
import type { OpportunityStage } from '../opportunity-stages'
import { settings } from '../settings'
import { area, box, chip, e, empty, field, form, longDay, money, select } from './common'

type Options = { owners: Row[]; campaigns: Row[]; stages: OpportunityStage[]; funds: string[] }
const stageOptions = (stages: OpportunityStage[]): [string, string][] => stages.map(s => [s.id, s.label])
function prospectFields(options: Options, p: Row = {}): string {
 const { owners, campaigns, stages } = options
 return `${field('Opportunity name', 'label', 'text', p.label ?? '', 'maxlength="200" placeholder="Major gift opportunity"')}
 <div class="fields">${select('Stage', 'stage', stageOptions(stages.filter(s => s.outcome === 'open')), p.stage ?? stages.find(s => s.outcome === 'open')!.id, 'required')}
 ${select('Prospect owner', 'ownerId', [['', 'Choose a team member'], ...owners.map(o => [o.id, o.display_name] as [string, string])], p.owner_id ?? '', 'required')}
 ${field('Ask amount (USD)', 'askAmount', 'number', p.ask_amount_cents === undefined ? '' : (p.ask_amount_cents / 100).toFixed(2), 'required min="0" max="100000000" step="0.01" inputmode="decimal"')}
 ${field('Expected amount (USD)', 'expectedAmount', 'number', p.expected_amount_cents === undefined ? '' : (p.expected_amount_cents / 100).toFixed(2), 'required min="0" max="100000000" step="0.01" inputmode="decimal"')}
 ${field('Probability (%)', 'probability', 'number', p.probability_percent ?? 100, 'required min="0" max="100" step="1"')}
 ${field('Expected close date (required)', 'expectedCloseOn', 'date', p.expected_close_on ?? '', 'required')}
 ${field('Fund', 'fund', 'text', p.fund ?? 'Unrestricted', 'required maxlength="100" list="pipeline-funds"')}
 ${select('Campaign', 'campaignId', [['', 'No campaign'], ...campaigns.map(c => [c.id, `${c.name} · ${c.fund}`] as [string, string])], p.campaign_id ?? '')}</div>
 ${area('Next step', 'nextStep', p.next_step ?? '', 'required maxlength="2000" rows="3"')}
 <p class="muted">The prospect owner manages this opportunity. Use the campaign’s fund. An ask can be zero while identifying a prospect. Forecast is expected amount × probability, rounded to cents for each opportunity. Saving an open opportunity does not record a gift or a pledge.</p>`
}

function scoreDetails(p: Row): string {
 const s = p.engagement
 return `<details><summary>Engagement ${s.score}/100 · see inputs and points</summary>
 <dl class="engagement-inputs"><dt>Recency</dt><dd>${s.recency.lastOn ? `${e(longDay(s.recency.lastOn))} · ${s.recency.days} days ago` : 'No eligible gifts or conversations'} → ${s.recency.points}/${s.recency.weight} points</dd>
 <dt>Giving frequency, last 365 days</dt><dd>${s.frequency.gifts} gifts → ${s.frequency.points}/${s.frequency.weight} points</dd>
 <dt>Giving amount, last 365 days</dt><dd>${e(money(s.amount.cents))} → ${s.amount.points}/${s.amount.weight} points</dd>
 <dt>Conversations, last 365 days</dt><dd>${s.conversations.count} recorded calls, meetings or emails → ${s.conversations.points}/${s.conversations.weight} points</dd></dl></details>`
}

function closeFields(p: Row, stages: OpportunityStage[], pledges: Row[], gifts: Row[], day: string) {
 const pledgeOptions: [string, string][] = pledges.filter(r => r.donor_id === p.donor_id && r.fund === p.fund).map(r => [r.id, `${money(r.amount_cents)} · ${longDay(r.pledged_on)} · ${r.fund}`])
 const giftOptions: [string, string][] = gifts.filter(r => r.donor_id === p.donor_id && r.fund === p.fund).map(r => [r.id, `${money(r.net_cents)} · ${longDay(r.received_on)} · ${r.reference || r.method}`])
 return `<div class="fields">${select('Closed stage', 'stage', stageOptions(stages.filter(s => s.outcome !== 'open')), stages.find(s => s.outcome === 'won')!.id, 'required')}
 ${field('Closed on', 'closedOn', 'date', day, 'required')}
 ${select('Result record', 'linkKind', [['new_pledge', 'Create a pledge'], ['pledge', 'Link an existing pledge'], ['gift', 'Link a received gift'], ['none', 'No record — closed lost']], 'new_pledge')}
 ${select('Existing pledge', 'pledgeId', [['', 'Choose a pledge'], ...pledgeOptions])}
 ${select('Received gift', 'giftId', [['', 'Choose a gift'], ...giftOptions])}
 ${field('Pledge amount (USD)', 'amount', 'number', (p.expected_amount_cents / 100).toFixed(2), 'min="0.01" step="0.01" max="100000000" inputmode="decimal"')}</div>
 ${area('Pledge payment schedule: YYYY-MM-DD | amount, one per line', 'schedule', `${p.expected_close_on}|${(p.expected_amount_cents / 100).toFixed(2)}`, 'rows="3"')}
 <p class="muted">For a new pledge, complete the amount and payment schedule. Existing links must belong to this prospect and fund. For a lost opportunity choose “No record — closed lost”. Closing removes the entire opportunity from the forecast.</p>`
}

function opportunityCard(p: Row, staff: boolean, options: Options, pledges: Row[], gifts: Row[], day: string) {
 const linked = p.pledge_id ? `<a href="/app/donors/${e(p.donor_id)}#pledges">Linked pledge · ${e(money(pledges.find(r => r.id === p.pledge_id)!.amount_cents))}</a>`
  : p.gift_id ? `<a href="/app/gifts?gift=${e(p.gift_id)}">Linked received gift</a>` : ''
 return `<li id="opportunity-${e(p.id)}" data-opportunity="${e(p.id)}">
 <a href="/app/donors/${e(p.donor_id)}"><strong>${e(p.donor_name)}</strong></a> · ${e(p.label)} ${chip(p.stage_label)} ${solicitationBadge(p.solicitation)}
 <p>${e(money(p.ask_amount_cents))} ask · expected ${e(longDay(p.expected_close_on))}<br>Owner: ${e(p.owner_name)} ${p.owner_status !== 'active' ? chip('Reassign owner', 'warn') : ''}</p>
 <p>${e(money(p.expected_amount_cents))} expected · ${e(p.probability_percent)}% probability · ${e(money(p.forecast_cents))} forecast<br>${e(p.fund)} · ${e(p.campaign_name ?? 'No campaign')}</p>
 ${p.closed_on ? `<p>Closed ${e(longDay(p.closed_on))}. ${linked}</p>` : ''}
 <p><a href="/app/opportunities/${e(p.id)}">Action plan and proposals</a></p><p><strong>Next step:</strong> ${e(p.next_step)}</p>${scoreDetails(p)}
 ${staff && !p.closed_on ? `<details class="edit"><summary>Update opportunity</summary>${form('prospect.save', prospectFields(options, p), 'Save opportunity', { id: p.id, donorId: p.donor_id, version: p.version })}</details>
 <details class="edit"><summary>Close opportunity</summary>${form('prospect.close', closeFields(p, options.stages, pledges, gifts, day), 'Close opportunity', { id: p.id, version: p.version })}</details>` : ''}</li>`
}

export async function majorGiftsPage(c: Context, url: URL): Promise<string> {
 const staff = person(c.actor)
 const [list, owners, donors, campaigns, funds, policy, pledges, gifts, config] = await Promise.all([
  prospects(c),
  all(c, "SELECT id,display_name FROM oa_operators WHERE status='active' AND role IN ('owner','admin','member') ORDER BY lower(display_name),id"),
  staff ? all(c, `SELECT d.id,d.name,d.email FROM cf_donors d WHERE d.erased_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id) ORDER BY lower(d.name),d.id`) : Promise.resolve([]),
  all(c, 'SELECT id,name,fund FROM cf_campaigns ORDER BY lower(name),id'),
  all(c, 'SELECT name FROM cf_funds UNION SELECT fund AS name FROM cf_campaigns UNION SELECT fund AS name FROM cf_prospects ORDER BY name'),
  opportunityStages(c),
  all(c, 'SELECT id,donor_id,amount_cents,pledged_on,fund FROM cf_pledges ORDER BY pledged_on DESC,id'),
  staff ? all(c, `SELECT DISTINCT g.id,g.donor_id,g.net_cents,g.received_on,g.reference,g.method,f.fund FROM cf_gift_balances g JOIN cf_fund_ledger f ON f.gift_id=g.id WHERE g.kind='gift' AND g.net_cents>0 AND f.amount_cents>0 ORDER BY g.received_on DESC,g.id`) : Promise.resolve([]),
  settings(c),
 ])
 const day = today(config.timezone, new Date(c.now)), options: Options = { owners, campaigns, stages: policy.stages, funds: funds.map(f => f.name) }
 const stage = url.searchParams.get('stage') ?? '', owner = url.searchParams.get('ownerId') ?? url.searchParams.get('managerId') ?? '', campaign = url.searchParams.get('campaignId') ?? '', view = url.searchParams.get('view') === 'board' ? 'board' : 'list'
 const filtered = filterOpportunities(list, url), totals = opportunityTotals(filtered)
 const ownerOptions: [string, string][] = owners.map(o => [o.id, o.display_name])
 const restrictions=await solicitationState(c,list.map(p=>p.donor_id))
 for(const p of list)p.solicitation=restrictions.find(r=>r.donor_id===p.donor_id)
 for (const p of list) if (!ownerOptions.some(([id]) => id === p.owner_id)) ownerOptions.push([p.owner_id, `${p.owner_name} (inactive)`])
 const filter = `<form method="get" action="/app/pipeline" aria-label="Pipeline filters"><div class="fields">${select('Stage', 'stage', [['', 'All stages'], ...stageOptions(policy.stages)], stage)}${select('Owner', 'ownerId', [['', 'All owners'], ...ownerOptions], owner)}
 ${select('Campaign', 'campaignId', [['', 'All campaigns'], ...campaigns.map(c => [c.id, c.name] as [string, string])], campaign)}
 ${select('View', 'view', [['list', 'List'], ['board', 'Board']], view)}</div><button>Filter pipeline</button></form>`
 const summary = `<div class="stats" aria-label="Open pipeline totals"><div class="stat"><strong id="pipeline-forecast">${e(money(totals.forecastCents))}</strong><span>Probability-weighted forecast</span></div>
 <div class="stat"><strong>${e(money(totals.expectedCents))}</strong><span>Open expected amount</span></div><div class="stat"><strong>${e(money(totals.askCents))}</strong><span>Open ask amount · ${totals.open} opportunities</span></div></div>
 <p class="muted">Forecast excludes closed won and lost opportunities. A won pledge or gift is counted in its own record, never again as an open ask.</p>`
 const cards = (rows: Row[]) => `<ul class="list">${rows.map(p => opportunityCard(p, staff, options, pledges, gifts, day)).join('')}</ul>`
 const pipeline = !filtered.length ? empty(list.length ? 'No opportunities match these filters.' : 'No major-gift prospects yet. Choose a donor and record the next step.')
  : view === 'board' ? `<div class="grid" aria-label="Opportunity board">${policy.stages.filter(s => !stage || s.id === stage).map(s => {
   const rows = filtered.filter(p => p.stage === s.id)
   return `<div>${box(s.label, `<p>${rows.length} opportunities · ${e(money(rows.reduce((sum, p) => sum + p.forecast_cents, 0)))} forecast</p>${rows.length ? cards(rows) : empty('No opportunities in this stage.')}`)}</div>`
  }).join('')}</div>` : `<div aria-label="Opportunity list">${cards(filtered)}</div>`
 const create = staff ? box('Add an opportunity', donors.length && owners.length
  ? form('prospect.save', `${select('Donor', 'donorId', [['', 'Choose a donor'], ...donors.map(d => [d.id, `${d.name}${d.email ? ` · ${d.email}` : ''}`] as [string, string])], '', 'required')}${prospectFields(options)}`, 'Add opportunity')
  : empty('Add a donor and an active team member before creating an opportunity.')) : ''
 const configure = manager(c.actor) ? box('Pipeline stages', `<details><summary>Configure stages</summary><p>Keep stable codes when renaming or reordering stages. A stage in use must retain its code and open, won or lost outcome. Ask is the solicitation stage; Stewardship follows the ask.</p>${form('prospect.stages', area('Stages: code | label | open, won or lost, one per line', 'stageDefinitions', policy.stages.map(s => `${s.id} | ${s.label} | ${s.outcome}`).join('\n'), 'required rows="9"'), 'Save pipeline stages', { version: policy.version })}</details>`) : ''
 return `<p><a href="/app/portfolios">Portfolios and moves by manager</a> · <a href="/app/grants">Foundation and corporate grants</a></p>
 <datalist id="pipeline-funds">${options.funds.map(f => `<option value="${e(f)}"></option>`).join('')}</datalist>
 ${box('Pipeline', `${filter}${summary}${pipeline}`)}
 <div class="grid"><div>${create}</div><div>${configure}${box('How engagement is scored', '<p>Scores use current constituent activity and the organization’s current weights. <a href="/app/engagement">Read the complete formula and score settings</a>.</p>')}</div></div>`
}

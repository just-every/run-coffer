import { box, e, field, hidden, money, page, select } from '../ui/common'

interface Campaign { id: string; name: string }
interface Team { id: string; campaign_id: string; title: string; goal_cents: number; published: number | boolean; version: number; owned?: number | boolean }
interface Fundraiser { id: string; campaign_id: string; title: string; goal_cents: number; published: number | boolean; version: number; team_id: string | null; raisedCents?: number }
export interface PeerDashboardState {
 campaigns: Campaign[]
 teams: Team[]
 pages: Fundraiser[]
 recognition: { version: number; anonymous: number | boolean; recognition_name: string | null; honor_roll_opt_in: number | boolean }
}
export interface PeerPublicValue {
 page: { id: string; title: string; goal_cents: number; recognition_name: string | null }
 campaign: Campaign & { slug: string }
 team?: { id?: string; title: string } | null
 raisedCents: number
 giftCount: number
 wall: { name: string; amountCents: number }[]
}
export interface PeerLeaderboardRow {
 id: string
 title: string
 name?: string
 teamId?: string | null
 raisedCents: number
 giftCount: number
 goalCents: number
}
export interface PeerLeaderboardValue { teams: PeerLeaderboardRow[]; pages: PeerLeaderboardRow[] }

const back = '<p><a href="/giving/portal">Back to my giving</a></p>'
const checkbox = (name: string, label: string, checked = false) => `<label><input type="checkbox" name="${e(name)}" value="yes"${checked ? ' checked' : ''}> ${e(label)}</label>`
const goal = (cents = 100000) => field('Fundraising goal (USD)', 'goal', 'number', (cents / 100).toFixed(2), 'required min="0.01" step="0.01" inputmode="decimal"')
const title = (value = '') => field('Title', 'title', 'text', value, 'required maxlength="120"')
const publication = (published = false) => `${checkbox('publish', 'Publish this fundraiser', published)}${checkbox('publicationPermission', 'I permit everyone to see this title, goal, team membership and my public recognition name when I publish.')}`
const publicPath = (id: string) => `/giving/peer/pages/${encodeURIComponent(id)}`
const campaignOptions = (campaigns: Campaign[]): [string, string][] => [['', 'Choose a campaign'], ...campaigns.map(c => [c.id, c.name] as [string, string])]

function teamSelect(state: PeerDashboardState, campaignId?: string, selected = '') {
 const teams = state.teams.filter(t => (t.published || t.owned) && (!campaignId || t.campaign_id === campaignId))
 return select('Team (optional; choose one in the same campaign)', 'teamId', [['', 'No team'], ...teams.map(t => [t.id, `${t.title}${t.published ? '' : ' · private draft'} · ${state.campaigns.find(c => c.id === t.campaign_id)?.name ?? ''}`] as [string, string])], selected)
}

function recognitionForm(state: PeerDashboardState) {
 const r = state.recognition
 return box('Your public recognition', `<p>Before publishing a team or personal page, choose how you want to be recognized. A public recognition name and permission to appear on the honor roll are required to publish. These choices also govern public gift recognition.</p><form method="post" action="/giving/peer/recognition">${hidden('version', r.version)}${field('Public recognition name', 'recognitionName', 'text', r.recognition_name, 'maxlength="200"')}${select('Public participation and honor roll permission', 'honorRollOptIn', [['no', 'Keep my participation private'], ['yes', 'Allow my recognition name on public fundraisers, leaderboards and honor rolls']], r.honor_roll_opt_in ? 'yes' : 'no')}${select('Anonymous public recognition', 'anonymous', [['yes', 'Keep my identity anonymous'], ['no', 'Use my public recognition name']], r.anonymous ? 'yes' : 'no')}<p>Choosing anonymity or withdrawing public participation permission hides your fundraisers from public view.</p><button>Save recognition choices</button></form>`)
}

function ownPage(state: PeerDashboardState, fundraiser: Fundraiser) {
 const campaign = state.campaigns.find(c => c.id === fundraiser.campaign_id)
 const publicLink = fundraiser.published ? `<p><a href="${publicPath(fundraiser.id)}">View and share this page</a></p>` : '<p>Private draft · only you can view these editing controls.</p>'
 return box(fundraiser.title, `<p>${e(campaign?.name)}${fundraiser.raisedCents === undefined ? '' : ` · ${money(fundraiser.raisedCents)} raised`}</p>${publicLink}<details class="edit"><summary>Edit this fundraising page</summary><form method="post" action="/giving/peer/pages">${hidden('id', fundraiser.id)}${hidden('version', fundraiser.version)}${hidden('campaignId', fundraiser.campaign_id)}${title(fundraiser.title)}${goal(fundraiser.goal_cents)}${teamSelect(state, fundraiser.campaign_id, fundraiser.team_id ?? '')}${publication(!!fundraiser.published)}<p>Clear “Publish this fundraiser” to unpublish and keep a private draft. Gifts already recorded retain their attribution.</p><button>Save fundraising page</button></form></details>`)
}

function ownTeam(state: PeerDashboardState, team: Team) {
 return box(team.title, `<p>${e(state.campaigns.find(c => c.id === team.campaign_id)?.name)} · ${team.published ? 'Published team' : 'Private team draft'}</p><details class="edit"><summary>Edit this team</summary><form method="post" action="/giving/peer/teams">${hidden('id', team.id)}${hidden('version', team.version)}${hidden('campaignId', team.campaign_id)}${title(team.title)}${goal(team.goal_cents)}${publication(!!team.published)}<p><a href="/giving/peer/teams/${e(team.id)}">View and share this team</a></p><p>Clear “Publish this fundraiser” to unpublish this team.</p><button>Save team</button></form></details>`)
}

export async function peerDashboard(state: PeerDashboardState, saved = false): Promise<Response> {
 const choices = campaignOptions(state.campaigns)
 const create = state.campaigns.length ? box('Start fundraising', `<details class="edit"${state.pages.length ? '' : ' open'}><summary>Create a personal fundraising page</summary><form method="post" action="/giving/peer/pages">${select('Campaign', 'campaignId', choices, '', 'required')}${title()}${goal()}${teamSelect(state)}${publication()}<button>Create fundraising page</button></form></details><details class="edit"><summary>Create a team</summary><form method="post" action="/giving/peer/teams">${select('Campaign', 'campaignId', choices, '', 'required')}${title()}${goal()}${publication()}<button>Create team</button></form></details>`) : box('Start fundraising', '<p>No campaigns are available for fundraising right now.</p>')
 const own = state.pages.length ? state.pages.map(p => ownPage(state, p)).join('') : box('Your fundraising pages', '<p>You have no fundraising pages yet. Create one to set a goal and invite others to give.</p>')
 const response = await page('My fundraising', `${back}${saved ? '<p class="notice" role="status">Your fundraising changes are saved.</p>' : ''}${recognitionForm(state)}${own}${state.teams.filter(t => t.owned).map(t => ownTeam(state, t)).join('')}${create}`)
 response.headers.set('x-robots-tag', 'noindex, nofollow')
 return response
}

function progress(raised: number, target: number, count: number) {
 return `<div class="stats"><div class="stat"><strong>${money(raised)}</strong><span>Raised</span></div><div class="stat"><strong>${money(target)}</strong><span>Goal</span></div><div class="stat"><strong>${e(count)}</strong><span>${count === 1 ? 'Gift' : 'Gifts'}</span></div></div>`
}

export async function peerPublicPage(value: PeerPublicValue): Promise<Response> {
 const { page: fundraiser, campaign, team } = value
 const intro = box(campaign.name, `${fundraiser.recognition_name ? `<p>Fundraising by ${e(fundraiser.recognition_name)}</p>` : ''}${team ? `<p>Team: <a href="/giving/peer/teams/${e(team.id)}">${e(team.title)}</a></p>` : ''}${progress(value.raisedCents, fundraiser.goal_cents, value.giftCount)}<p><a class="button" href="/give/${encodeURIComponent(campaign.slug)}?peer=${encodeURIComponent(fundraiser.id)}">Give through this page</a></p><p><a href="/giving/peer/leaderboard/${encodeURIComponent(campaign.id)}">View campaign leaderboard</a></p>`)
 const wall = box('Supporters', value.wall.length ? `<ul class="list">${value.wall.map(gift => `<li><strong>${e(gift.name)}</strong> · ${money(gift.amountCents)}</li>`).join('')}</ul>` : '<p>No gifts have been shared on this donor wall yet.</p>')
 return page(fundraiser.title, `${intro}${wall}`)
}

function leaderboardRows(rows: PeerLeaderboardRow[], teams: PeerLeaderboardRow[], personal: boolean) {
 return rows.length ? `<ol class="list">${rows.map(row => {
  const team = row.teamId ? teams.find(t => t.id === row.teamId) : undefined
  return `<li><strong>${personal ? `<a href="${publicPath(row.id)}">${e(row.title)}</a>` : `<a href="/giving/peer/teams/${encodeURIComponent(row.id)}">${e(row.title)}</a>`}</strong>${personal && row.name ? `<p>${e(row.name)}${team ? ` · ${e(team.title)}` : ''}</p>` : team ? `<p>${e(team.title)}</p>` : ''}<p>${money(row.raisedCents)} raised of ${money(row.goalCents)} · ${e(row.giftCount)} ${row.giftCount === 1 ? 'gift' : 'gifts'}</p></li>`
 }).join('')}</ol>` : `<p>No public ${personal ? 'fundraisers' : 'teams'} yet.</p>`
}

export async function peerLeaderboard(value: PeerLeaderboardValue, campaign: Campaign): Promise<Response> {
 return page(`${campaign.name} leaderboard`, `<p>Team totals include gifts through their members’ pages. The same gifts appear in fundraiser totals; these two lists are not added together.</p>${box('Teams', leaderboardRows(value.teams, value.teams, false))}${box('Fundraisers', leaderboardRows(value.pages, value.teams, true))}`)
}

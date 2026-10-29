import { fail, one } from '../db'
import { leaderboard } from './service'
import { box, e, money, page } from '../ui/common'

export async function publicTeam(c: {db:D1Database}, teamId: string) {
 const team = await one(c, 'SELECT campaign_id FROM cf_peer_teams WHERE id=?', teamId)
 if (!team) fail('NOT_FOUND', 'That team is unavailable.', 404)
 const board = await leaderboard(c, team.campaign_id), current = board.teams.find(t => t.id === teamId)
 if (!current) fail('NOT_FOUND', 'That team is unavailable.', 404)
 const campaign = await one<{id:string;name:string}>(c, 'SELECT id,name FROM cf_campaigns WHERE id=?', team.campaign_id)
 return {team:current, campaign:campaign!, pages:board.pages.filter(p => p.teamId === teamId)}
}
export async function peerTeamPage(value: Awaited<ReturnType<typeof publicTeam>>) {
 return page(value.team.title, `${box(value.campaign.name, `<p>${money(value.team.raisedCents)} raised of ${money(value.team.goalCents)} · ${value.team.giftCount} gifts</p><p><a href="/giving/peer/leaderboard/${e(value.campaign.id)}">View campaign leaderboard</a></p>`)}${box('Team fundraisers', value.pages.length ? `<ul class="list">${value.pages.map(p => `<li><a href="/giving/peer/pages/${e(p.id)}">${e(p.title)}</a><p>${e(p.name)} · ${money(p.raisedCents)} raised</p></li>`).join('')}</ul>` : '<p>No public personal pages have joined this team yet.</p>')}`)
}

import { all, choice, commit, event, fail, guard, id, integer, newId, one, optional, sql, text, type Context, type Row, type Stmt } from '../db'
import { amount } from '../money'
import type { portalContext } from '../giving/portal-identity'
import type { PeerDashboardState, PeerLeaderboardRow, PeerLeaderboardValue, PeerPublicValue } from './ui'

type ReadContext = Pick<Context, 'db'>
export type PeerContext = Awaited<ReturnType<typeof portalContext>>
const currentDonor = (alias: string) => `${alias}.erased_at IS NULL AND ${alias}.constituent_status='active'
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=${alias}.id)`
const recognized = (owner: string) => `EXISTS(SELECT 1 FROM cf_donors d JOIN cf_donor_recognition r ON r.donor_id=d.id
 WHERE d.id=${owner} AND ${currentDonor('d')} AND r.anonymous=0 AND r.honor_roll_opt_in=1
 AND length(trim(COALESCE(r.recognition_name,'')))>0)`
export const peerVisible = (alias: string) => `${alias}.published=1 AND ${recognized(alias + '.donor_id')}
 AND EXISTS(SELECT 1 FROM cf_campaigns c WHERE c.id=${alias}.campaign_id AND c.active=1)`
// Sum signed cash once per original gift. Soft credit never enters money totals.
export const peerBalances = `WITH peer_balances AS (
 SELECT pg.page_id,l.gift_id,SUM(l.amount_cents) AS cents
 FROM cf_peer_gifts pg JOIN cf_peer_pages p ON p.id=pg.page_id
 JOIN cf_fund_ledger l ON l.gift_id=pg.gift_id AND l.campaign_id=p.campaign_id
 GROUP BY pg.page_id,l.gift_id
), page_totals AS (
 SELECT page_id,SUM(cents) AS raisedCents,SUM(CASE WHEN cents>0 THEN 1 ELSE 0 END) AS giftCount
 FROM peer_balances GROUP BY page_id
)`

function ownerGuard(donorId: string) {
 return guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND ${currentDonor('d')})`,
  'PEER_DONOR', 'This supporter account is no longer available.', donorId)
}
function authenticate(c: PeerContext, donorId: string) {
 if (c.actor.id !== 'donor:' + donorId || c.actor.role !== 'donor') fail('PEER_AUTH', 'Sign in to your own supporter account.', 403)
}

/** Own drafts are private. Other supporters appear only as published team
 * choices, with no donor identifier or contact information in the projection. */
export async function ownState(c: PeerContext, donorId: string): Promise<PeerDashboardState> {
 authenticate(c, donorId)
 await commit(c, [ownerGuard(donorId)])
 const [campaigns, teams, pages, recognition] = await Promise.all([
  all<PeerDashboardState['campaigns'][number]>(c, 'SELECT id,name,slug,goal_cents,closes_on FROM cf_campaigns WHERE active=1 ORDER BY name'),
  all<PeerDashboardState['teams'][number]>(c, `${peerBalances} SELECT t.id,t.campaign_id,t.title,t.goal_cents,t.published,t.version,t.created_at,
   CASE WHEN t.donor_id=? THEN 1 ELSE 0 END AS owned,
   COALESCE((SELECT SUM(b.raisedCents) FROM cf_peer_pages p JOIN page_totals b ON b.page_id=p.id WHERE p.team_id=t.id AND ${peerVisible('p')}),0) AS raisedCents,
   COALESCE((SELECT SUM(b.giftCount) FROM cf_peer_pages p JOIN page_totals b ON b.page_id=p.id WHERE p.team_id=t.id AND ${peerVisible('p')}),0) AS giftCount
   FROM cf_peer_teams t WHERE t.donor_id=? OR (${peerVisible('t')}) ORDER BY t.title`, donorId, donorId),
  all<PeerDashboardState['pages'][number]>(c, `${peerBalances} SELECT p.id,p.campaign_id,p.team_id,p.title,p.goal_cents,p.published,p.version,p.created_at,
   COALESCE(b.raisedCents,0) AS raisedCents,COALESCE(b.giftCount,0) AS giftCount
   FROM cf_peer_pages p LEFT JOIN page_totals b ON b.page_id=p.id WHERE p.donor_id=? ORDER BY p.created_at DESC`, donorId),
  one<PeerDashboardState['recognition']>(c, 'SELECT version,anonymous,recognition_name,honor_roll_opt_in FROM cf_donor_recognition WHERE donor_id=?', donorId),
 ])
 return { campaigns, teams, pages, recognition: recognition ?? { version: 0, anonymous: 0, recognition_name: null, honor_roll_opt_in: 0 } }
}

async function save(c: PeerContext, donorId: string, p: Row, kind: 'team' | 'page') {
 authenticate(c, donorId)
 const table = kind === 'team' ? 'cf_peer_teams' : 'cf_peer_pages'
 const existingId = optional(p.id, 'Fundraising record', 100), recordId = existingId ?? newId()
 const campaignId = id(p.campaignId, 'Campaign'), title = text(p.title, 'Title', 120)
 const goalCents = amount(p, 'goal', 'Fundraising goal'), published = choice(p.publish ?? 'no', ['yes', 'no'], 'publication') === 'yes' ? 1 : 0
 const version = existingId ? integer(Number(p.version), 'Fundraising version', 1) : 0
 const teamId = kind === 'page' ? optional(p.teamId, 'Team', 100) : null
 if (published && p.publicationPermission !== 'yes') fail('PEER_PERMISSION', 'Explicitly allow publication of this title and your recognition name.', 400)
 const statements: Stmt[] = [ownerGuard(donorId)]
 if (existingId) statements.push(guard(`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND donor_id=? AND campaign_id=? AND version=?)`,
  'PEER_VERSION', 'This record is unavailable or changed. Refresh before saving.', recordId, donorId, campaignId, version))
 statements.push(guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND active=1)', 'PEER_CAMPAIGN', 'Choose a published campaign.', campaignId))
 if (published) statements.push(guard(recognized('?'), 'PEER_RECOGNITION',
  'Publication requires an existing, nonanonymous recognition name and honor roll permission. Ask the organization to review your recognition preferences.', donorId))
 if (teamId) statements.push(guard(`EXISTS(SELECT 1 FROM cf_peer_teams t WHERE t.id=? AND t.campaign_id=? AND
  (t.donor_id=? OR (${peerVisible('t')})))`, 'PEER_TEAM', 'Choose your own team or a published team in this campaign.', teamId, campaignId, donorId))
 if (existingId) statements.push(kind === 'team'
  ? sql(`UPDATE cf_peer_teams SET title=?,goal_cents=?,published=?,version=version+1 WHERE id=? AND donor_id=?`, title, goalCents, published, recordId, donorId)
  : sql(`UPDATE cf_peer_pages SET title=?,goal_cents=?,published=?,team_id=?,version=version+1 WHERE id=? AND donor_id=?`, title, goalCents, published, teamId, recordId, donorId))
 else statements.push(kind === 'team'
  ? sql('INSERT INTO cf_peer_teams(id,campaign_id,donor_id,title,goal_cents,published,version,created_at) VALUES(?,?,?,?,?,?,1,?)', recordId, campaignId, donorId, title, goalCents, published, c.now)
  : sql('INSERT INTO cf_peer_pages(id,campaign_id,donor_id,team_id,title,goal_cents,published,version,created_at) VALUES(?,?,?,?,?,?,?,1,?)', recordId, campaignId, donorId, teamId, title, goalCents, published, c.now))
 statements.push(event(c, `peer.${kind}.${existingId ? 'update' : 'create'}`, `peer_${kind}`, recordId, donorId, { campaignId, published, version: version + 1 }))
 await commit(c, statements)
 return { id: recordId, version: version + 1 }
}
export const saveTeam = (c: PeerContext, donorId: string, p: Row) => save(c, donorId, p, 'team')
export const savePage = (c: PeerContext, donorId: string, p: Row) => save(c, donorId, p, 'page')

/** No donor IDs, legal names, emails, private titles or payment identifiers. */
export async function publicPage(c: ReadContext, pageId: string): Promise<PeerPublicValue> {
 const record = await one(c, `SELECT p.id,p.title,p.goal_cents,p.team_id,p.campaign_id,
  (SELECT recognition_name FROM cf_donor_recognition WHERE donor_id=p.donor_id) AS recognition_name,
  c.name AS campaign_name,c.slug AS campaign_slug
  FROM cf_peer_pages p JOIN cf_campaigns c ON c.id=p.campaign_id WHERE p.id=? AND ${peerVisible('p')}`, id(pageId, 'Fundraising page'))
 if (!record) fail('NOT_FOUND', 'That fundraising page is not available.', 404)
 const [totals, team, wall] = await Promise.all([
  one(c, `${peerBalances} SELECT raisedCents,giftCount FROM page_totals WHERE page_id=?`, record.id),
  record.team_id ? one<NonNullable<PeerPublicValue['team']>>(c, `SELECT t.id,t.title,t.goal_cents FROM cf_peer_teams t WHERE t.id=? AND ${peerVisible('t')}`, record.team_id) : null,
  all<PeerPublicValue['wall'][number]>(c, `${peerBalances} SELECT CASE WHEN COALESCE(dr.anonymous,0)=1 OR gr.anonymous=1 THEN 'Anonymous'
    ELSE COALESCE(NULLIF(trim(gr.recognition_name),''),'Anonymous') END AS name,
   SUM(b.cents) AS amountCents,COUNT(*) AS giftCount
   FROM peer_balances b JOIN cf_gift_balances g ON g.id=b.gift_id AND g.net_cents>0
   JOIN cf_donors d ON d.id=g.donor_id AND d.erased_at IS NULL
   JOIN cf_gift_recognition gr ON gr.gift_id=g.id AND gr.wall_opt_in=1
   LEFT JOIN cf_donor_recognition dr ON dr.donor_id=g.donor_id
   WHERE b.page_id=? AND b.cents>0 GROUP BY 1 ORDER BY amountCents DESC,name`, record.id),
 ])
 return { page: { id: record.id, title: record.title, goal_cents: record.goal_cents, recognition_name: record.recognition_name },
  campaign: { id: record.campaign_id, name: record.campaign_name, slug: record.campaign_slug },
  team: team ?? null, raisedCents: totals?.raisedCents ?? 0, giftCount: totals?.giftCount ?? 0, wall }
}

export async function leaderboard(c: ReadContext, campaignId: string): Promise<PeerLeaderboardValue & { raisedCents: number }> {
 if (!await one(c, 'SELECT 1 FROM cf_campaigns WHERE id=? AND active=1', id(campaignId, 'Campaign'))) fail('NOT_FOUND', 'That campaign is not available.', 404)
 const [pages, teams] = await Promise.all([
  all<PeerLeaderboardRow>(c, `${peerBalances} SELECT p.id,p.title,r.recognition_name AS name,
   CASE WHEN EXISTS(SELECT 1 FROM cf_peer_teams t WHERE t.id=p.team_id AND ${peerVisible('t')}) THEN p.team_id ELSE NULL END AS teamId,
   COALESCE(b.raisedCents,0) AS raisedCents,COALESCE(b.giftCount,0) AS giftCount,p.goal_cents AS goalCents
   FROM cf_peer_pages p JOIN cf_donor_recognition r ON r.donor_id=p.donor_id
   LEFT JOIN page_totals b ON b.page_id=p.id WHERE p.campaign_id=? AND ${peerVisible('p')} ORDER BY raisedCents DESC,p.title,p.id`, campaignId),
  all<PeerLeaderboardRow>(c, `${peerBalances} SELECT t.id,t.title,t.goal_cents AS goalCents,
   COALESCE((SELECT SUM(b.raisedCents) FROM cf_peer_pages p JOIN page_totals b ON b.page_id=p.id WHERE p.team_id=t.id AND ${peerVisible('p')}),0) AS raisedCents,
   COALESCE((SELECT SUM(b.giftCount) FROM cf_peer_pages p JOIN page_totals b ON b.page_id=p.id WHERE p.team_id=t.id AND ${peerVisible('p')}),0) AS giftCount
   FROM cf_peer_teams t WHERE t.campaign_id=? AND ${peerVisible('t')} ORDER BY raisedCents DESC,t.title,t.id`, campaignId),
 ])
 return { pages, teams, raisedCents: pages.reduce((sum, p) => sum + p.raisedCents, 0) }
}

/** Validate both generic and peer replays before any provider operation. A
 * generic saved intention cannot later be appropriated by a fundraising page. */
export async function verifyPeerCheckout(c: ReadContext, intentId: string, pageId: string | null): Promise<void> {
 const prior = await one(c, `SELECT i.id,p.page_id FROM cf_giving_intents i LEFT JOIN cf_peer_intents p ON p.intent_id=i.id WHERE i.id=?`, intentId)
 if (prior && (prior.page_id ?? null) !== pageId) fail('checkout_changed', 'Reload before changing this gift’s fundraising page.', 409)
}

/** Append immediately after the intention insert in the checkout transaction.
 * Repeat all publication and attribution guards inside that transaction. */
export async function preparePeerCheckout(c: ReadContext, intentId: string, pageId: string, campaignId: string): Promise<Stmt[]> {
 id(pageId, 'Fundraising page')
 await verifyPeerCheckout(c, intentId, pageId)
 const condition = `EXISTS(SELECT 1 FROM cf_peer_pages p WHERE p.id=? AND p.campaign_id=? AND ${peerVisible('p')})`
 if (!await one(c, `SELECT 1 WHERE ${condition}`, pageId, campaignId)) fail('PEER_UNAVAILABLE', 'That fundraising page is no longer available.', 409)
 return [
  guard(`changes()=1 OR EXISTS(SELECT 1 FROM cf_peer_intents WHERE intent_id=? AND page_id=?)`,
   'checkout_changed', 'Reload before changing this gift’s fundraising page.', intentId, pageId),
  guard(condition, 'PEER_UNAVAILABLE', 'That fundraising page is no longer available.', pageId, campaignId),
  guard(`EXISTS(SELECT 1 FROM cf_giving_intents WHERE id=? AND campaign_id=?) AND
   NOT EXISTS(SELECT 1 FROM cf_peer_intents WHERE intent_id=? AND page_id<>?)`,
  'checkout_changed', 'Reload before changing this gift’s fundraising page.', intentId, campaignId, intentId, pageId),
  sql('INSERT OR IGNORE INTO cf_peer_intents(intent_id,page_id) VALUES(?,?)', intentId, pageId),
 ]
}

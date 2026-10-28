import { requireRole } from '../auth'
import { choice, commit, event, fail, guard, id, integer, one, type Context, type Row, type Stmt } from '../db'
import { usd } from '../money'
import { mailSuppressed } from '../receipt-mail'
import { uniquePortalEmail } from '../giving/portal-identity'
import { communicationGuards, communicationReasons } from '../communications/preference-rules'
import { requireConnection } from '../communications/connection'
import { prepareSolicitationRun } from '../solicitation'
import { submitMessage } from '../communications/outbound'
import { peerBalances, peerVisible } from './service'

// These fixed notices contain no solicitation. They use the existing newsletter
// topic permission; appeal frequency and ask limits retain their ordinary scope.
function factsQuery(kind: 'page' | 'team') {
 const total = kind === 'page' ? 'COALESCE((SELECT raisedCents FROM page_totals WHERE page_id=p.id),0)'
  : `COALESCE((SELECT SUM(b.raisedCents) FROM cf_peer_pages child JOIN page_totals b ON b.page_id=child.id WHERE child.team_id=p.id AND ${peerVisible('child')}),0)`
 return `${peerBalances} SELECT p.*,d.email,${total} AS raisedCents
 FROM cf_peer_${kind === 'page' ? 'pages' : 'teams'} p JOIN cf_donors d ON d.id=p.donor_id
 WHERE p.id=? AND ${peerVisible('p')}`
}

/** Explicit human submission, never a scheduler or a supporter impersonation.
 * Existing communications retain the one-attempt claim, provider result, donor
 * file, reply handling, merge history, archive custody and erasure behavior. */
export async function peerNoticeCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'peer.sendNotice') return
 requireRole(c.actor, ['owner', 'admin'], 'send fundraiser notices')
 const recordId = id(p.recordId, 'Fundraising record'), kind = choice(p.recordType ?? 'page', ['page', 'team'], 'fundraising record type')
 const notice = choice(p.notice, ['thank', 'milestone'], 'fundraiser notice'), version = integer(Number(p.version), 'Fundraising version', 1)
 if (p.confirm !== 'SEND') fail('PEER_CONFIRM', 'Confirm SEND for this fundraising record and notice.', 400)
 const query = factsQuery(kind), row = await one(c, query, recordId)
 if (!row || row.version !== version) fail('PEER_CHANGED', 'The published fundraising record changed. Review it before sending.', 409)
 if (!row.email) fail('PEER_EMAIL', 'The fundraiser needs a current, unique email address.', 409)
 if (notice === 'milestone' && row.raisedCents < row.goal_cents) fail('PEER_GOAL', 'The fundraising goal has not been reached.', 409)
 const key = `peer:${kind}:${recordId}:${notice}`
 const previous = await one(c, 'SELECT * FROM cf_communications WHERE message_key=?', key)
 if (previous) { await commit(c, []); return previous }
 if(!c.env || mailSuppressed(c.env)) fail('PEER_SUPPRESSED', 'Email is suppressed in local and demo mode. No notice was submitted.', 503)
 const conn = await requireConnection(c)
 if (conn.provider !== 'mailchimp') fail('PEER_SENDER', 'Connect Mailchimp for confirmed individual fundraiser submissions. A Mango list handoff is not an email send.', 409)
 const connection = await one(c, 'SELECT merge_version FROM cf_email_connection WHERE id=1')
 const reasons = await communicationReasons(c, [row.donor_id], 'email', 'newsletter')
 if (reasons.get(row.donor_id)) fail('COMMUNICATION_RESTRICTED', 'This fundraiser has excluded the newsletter topic.', 409)
 const checks = async (): Promise<Stmt[]> => [
  guard(`EXISTS(SELECT 1 FROM (${query}) current WHERE version=? AND donor_id=? AND title=? AND goal_cents=? AND raisedCents=? AND email=?)`,
   'PEER_CHANGED', 'The fundraising facts changed before submission.', recordId, version, row.donor_id, row.title, row.goal_cents, row.raisedCents, row.email),
  guard(`${uniquePortalEmail} AND EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.email=? AND
   (SELECT status FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1)='granted')`,
   'PEER_CONSENT', 'The fundraiser needs current consent and a unique email address.', row.email, row.email, row.donor_id, row.email),
  guard("EXISTS(SELECT 1 FROM cf_email_connection WHERE id=1 AND provider='mailchimp' AND merge_version=? AND credential=? AND list_id IS ? AND from_name IS ? AND from_email IS ?)", 'PEER_SENDER', 'The approved email connection changed.', connection!.merge_version, conn.credential, conn.listId, conn.fromName, conn.fromEmail),
  ...await communicationGuards(c, [row.donor_id], 'email', 'newsletter', {kind:'welcome',id:key}),
 ]
 const classification = await prepareSolicitationRun(c, {kind:'welcome',id:key,channel:'email',isAsk:false,donorIds:[row.donor_id]})
 await commit(c, [...classification.statements, ...await checks(), event(c, 'peer.noticeApproved', 'peer_'+kind, recordId, row.donor_id, {notice,version,isAsk:false,topic:'newsletter'})])
 const subject = notice === 'thank' ? 'Thank you for fundraising' : 'Your fundraising goal is reached'
 const body = notice === 'thank' ? `Thank you for creating “${row.title}” and supporting this campaign.`
  : `Congratulations! “${row.title}” has raised ${usd(row.raisedCents)} toward its ${usd(row.goal_cents)} goal. This is received money after reversals; soft credits are separate.`
 return submitMessage(c, {key,donorId:row.donor_id,sourceKind:'welcome',sourceId:key,subject,body,listName:'Coffer fundraiser notices',
  rendered:{subject,body},expectedEmail:row.email,checks})
}

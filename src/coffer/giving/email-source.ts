import { fail, guard, newId, one, sql, today, type Context, type Row } from '../db'
import { requireRole } from '../auth'
import { settings } from '../settings'

type SourceContext = { db: D1Database; now?: string }
const sourceDay = async (c: SourceContext) => today((await settings(c)).timezone, c.now ? new Date(c.now) : new Date())

/** A run-wide source records attribution only. It contains no recipient identity or permission. */
export async function prepareEmailSource(c: Context, input: Row, runId: string, code: string, message: Row | null) {
 if (!input.donationCampaignId) return null
 requireRole(c.actor, ['owner', 'admin'], 'choose an appeal donation link')
 if (input.channel !== 'email' || (input.purpose && input.purpose !== 'appeal') || !message) fail('EMAIL_SOURCE', 'Choose a donation campaign for a written email appeal.', 400)
 const day = await sourceDay(c)
 const campaign = await one(c, 'SELECT id,slug,fund,name FROM cf_campaigns WHERE id=? AND active=1 AND (closes_on IS NULL OR closes_on>=?)', input.donationCampaignId, day)
 if (!campaign) fail('EMAIL_SOURCE', 'Choose a donation campaign that is still accepting gifts.', 409)
 const token = newId(), url = new URL('/give/' + campaign.slug, c.env!.AUTH_ORIGIN)
 url.searchParams.set('appeal', code)
 url.searchParams.set('emailSource', token)
 return { id: token, appeal_id: runId, campaign_id: campaign.id, slug: campaign.slug, fund: campaign.fund, code, url: url.href, day }
}

const currentCampaign = `EXISTS(SELECT 1 FROM cf_campaigns c WHERE c.id=s.campaign_id AND c.slug=s.slug AND c.fund=s.fund AND c.active=1 AND (c.closes_on IS NULL OR c.closes_on>=?))`
export async function emailSourceGuards(c: SourceContext, appealId: string) {
 const source = await one(c, 'SELECT id FROM cf_appeal_email_sources WHERE appeal_id=?', appealId)
 return source ? [guard(`EXISTS(SELECT 1 FROM cf_appeal_email_sources s JOIN cf_appeals a ON a.id=s.appeal_id WHERE s.id=? AND s.content_hash=a.content_hash AND ${currentCampaign})`, 'EMAIL_SOURCE', 'The donation campaign changed or closed. Prepare and approve a new email appeal.', source.id, await sourceDay(c))] : []
}

export function emailSourceStatements(source: Row | null, hash: string) {
 return source ? [
  guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND slug=? AND fund=? AND active=1 AND (closes_on IS NULL OR closes_on>=?))', 'EMAIL_SOURCE', 'The donation campaign changed or closed. Prepare again.', source.campaign_id, source.slug, source.fund, source.day),
  sql('INSERT INTO cf_appeal_email_sources(id,appeal_id,campaign_id,slug,fund,code,url,content_hash) VALUES(?,?,?,?,?,?,?,?)', source.id, source.appeal_id, source.campaign_id, source.slug, source.fund, source.code, source.url, hash),
 ] : []
}

/** Caller channel flags never participate. Only the approved native source can choose email. */
export async function emailSource(c: SourceContext, slug: string, token: unknown, appeal?: unknown) {
 if (token === undefined || token === null || token === '') return null
 if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/.test(token)) fail('email_source', 'This email donation link is not available.', 410)
 const source = await one(c, `SELECT s.* FROM cf_appeal_email_sources s JOIN cf_appeals a ON a.id=s.appeal_id
  JOIN cf_approvals p ON p.subject_kind='appeal' AND p.subject_id=a.id AND p.content_hash=a.content_hash
  WHERE s.id=? AND s.slug=? AND a.channel='email' AND a.status IN ('approved','exported','sent') AND s.content_hash=a.content_hash AND ${currentCampaign}`, token, slug, await sourceDay(c))
 if (!source || appeal && (typeof appeal !== 'string' || appeal.trim().toLowerCase() !== source.code.toLowerCase())) fail('email_source', 'This email donation link changed, closed or was not approved. Use the ordinary campaign page.', 410)
 return source
}

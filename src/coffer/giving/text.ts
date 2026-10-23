import { fail, one, sha256 } from '../db'
import { openGiving, sealGiving } from './connections'
import type { GivingEnv } from './stripe'

export async function textLink(env: GivingEnv, slug: string, token: unknown) {
 if (!token) return null
 if (typeof token !== 'string' || token.length > 4000) fail('invalid_link', 'Request a new giving link.', 400)
 const value = await openGiving(env, token)
 if (value.slug !== slug || !Number.isFinite(value.expires) || value.expires < Date.now() || !/^\+[1-9]\d{7,14}$/.test(value.phone)) fail('invalid_link', 'This giving link expired. Text the keyword again.', 410)
 if (await one({ db: env.DB }, 'SELECT 1 FROM cf_text_stops WHERE phone_hash=?', await sha256(value.phone))) fail('sms_stopped', 'SMS is stopped for this number. Use the ordinary campaign page to give.', 409)
 return value
}
export async function keywordReply(env: GivingEnv, fields: URLSearchParams, at: string) {
 const phone = fields.get('From') ?? '', messageId = fields.get('MessageSid') ?? '', keyword = (fields.get('Body') ?? '').trim().toUpperCase()
 if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null
 const row = await one({ db: env.DB }, 'SELECT k.*,c.slug FROM cf_text_keywords k JOIN cf_campaigns c ON c.id=k.campaign_id WHERE keyword=?', keyword)
 if (!row || await one({ db: env.DB }, 'SELECT 1 FROM cf_text_stops WHERE phone_hash=?', await sha256(phone))) return null
 // The inbound keyword authorizes this single reply, never a marketing grant.
 const receipt = await env.DB.prepare('INSERT OR IGNORE INTO cf_sms_inbound SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM cf_text_stops WHERE phone_hash=?) RETURNING message_id').bind(messageId, at,await sha256(phone)).first()
 if (!receipt) return null
 const token = await sealGiving(env, { phone, slug: row.slug, appeal: row.appeal, expires: Date.now() + 15 * 60 * 1000 })
 return env.AUTH_ORIGIN + '/give/' + row.slug + '?text=' + encodeURIComponent(token)
}

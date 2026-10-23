import { all, commit, event, fail, one, sql, text, type Context, type Row } from '../db'
import { definedAppeal } from '../attribution'
import type { GivingEnv } from './stripe'

async function key(env: GivingEnv) {
 if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) fail('connection_unavailable', 'The installation secret is unavailable.', 503)
 return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode('coffer:giving:v1:' + env.SESSION_SECRET)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function sealGiving(env: GivingEnv, value: Row) {
 const iv = crypto.getRandomValues(new Uint8Array(12))
 const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(JSON.stringify(value))))
 return btoa(String.fromCharCode(...iv,...data)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
}
export async function openGiving(env: GivingEnv, sealed: string): Promise<Row> {
 try {
  const value = Uint8Array.from(atob(sealed.replaceAll('-','+').replaceAll('_','/')),v=>v.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: value.slice(0,12) }, await key(env), value.slice(12))))
 } catch { return fail('connection_unavailable', 'This giving connection or link is unavailable. Request a new link.', 503) }
}
export async function givingConnection(env: GivingEnv, name: string) {
 const saved = await one({ db: env.DB }, 'SELECT sealed FROM cf_giving_connections WHERE name=?', name)
 return saved ? openGiving(env, saved.sealed) : null
}
export async function textEnvironment(env: GivingEnv): Promise<GivingEnv> {
 const saved = await givingConnection(env, 'twilio')
 return saved ? { ...env, TWILIO_ACCOUNT_SID: saved.account, TWILIO_AUTH_TOKEN: saved.token, TWILIO_FROM: saved.from } : env
}
export async function givingConnectionCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command === 'giving.connectTwilio') {
  const account = text(p.account, 'Twilio account', 100), token = text(p.token, 'Twilio auth token', 200), from = text(p.from, 'Registered Twilio number', 20)
  if (!/^\+[1-9]\d{7,14}$/.test(from)) fail('INPUT', 'Use a phone number with + and country code.', 400)
  const sealed = await sealGiving(c.env as GivingEnv, { account, token, from })
  await commit(c, [sql("INSERT INTO cf_giving_connections VALUES('twilio',?,?) ON CONFLICT(name) DO UPDATE SET sealed=excluded.sealed,updated_at=excluded.updated_at", sealed, c.now), event(c, command, 'giving', 'twilio', null)])
  return { configured: true }
 }
 if (command !== 'giving.keyword') return undefined
 const keyword = text(p.keyword, 'Keyword', 30).toUpperCase(), campaignId = text(p.campaignId, 'Campaign', 100), appeal = await definedAppeal(c, p.appeal)
 if (!/^[A-Z][A-Z0-9]{1,29}$/.test(keyword) || /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|HELP|START|YES)$/.test(keyword)) fail('INPUT', 'Choose a distinct giving keyword of 2 to 30 letters or digits.', 400)
 if (!await one(c, 'SELECT id FROM cf_campaigns WHERE id=?', campaignId)) fail('INPUT', 'Choose an existing campaign.', 400)
 await commit(c, [sql('INSERT INTO cf_text_keywords VALUES(?,?,?,?)', keyword, campaignId, appeal, c.now), event(c, command, 'giving', campaignId, null, { keyword, appeal })])
 return { keyword, campaignId, appeal }
}
export const givingKeywords = (c: Pick<Context, 'db'>) => all(c, 'SELECT k.*,c.name,c.slug FROM cf_text_keywords k JOIN cf_campaigns c ON c.id=k.campaign_id ORDER BY keyword')

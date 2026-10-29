import type { ProfileField } from './profile-fields'
import { commit, event, fail, one, sql, type Context, type Row } from '../db'

export type Provider = 'mango' | 'mailchimp'
/** The saved connection. The credential stays server-side and is never rendered. */
export type Connection = { provider: Provider; origin: string | null; credential: string; listId: string | null; listName: string | null; fromName: string | null; fromEmail: string | null; checkedAt: string | null; checkNote: string | null; mergeSelection?:ProfileField[]; mergeVersion?:number; checkFields?:()=>Promise<void>; checkAuthority?:()=>Promise<void> }
export const providerTitle = (p: Provider) => p === 'mango' ? 'Mango' : 'Mailchimp'

const managed = (c: { env?: Row }) => Boolean(c.env?.RER_INSTALLATION_ID || c.env?.RER_MANAGEMENT_ORIGIN)
export async function savedConnection(c: { db: D1Database }): Promise<Connection | null> {
 const row = await one(c, 'SELECT * FROM cf_email_connection WHERE id=1')
 return row ? { provider: row.provider, origin: row.origin, credential: row.credential, listId: row.list_id, listName: row.list_name, fromName: row.from_name, fromEmail: row.from_email, checkedAt: row.checked_at, checkNote: row.check_note,mergeSelection:JSON.parse(row.merge_selection??'[]'),mergeVersion:row.merge_version,checkFields:async()=>{const current=await one(c,'SELECT merge_version FROM cf_email_connection WHERE id=1');if(current?.merge_version!==row.merge_version)fail('EMAIL_FIELDS_CHANGED','The provider field selection changed. Run this operation again.',409)} } : null
}
/** Null with a reason when nothing can be sent; the Appeals page links to the connect page. */
export async function emailConnection(c: { db: D1Database; env?: Row }): Promise<{ connection: Connection | null; unavailable: string | null }> {
 if (managed(c)) return { connection: null, unavailable: 'Email marketing is not available yet on RER Managed.' }
 const connection = await savedConnection(c)
 if (!connection) return { connection: null, unavailable: 'Connect Mango or Mailchimp to send appeals by email.' }
 if (connection.provider === 'mailchimp' && !connection.listId) return { connection: null, unavailable: 'Choose the Mailchimp audience to finish connecting.' }
 return { connection, unavailable: null }
}
export async function requireConnection(c: { db: D1Database; env?: Row }): Promise<Connection> {
 const { connection, unavailable } = await emailConnection(c)
 if (!connection) fail('EMAIL_NOT_CONNECTED', unavailable!, 409)
 return connection!
}

export function mangoOrigin(value: unknown): string {
 let url: URL
 try { url = new URL(String(value ?? '').trim()) } catch { return fail('INPUT', 'Enter Mango’s address as it appears in your browser, for example https://mango.example.org or http://127.0.0.1:8788.', 400) }
 const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
 if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || local && url.protocol === 'http:')) fail('INPUT', 'Use Mango’s https:// address. Only Mango on this same computer can use http://.', 400)
 return url.origin
}
export async function saveConnection(c: Context, value: Omit<Connection, 'checkedAt' | 'checkNote'>, checkNote: string) {
 if (/[\r\n\s]/.test(value.credential) || !value.credential || value.credential.length > 500) fail('INPUT', 'Paste the whole credential, with no spaces.', 400)
 await commit(c, [sql(`INSERT INTO cf_email_connection(id,provider,origin,credential,list_id,list_name,from_name,from_email,checked_at,check_note,saved_at,saved_by) VALUES(1,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,origin=excluded.origin,credential=excluded.credential,list_id=excluded.list_id,list_name=excluded.list_name,from_name=excluded.from_name,from_email=excluded.from_email,checked_at=excluded.checked_at,check_note=excluded.check_note,saved_at=excluded.saved_at,saved_by=excluded.saved_by,merge_selection=CASE WHEN cf_email_connection.provider=excluded.provider AND cf_email_connection.origin IS excluded.origin AND cf_email_connection.list_id IS excluded.list_id AND cf_email_connection.credential=excluded.credential THEN cf_email_connection.merge_selection ELSE '[]' END,merge_version=cf_email_connection.merge_version+1`,
  value.provider, value.origin, value.credential, value.listId, value.listName, value.fromName, value.fromEmail, c.now, checkNote, c.now, c.actor.name),
  event(c, 'marketing.connect', 'settings', 'email-connection', null, { provider: value.provider })])
}
export async function forgetConnection(c: Context) {
 await commit(c, [sql('DELETE FROM cf_email_connection WHERE id=1'), event(c, 'marketing.disconnect', 'settings', 'email-connection', null)])
}

import { fail, text, type Context, type Row } from '../db'
import { forgetConnection, mangoOrigin, savedConnection, saveConnection, type Connection } from './connection'
import { checkMango } from './mango'
import { mailchimpLists, mailchimpOrigin } from './mailchimp'
import { checkConstantContact } from './constant-contact-api'

const credential = (value: unknown, label: string) => text(String(value ?? '').trim(), label, 500)
const managedRefusal = (c: Context) => { if (c.env?.RER_INSTALLATION_ID || c.env?.RER_MANAGEMENT_ORIGIN) fail('MANAGED', 'Email marketing is not available yet on RER Managed.', 409) }

/** Connect, check and disconnect the email marketing provider from the Appeals page. */
export async function connectCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if(command==='marketing.connectConstantContact'){
  managedRefusal(c)
  if(p.confirm!=='yes'||p.trackingDisabled!=='yes')fail('CONFIRMATION_REQUIRED','Confirm that account-wide email tracking is Off before connecting Constant Contact.',400)
  const trackingEvidence=text(p.trackingEvidence,'Tracking-off confirmation',500)
  const fromName=text(p.fromName,'Sender name',100),senderEmail=String(p.fromEmail??'').trim().toLowerCase(),fromEmail=String(p.replyToEmail??'').trim().toLowerCase()
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)||!fromEmail||fromEmail!==String(c.env?.COFFER_REPLY_ADDRESS??'').trim().toLowerCase())fail('CONSTANT_CONTACT_REPLY','Use a verified sender and the installed Coffer inbound reply address.',400)
  const conn:Connection={provider:'constant-contact',origin:null,credential:text(p.accessToken,'Constant Contact access token',4000),listId:null,listName:null,fromName,fromEmail,senderEmail,trackingEvidence,checkedAt:null,checkNote:null}
  const note=await checkConstantContact(conn)
  await saveConnection(c,conn,note)
  return {provider:conn.provider,connected:true,note}
 }
 if (command === 'marketing.connectMango') {
  managedRefusal(c)
  const conn: Connection = { provider: 'mango', origin: mangoOrigin(p.origin), credential: credential(p.credential, 'Mango credential'), listId: null, listName: null, fromName: null, fromEmail: null, checkedAt: null, checkNote: null }
  const check = await checkMango(conn)
  if (!check.ok) fail('MANGO_SCOPE', check.note, 409)
  await saveConnection(c, conn, check.note)
  return { provider: 'mango', connected: true, note: check.note }
 }
 if (command === 'marketing.connectMailchimp') {
  managedRefusal(c)
  const key = credential(p.apiKey, 'Mailchimp API key'); mailchimpOrigin(key)
  const lists = await mailchimpLists(key)
  if (!lists.length) fail('MAILCHIMP_AUDIENCE', 'This Mailchimp account has no audience yet. Create one in Mailchimp (Audience → Create audience), then save the key again.', 409)
  await saveConnection(c, { provider: 'mailchimp', origin: null, credential: key, listId: null, listName: null, fromName: null, fromEmail: null }, `Key accepted. ${lists.length} audience${lists.length === 1 ? '' : 's'} found: choose one below.`)
  return { provider: 'mailchimp', audiences: lists }
 }
 if (command === 'marketing.chooseAudience') {
  const conn = await savedConnection(c)
  if (conn?.provider !== 'mailchimp') fail('EMAIL_NOT_CONNECTED', 'Save your Mailchimp API key first.', 409)
  const lists = await mailchimpLists(conn!.credential), list = lists.find(l => l.id === p.listId)
  if (!list) fail('INPUT', 'Choose one of the audiences listed.', 400)
  const fromName = text(p.fromName, 'Sender name', 100), fromEmail = String(p.fromEmail ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) fail('INPUT', 'Enter the reply-to email address donors will answer.', 400)
  await saveConnection(c, { ...conn!, listId: list!.id, listName: list!.name, fromName, fromEmail }, `Connected to the Mailchimp audience “${list!.name}” (${list!.members} contacts).`)
  return { provider: 'mailchimp', connected: true, audience: list }
 }
 if (command === 'marketing.check') {
  const conn = await savedConnection(c)
  if (!conn) fail('EMAIL_NOT_CONNECTED', 'Nothing is connected yet.', 409)
  const note = conn!.provider === 'mango' ? (await checkMango(conn!)).note : conn!.provider==='constant-contact'?await checkConstantContact(conn!):`Mailchimp key accepted; ${(await mailchimpLists(conn!.credential)).length} audiences found.`
  await saveConnection(c, conn!, note)
  return { provider: conn!.provider, note }
 }
 if (command === 'marketing.disconnect') { await forgetConnection(c); return { connected: false } }
 return undefined
}

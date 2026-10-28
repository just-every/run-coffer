import { manager } from '../auth'
import { all, commit, event, fail, guard, one, sha256, sql, type Context, type Row } from '../db'
import { recordIncomingReply } from '../communications/replies'
import { routingOwner } from '../relationship-owner'
import { connectionGuards, mailboxAccess, mailboxRole, providerChoice } from './connection'
import { messages, send, type Mail } from './provider'

export async function uniqueDonor(c:Pick<Context,'db'>,addresses:string[]) {
 const candidates=await all(c,`SELECT DISTINCT d.* FROM cf_donors d LEFT JOIN cf_contact_points p ON p.donor_id=d.id AND p.kind='email' AND p.active=1
  WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
  AND (lower(d.email) IN (SELECT value FROM json_each(?)) OR lower(p.value) IN (SELECT value FROM json_each(?)))`,JSON.stringify(addresses),JSON.stringify(addresses))
 return candidates.length===1?candidates[0]:null
}
export async function mailboxHistory(c:Context,donorId:string) {
 if(!manager(c.actor))return []
 return all(c,'SELECT id,provider,direction,subject,excerpt,link,occurred_at,state,note FROM cf_mailbox_messages WHERE donor_id=? ORDER BY occurred_at DESC,id DESC',donorId)
}
export async function capture(c:Context,row:Row,mail:Mail,forward:(to:string)=>Promise<void>) {
 const accountHash=await sha256(row.account),key=await sha256(accountHash+'\0'+mail.messageId.trim().replace(/^<|>$/g,'').toLowerCase())
 const prior=await one(c,'SELECT * FROM cf_mailbox_messages WHERE id=?',key),seen=await one(c,'SELECT id FROM cf_mailbox_seen WHERE id=?',key)
 if(seen&&!prior)return {logged:false,reason:'already captured'}
 const counterparts=mail.direction==='received'?mail.from:mail.to
 // Multi-party mail can contain another person's private facts; never guess.
 if(counterparts.length!==1||mail.direction==='received'&&(!mail.to.includes(row.account)||mail.to.some(value=>value!==row.account)||mail.from.includes(row.account)))return {logged:false,reason:'shared or unknown identity'}
 const donor=await uniqueDonor(c,counterparts)
 if(!donor)return {logged:false,reason:'shared or unknown identity'}
 const erased=await one(c,'SELECT erased_at FROM cf_mailbox_erased WHERE address_hash=?',await sha256(counterparts[0]))
 if(erased&&mail.at<=erased.erased_at)return {logged:false,reason:'erased history'}
 if(prior&&prior.donor_id!==donor.id)return {logged:false,reason:'identity changed'}
 await commit(c,[...connectionGuards(row),guard('EXISTS(SELECT 1 FROM cf_donors d WHERE id=? AND version=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))','DONOR_CHANGED','The matched constituent changed.',donor.id,donor.version),
  sql('INSERT OR IGNORE INTO cf_mailbox_seen VALUES(?)',key),
  sql("INSERT OR IGNORE INTO cf_mailbox_messages(id,donor_id,operator_id,provider,account_hash,direction,subject,excerpt,link,occurred_at,recorded_at,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,'logged')",key,donor.id,row.operator_id,row.provider,accountHash,mail.direction,mail.subject,mail.body,mail.link,mail.at,c.now),
  ...(!prior?[event(c,'mailbox.logged','mailbox',key,donor.id,{direction:mail.direction,provider:row.provider})]:[])])
 if(mail.direction==='received')await recordIncomingReply(c.env!,{id:key,donor_id:donor.id,source_kind:'mailbox',source_id:key,source_type:'mailbox',mailbox_id:key},{title:mail.subject,body:mail.body,key,automatic:mail.automatic,forward})
 return {logged:!prior,id:key,donorId:donor.id}
}
export async function mailboxSync(c:Context,p:Row) {
 mailboxRole(c)
 const provider=providerChoice(p.provider),auth=await mailboxAccess(c,provider)
 const page=await messages(provider,auth.token,auth.row.account,p.cursor?String(p.cursor):undefined)
 await commit(c,auth.checks)
 const outcomes=[]
 for(const mail of page.messages)outcomes.push(await capture(c,auth.row,mail,async to=>{
  const owner=await routingOwner(c.db,(await uniqueDonor(c,mail.from))?.id??'')
  if(!owner||!await one(c,"SELECT id FROM oa_operators WHERE id=? AND email=? AND status='active' AND role IN('owner','admin')",owner.id,to))fail('MAILBOX_PRIVATE','The assigned relationship manager needs private mailbox authority before forwarding.',403)
  await commit(c,auth.checks)
  await send(provider,auth.token,{from:auth.row.account,to,subject:'Donor reply: '+mail.subject,body:mail.body,messageId:(await sha256('forward:'+mail.messageId))+'@'+new URL(c.env!.AUTH_ORIGIN).hostname})
 }))
 return {outcomes,next:page.next}
}
export async function mailboxErasureStatements(c:Context,emails:string[]) {
 return Promise.all([...new Set(emails.map(v=>v.trim().toLowerCase()))].map(async value=>sql('INSERT INTO cf_mailbox_erased VALUES(?,?) ON CONFLICT(address_hash) DO UPDATE SET erased_at=MAX(erased_at,excluded.erased_at)',await sha256(value),c.now)))
}

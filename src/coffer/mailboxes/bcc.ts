import type { Bindings } from '../../auth.server'
import { one, type Context } from '../db'
import { authenticatedFrom, plainExcerpt, readRaw } from '../communications/replies'
import { connectionGuards } from './connection'
import { addresses } from './provider'
import { capture } from './store'

/** The opaque address plus Cloudflare's authenticated author must match a current grant. */
export async function receiveMailboxBcc(message:ForwardableEmailMessage,env:Bindings):Promise<boolean> {
 const match=/^coffer-bcc\+([0-9a-f-]{36})@([^@\s]+)$/.exec(message.to.toLowerCase())
 if(!match)return false
 if(env.RER_INSTALLATION_ID||env.RER_MANAGEMENT_ORIGIN||!env.COFFER_REPLY_DOMAIN||match[2]!==env.COFFER_REPLY_DOMAIN.toLowerCase()){message.setReject('Unknown mailbox logging address.');return true}
 const row=await one({db:env.DB},`SELECT m.*,o.display_name FROM cf_mailbox_connections m JOIN oa_operators o ON o.id=m.operator_id AND o.version=m.operator_version AND o.status='active' AND o.role IN('owner','admin') JOIN cf_giving_connections a ON a.name=('mailbox-app:'||m.provider) AND a.sealed=m.app_sealed WHERE m.bcc_token=?`,match[1])
 if(!row){message.setReject('Mailbox logging authority was revoked.');return true}
 const raw=await readRaw(message)
 if(!raw||message.from.trim().toLowerCase()!==row.account||authenticatedFrom(raw)!==row.account){message.setReject('Mailbox logging needs an authenticated connected sender.');return true}
 const headers=new Headers()
 const head=new TextDecoder().decode(raw).split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g,' ')
 for(const line of head.split(/\r?\n/)){const at=line.indexOf(':');if(at>0)headers.append(line.slice(0,at),line.slice(at+1).trim())}
 const to=addresses([headers.get('to'),headers.get('cc')].filter(Boolean).join(',')),messageId=headers.get('message-id'),date=headers.get('date')
 if(!messageId||!date||!Number.isFinite(Date.parse(date))){message.setReject('Mailbox logging needs a message identity and date.');return true}
 const c:Context={db:env.DB,env,actor:{id:row.operator_id,name:row.display_name,role:'owner'},authority:{sql:connectionGuards(row)[0].check!.condition,params:connectionGuards(row)[0].params},now:new Date().toISOString()}
 const query=encodeURIComponent('rfc822msgid:'+messageId.replace(/^<|>$/g,''))
 const link=row.provider==='gmail'?'https://mail.google.com/mail/u/'+encodeURIComponent(row.account)+'/#search/'+query:'https://outlook.office.com/mail/search?q='+encodeURIComponent(messageId)
 const result=await capture(c,row,{providerId:messageId,messageId,from:[row.account],to,subject:(headers.get('subject')??'(No subject)').slice(0,400),body:plainExcerpt(raw),at:new Date(date).toISOString(),link,automatic:false,direction:'sent'},async()=>{})
 if(!result.logged&&result.reason!=='already captured'&&!result.id)message.setReject('Mailbox logging needs one uniquely matched current constituent.')
 return true
}

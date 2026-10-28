import { fail, text, type Row } from '../db'

export type Provider = 'gmail' | 'microsoft'
export const providers: Provider[] = ['gmail','microsoft']
export const scopes = (p:Provider) => p==='gmail'
 ? 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'
 : 'offline_access User.Read Mail.Read Mail.Send'
export const tokenUrl = (p:Provider) => p==='gmail'?'https://oauth2.googleapis.com/token':'https://login.microsoftonline.com/common/oauth2/v2.0/token'
export const authorizeUrl = (p:Provider) => p==='gmail'?'https://accounts.google.com/o/oauth2/v2/auth':'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
export async function request(url:string,init:RequestInit={}):Promise<Row> {
 let response:Response
 try { response=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(15000)}) }
 catch { return fail('MAILBOX_UNREACHABLE','The mailbox did not confirm a response. Review it before trying another action.',502) }
 if(!response.ok)fail('MAILBOX_REJECTED','The mailbox refused access. Review its permissions and reconnect if needed.',response.status===401||response.status===403?409:502)
 if(response.status===202||response.status===204)return {}
 const value=await response.json().catch(()=>null)
 if(!value||typeof value!=='object'||Array.isArray(value))fail('MAILBOX_RESPONSE','The mailbox returned an unreadable response.',502)
 return value as Row
}
export async function token(p:Provider,parameters:Row) {
 const value=await request(tokenUrl(p),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(parameters)})
 if(typeof value.access_token!=='string'||!value.access_token||value.token_type?.toLowerCase()!=='bearer')fail('MAILBOX_TOKEN','The mailbox did not grant usable access.',502)
 if(value.scope){const granted=String(value.scope).split(' ');for(const scope of scopes(p).split(' ').filter(s=>s!=='offline_access'))if(!granted.includes(scope))fail('MAILBOX_SCOPE','Approve mailbox reading and sending to connect.',409)}
 return value
}
export const normalizeAddress=(value:string)=>value.trim().toLowerCase()
export function addresses(value:string):string[] {
 // Do not guess malformed groups or names containing an extra address.
 return [...new Set((value.match(/[^\s<>(),;:\"]+@[^\s<>(),;:\"]+/g)??[]).map(normalizeAddress))]
}
export const base64=(value:string)=>btoa(String.fromCharCode(...new TextEncoder().encode(value)))
export const base64url=(value:string)=>base64(value).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
const decode=(value:string)=>new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)))
export type Mail = {providerId:string;messageId:string;from:string[];to:string[];subject:string;body:string;at:string;link:string|null;automatic:boolean;direction:'received'|'sent'}
export async function profile(p:Provider,accessToken:string) {
 const value=await request(p==='gmail'?'https://gmail.googleapis.com/gmail/v1/users/me/profile':'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName',{headers:{authorization:'Bearer '+accessToken}})
 const address=normalizeAddress(p==='gmail'?value.emailAddress:value.mail??value.userPrincipalName??'')
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address))fail('MAILBOX_IDENTITY','The provider did not identify your personal mailbox.',409)
 return address
}
export function gmailMail(value:Row,account:string):Mail {
 const h=new Map<string,string>((value.payload?.headers??[]).map((v:Row)=>[String(v.name).toLowerCase(),String(v.value)]))
 function plain(part:Row,depth=0):string {
  if(depth>5||part.filename)return ''
  if(part.mimeType==='text/plain'&&part.body?.data){try{return decode(part.body.data).slice(0,4000)}catch{return ''}}
  for(const child of part.parts??[]){const body=plain(child,depth+1);if(body)return body}return ''
 }
 const from=addresses(h.get('from')??''),sent=(value.labelIds??[]).includes('SENT')&&from.length===1&&from[0]===account
 const at=new Date(Number(value.internalDate)).toISOString()
 return {providerId:text(value.id,'Provider message',1000),messageId:h.get('message-id')??'gmail:'+value.id,from,to:addresses([h.get('to'),h.get('cc')].filter(Boolean).join(',')),subject:(h.get('subject')??'(No subject)').slice(0,400),body:plain(value.payload??{}),at,link:'https://mail.google.com/mail/u/'+encodeURIComponent(account)+'/#all/'+encodeURIComponent(value.id),automatic:isAutomatic(h.get('auto-submitted'),h.get('subject')),direction:sent?'sent':'received'}
}
const isAutomatic=(auto?:string,title?:string)=>!!auto&&!/^no(?:\s*;|\s*$)/i.test(auto)||/^(?:automatic reply|out of (?:the )?office|auto(?:matic)?[- ]response)\b/i.test(title??'')
export function graphMail(value:Row,account:string):Mail {
 const from=addresses(value.from?.emailAddress?.address??''),headers=new Map<string,string>((value.internetMessageHeaders??[]).map((v:Row)=>[String(v.name).toLowerCase(),String(v.value)]))
 const sent=from.length===1&&from[0]===account
 const at=new Date(sent?value.sentDateTime:value.receivedDateTime).toISOString()
 let link:string|null=null
 try{const url=new URL(value.webLink);if(url.protocol==='https:'&&['outlook.office.com','outlook.office365.com','outlook.live.com'].includes(url.hostname))link=url.href}catch{}
 return {providerId:text(value.id,'Provider message',1000),messageId:value.internetMessageId||'microsoft:'+value.id,from,to:[...new Set([...(value.toRecipients??[]),...(value.ccRecipients??[])].flatMap(v=>addresses(v.emailAddress?.address??'')))],subject:String(value.subject||'(No subject)').slice(0,400),body:value.body?.contentType?.toLowerCase()==='text'?String(value.body.content).slice(0,4000):'',at,link,automatic:isAutomatic(headers.get('auto-submitted'),value.subject),direction:sent?'sent':'received'}
}
export async function messages(p:Provider,accessToken:string,account:string,cursor?:string):Promise<{messages:Mail[];next:string|null}> {
 const headers={authorization:'Bearer '+accessToken,Prefer:'outlook.body-content-type="text"'}
 if(p==='gmail'){
  const url=new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');url.search=new URLSearchParams({maxResults:'25',q:'in:inbox OR in:sent',...(cursor?{pageToken:text(cursor,'Mailbox page',4000)}:{})}).toString()
  const result=await request(url.href,{headers});if(!Array.isArray(result.messages)&&result.resultSizeEstimate!==0)fail('MAILBOX_RESPONSE','The provider did not return a message list.',502)
  const values:Mail[]=[]
  for(const item of result.messages??[])values.push(gmailMail(await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(text(item.id,'Provider message',1000))+'?format=full',{headers}),account))
  return {messages:values,next:result.nextPageToken??null}
 }
 const first='https://graph.microsoft.com/v1.0/me/messages?$top=25&$select=id,internetMessageId,from,toRecipients,ccRecipients,subject,body,receivedDateTime,sentDateTime,webLink,internetMessageHeaders,isDraft'
 const url=new URL(cursor??first)
 if(url.origin!=='https://graph.microsoft.com'||url.pathname!=='/v1.0/me/messages'||url.username||url.password)fail('MAILBOX_PAGE','This mailbox page is not valid.',400)
 const result=await request(url.href,{headers});if(!Array.isArray(result.value))fail('MAILBOX_RESPONSE','The provider did not return a message list.',502)
 return {messages:result.value.filter((v:Row)=>!v.isDraft).map((v:Row)=>graphMail(v,account)),next:result['@odata.nextLink']??null}
}
export async function send(p:Provider,accessToken:string,input:{from:string;to:string;subject:string;body:string;messageId:string}) {
 const subject=text(input.subject,'Subject',400)
 if(/[\r\n]/.test(subject)||/[\r\n]/.test(input.from+input.to+input.messageId))fail('INPUT','Mail headers must be a single line.',400)
 if(p==='gmail'){
  const raw=`From: ${input.from}\r\nTo: ${input.to}\r\nSubject: =?UTF-8?B?${base64(subject)}?=\r\nMessage-ID: <${input.messageId}>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(input.body)}`
  const result=await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{authorization:'Bearer '+accessToken,'content-type':'application/json'},body:JSON.stringify({raw:base64url(raw)})})
  if(!result.id)fail('MAILBOX_RESPONSE','Gmail did not confirm submission. Inspect Sent mail before taking further action.',502)
  return 'https://mail.google.com/mail/u/'+encodeURIComponent(input.from)+'/#all/'+encodeURIComponent(result.id)
 }
 await request('https://graph.microsoft.com/v1.0/me/sendMail',{method:'POST',headers:{authorization:'Bearer '+accessToken,'content-type':'application/json'},body:JSON.stringify({message:{subject,body:{contentType:'Text',content:input.body},toRecipients:[{emailAddress:{address:input.to}}],internetMessageHeaders:[{name:'X-Coffer-Request',value:input.messageId}]},saveToSentItems:true})})
 return null
}

import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {run,donor,reviewed,archive,restore,installation} from './harness.mjs'
import {fixedNow} from './fixed-clock.mjs'

const address=n=>['synthetic-coffer-'+n,'example.test'].join('@')
const encode=value=>Buffer.from(value).toString('base64url')
export async function mailboxesJourney(){
 const inbox={gmail:[],microsoft:[]},submitted=[],keys={clientId:'synthetic-coffer-4001',clientSecret:'synthetic-coffer-4002'}
 let account,uncertain=false,revoked=false,harness,disconnectDuringRead=false
 const edge=async request=>{
  const u=new URL(request.url),provider=u.hostname==='graph.microsoft.com'||u.hostname==='login.microsoftonline.com'?'microsoft':'gmail'
  if(u.hostname==='oauth2.googleapis.com'||u.hostname==='login.microsoftonline.com'){
   const p=new URLSearchParams(await request.text());assert.equal(p.get('client_id'),keys.clientId);assert.equal(p.get('client_secret'),keys.clientSecret)
   if(revoked)return Response.json({error:'invalid_grant'},{status:401})
   if(p.get('grant_type')==='authorization_code'){assert.equal(p.get('code'),'synthetic-coffer-4003');assert.ok(p.get('code_verifier').length>=43);assert.ok(p.get('redirect_uri').endsWith('/'+provider+'/callback'))}
   else{assert.equal(p.get('grant_type'),'refresh_token');assert.equal(p.get('refresh_token'),'synthetic-coffer-4004')}
   return Response.json({access_token:'synthetic-coffer-4005',refresh_token:'synthetic-coffer-4004',token_type:'Bearer'})
  }
  assert.equal(request.headers.get('authorization'),'Bearer synthetic-coffer-4005')
  if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:account})
  if(u.pathname==='/v1.0/me')return Response.json({id:'synthetic-coffer-4006',mail:account})
  if(u.pathname.endsWith('/messages/send')||u.pathname.endsWith('/sendMail')){
   const value=await request.json()
   const raw=provider==='gmail'?Buffer.from(value.raw,'base64url').toString():JSON.stringify(value)
   submitted.push({provider,raw,value})
   if(uncertain)throw Error('Synthetic lost provider response after acceptance')
   return provider==='gmail'?Response.json({id:'synthetic-coffer-sent-'+submitted.length}):new Response(null,{status:202})
  }
  if(disconnectDuringRead){disconnectDuringRead=false;await harness.command('mailbox.disconnect',{provider})}
  if(provider==='gmail'){
   assert.equal(u.hostname,'gmail.googleapis.com')
   if(u.pathname.endsWith('/messages'))return Response.json({messages:inbox.gmail.map(m=>({id:m.id})),resultSizeEstimate:inbox.gmail.length})
   const mail=inbox.gmail.find(m=>u.pathname.endsWith('/'+m.id));assert.ok(mail,'Requested message exists on the Gmail edge');return Response.json(mail)
  }
  assert.equal(u.pathname,'/v1.0/me/messages');assert.equal(request.headers.get('prefer'),'outlook.body-content-type="text"')
  return Response.json({value:inbox.microsoft})
 }
 await run(async h=>{
  harness=h;await reviewed(h);account=(await h.get('/auth/session')).operator.email
  const admin=await h.person(address(4007),'admin'),member=await h.person(address(4008))
  const agent=await h.command('agent.create',{label:'Synthetic mailbox refusal'}),agentOptions={as:'',headers:{authorization:'Bearer '+agent.token},status:403}
  const ada=await donor(h,'Ada Mailbox',{email:address(4010)}),rosa=await donor(h,'Rosa Mailbox',{email:address(4011)})
  const shared=address(4012)
  await donor(h,'Lee Shared',{email:shared,household:'Synthetic shared household'})
  await donor(h,'Sam Shared',{email:shared,household:'Synthetic shared household'})
  const consent=(d,status='granted')=>h.command('consent.record',{donorIds:[d.id],channel:'email',status,method:'paper form',evidence:'Synthetic explicit mailbox preference',capturedOn:'2026-10-01'})
  await consent(ada);await consent(rosa)
  const portfolio=await h.command('portfolio.save',{name:'Synthetic mailbox relationships',managerId:admin.id,untouchedDays:90})
  const prior=(await h.get('/api/coffer/portfolios')).portfolios.find(p=>p.rows.some(r=>r.donor_id===ada.id))
  await h.command('portfolio.assign',{donorId:ada.id,portfolioId:portfolio.id,previousPortfolioId:prior.id})
  const connect=async(provider,{as=h.owner}={})=>{
   await h.command('mailbox.configure',{provider,...keys,confirm:'yes'},{as})
   const started=await h.command('mailbox.start',{provider,confirm:'yes'},{as}),url=new URL(started.authorizeUrl)
   assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('scope').includes(provider==='gmail'?'gmail.readonly':'Mail.Read'))
   const callback='/app/settings/mailboxes/'+provider+'/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-coffer-4003'})
   assert.equal((await h.request(callback,{as:member.cookie})).status,403,'A member cannot consume owner mailbox authority')
   assert.equal((await h.request(callback,{as,headers:{'sec-fetch-site':'cross-site'}})).status,303)
   assert.equal((await h.request(callback,{as})).status,409,'OAuth state is single use')
  }
  const mail=(provider,key,from,to,body,{sent=false,automatic=false}={})=>{
   const subject='Library conversation '+key,messageId=['synthetic-coffer-'+key,'example.test'].join('@')
   if(provider==='gmail')return {id:key,labelIds:[sent?'SENT':'INBOX'],internalDate:String(Date.parse(fixedNow)),payload:{mimeType:'text/plain',headers:[{name:'From',value:from},{name:'To',value:to},{name:'Subject',value:subject},{name:'Message-ID',value:'<'+messageId+'>'},...(automatic?[{name:'Auto-Submitted',value:'auto-replied'}]:[])],body:{data:encode(body)}}}
   return {id:key,internetMessageId:'<'+messageId+'>',from:{emailAddress:{address:from}},toRecipients:[{emailAddress:{address:to}}],ccRecipients:[],subject,body:{contentType:'text',content:body},sentDateTime:fixedNow,receivedDateTime:fixedNow,webLink:'https://outlook.office.com/mail/id/'+key,internetMessageHeaders:automatic?[{name:'Auto-Submitted',value:'auto-replied'}]:[]}
  }
  const prepare=(d=ada,extra={})=>h.command('mailbox.prepare',{provider:'gmail',donorId:d.id,requestId:randomUUID(),purpose:'newsletter',subject:'A personal library update',body:'Thank you for visiting our reading room.',...extra})
  for(const command of ['configure','start','disconnect','sync','prepare','submit']){
   await h.command('mailbox.'+command,{provider:'gmail',...keys,confirm:'yes'},{as:member.cookie,status:403})
   await h.command('mailbox.'+command,{provider:'gmail',...keys,confirm:'yes'},agentOptions)
  }
  await h.get('/api/coffer/mailboxes',{as:'',status:401});await h.get('/api/coffer/mailboxes',agentOptions)
  for(const provider of ['gmail','microsoft']){
   await connect(provider)
   const state=(await h.get('/api/coffer/mailboxes')).find(r=>r.provider===provider)
   assert.equal(state.connected,true);assert.equal(state.account,account);assert.ok(state.bcc)
   assert.equal((await h.get('/api/coffer/mailboxes',{as:admin.cookie})).find(r=>r.provider===provider).connected,false,'A second admin does not inherit the owner mailbox')
   inbox[provider]=[mail(provider,provider+'-received',ada.email??address(4010),account,'Thank you. I would love a reading room visit.'),mail(provider,provider+'-sent',account,address(4011),'Here is your reading room update.',{sent:true}),mail(provider,provider+'-unknown',address(4090),account,'Unknown private sender'),mail(provider,provider+'-shared',shared,account,'Shared private sender')]
   const sync=await h.command('mailbox.sync',{provider})
   assert.deepEqual(sync.outcomes.map(r=>r.logged),[true,true,false,false])
   const timeline=await h.get('/api/coffer/donors/'+ada.id),entry=timeline.mailboxMessages.find(m=>m.subject.endsWith(provider+'-received'))
   assert.equal(entry.excerpt,'Thank you. I would love a reading room visit.');assert.equal(entry.direction,'received');assert.ok(entry.link.startsWith('https://'))
   const sent=(await h.get('/api/coffer/donors/'+rosa.id)).mailboxMessages.find(m=>m.subject.endsWith(provider+'-sent'))
   assert.equal(sent.excerpt,'Here is your reading room update.');assert.equal(sent.direction,'sent')
   const reply=(await h.get('/api/coffer/replies')).find(r=>r.mailbox_id===entry.id)
   assert.equal(reply.owner_id,admin.id);assert.equal(reply.status,'forwarded');assert.equal(reply.body,entry.excerpt)
   const count=submitted.length;await h.command('mailbox.sync',{provider});assert.equal(submitted.length,count,'Replay never forwards the same reply twice')
   inbox[provider]=[mail(provider,provider+'-automatic',address(4010),account,'Please remove me',{automatic:true}),mail(provider,provider+'-stop',address(4010),account,'Please remove me from email appeals.'),mail(provider,provider+'-ambiguous',address(4011),account,'Perhaps fewer updates would be best.')]
   await h.command('mailbox.sync',{provider})
   let replies=await h.get('/api/coffer/replies'),stop=replies.find(r=>r.subject.endsWith(provider+'-stop')),ambiguous=replies.find(r=>r.subject.endsWith(provider+'-ambiguous'))
   assert.equal(replies.find(r=>r.subject.endsWith(provider+'-automatic')).status,'filed');assert.equal(replies.find(r=>r.subject.endsWith(provider+'-automatic')).stop_status,null)
   assert.equal(stop.stop_status,'automatic');assert.equal((await h.get('/api/coffer/donors/'+ada.id)).current.email.status,'withdrawn')
   await h.command('reply.reverseStop',{taskId:stop.id,stopVersion:1},{status:400})
   await h.command('reply.reverseStop',{taskId:stop.id,stopVersion:1,reason:'Synthetic reviewed misinterpretation'})
   assert.equal((await h.get('/api/coffer/donors/'+ada.id)).current.email.status,'granted')
   assert.equal(ambiguous.stop_status,null,'Ambiguous text does not withdraw automatically')
   await h.command('reply.proposeStop',{taskId:ambiguous.id,stopVersion:0},{as:member.cookie,status:403})
   await h.command('reply.proposeStop',{taskId:ambiguous.id,stopVersion:0})
   await h.command('reply.confirmStop',{taskId:ambiguous.id,stopVersion:1},{as:admin.cookie})
   assert.equal((await h.get('/api/coffer/donors/'+rosa.id)).current.email.status,'withdrawn')
   await consent(ada);await consent(rosa)
   const before=(await h.get('/api/coffer/donors/'+ada.id)).consents.length
   await h.command('mailbox.sync',{provider})
   assert.equal((await h.get('/api/coffer/donors/'+ada.id)).consents.length,before,'Replay preserves newer native consent')
   assert.equal((await h.get('/api/coffer/replies',{as:member.cookie})).filter(r=>r.mailbox_id).length,0)
   assert.equal((await h.get('/api/coffer/donors/'+ada.id,{as:member.cookie})).mailboxMessages.length,0,'Private mailbox content is not a broader staff grant')
   const bccKey=provider+'-bcc',bccMessage=mail(provider,bccKey,account,address(4011),'Logged from another mail client.',{sent:true})
   const bcc=(authenticated=true,to=address(4011))=>h.api('/test-email',{from:account,to:state.bcc,headers:{},raw:`Authentication-Results: mx.cloudflare.net; dmarc=${authenticated?'pass':'fail'} header.from=${account.split('@')[1]}\r\nFrom: ${account}\r\nTo: ${to}\r\nDate: ${fixedNow}\r\nSubject: Library conversation ${bccKey}\r\nMessage-ID: <${address(bccKey)}>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nLogged from another mail client.`})
   assert.ok((await bcc(false)).rejected);assert.ok((await bcc(true,shared)).rejected);assert.equal((await bcc()).rejected,null)
   const bccRows=(await h.get('/api/coffer/donors/'+rosa.id)).mailboxMessages.filter(r=>r.subject.endsWith(bccKey));assert.equal(bccRows.length,1);assert.equal(bccRows[0].excerpt,'Logged from another mail client.')
   inbox[provider]=[bccMessage];await h.command('mailbox.sync',{provider});await bcc();assert.equal((await h.get('/api/coffer/donors/'+rosa.id)).mailboxMessages.filter(r=>r.subject.endsWith(bccKey)).length,1,'BCC and provider sync share one message identity')
   const draft=await prepare(ada,{provider,subject:'Personal hello '+provider})
   const sentBefore=submitted.length
   const result=await h.command('mailbox.submit',{messageId:draft.id,confirm:'yes'});assert.equal(result.state,'submitted');assert.equal(submitted.length,sentBefore+1)
   const submission=submitted.at(-1);assert.equal(submission.provider,provider)
   if(provider==='gmail'){assert.match(submission.raw,/From: /);assert.ok(submission.raw.includes('To: '+address(4010)));assert.ok(submission.raw.includes(Buffer.from(draft.excerpt).toString('base64')))}
   else{assert.equal(submission.value.message.toRecipients[0].emailAddress.address,address(4010));assert.equal(submission.value.message.body.content,draft.excerpt)}
   await h.command('mailbox.submit',{messageId:draft.id,confirm:'yes'},{status:409});assert.equal(submitted.length,sentBefore+1)
  }
  const prefs=async(topics=['newsletter','appeals','events'],frequency='unlimited')=>{const version=(await h.get('/api/coffer/donors/'+ada.id+'/preferences')).channels.find(p=>p.channel==='email').version;return h.command('communication.preferences',{donorId:ada.id,channel:'email',version,topics,frequency,confirm:'yes'})}
  await prefs(['newsletter']);await prepare(ada,{purpose:'appeals'}).then(()=>assert.fail('Topic withdrawal must refuse'),e=>assert.match(String(e),/topic/))
  await prefs(undefined,'monthly')
  const ask=await prepare(ada,{purpose:'appeals'});assert.equal((await h.command('mailbox.submit',{messageId:ask.id,confirm:'yes'})).state,'submitted')
  await prepare(ada,{purpose:'appeals',provider:'microsoft'}).then(()=>assert.fail('Frequency cap must refuse'),e=>assert.match(String(e),/frequency/))
  await prefs()
  await h.command('solicitation.set',{donorId:ada.id,version:(await h.get('/api/coffer/donors/'+ada.id)).solicitation.version,type:'stop',startsOn:'2026-10-01',source:'person',sourceOn:'2026-10-01'})
  await prepare(ada,{purpose:'appeals'}).then(()=>assert.fail('Ask restriction must refuse'),e=>assert.match(String(e),/do not solicit/))
  const nonAsk=await prepare();assert.equal((await h.command('mailbox.submit',{messageId:nonAsk.id,confirm:'yes'})).state,'submitted','A restricted constituent can still receive a consented non-ask')
  const stale=await prepare();await consent(ada,'withdrawn');const before=submitted.length
  await h.command('mailbox.submit',{messageId:stale.id,confirm:'yes'},{status:409});assert.equal(submitted.length,before,'Withdrawn permission prevents provider handoff')
  await consent(ada)
  const unknown=await prepare();uncertain=true;assert.equal((await h.command('mailbox.submit',{messageId:unknown.id,confirm:'yes'})).state,'uncertain');uncertain=false
  await h.command('mailbox.submit',{messageId:unknown.id,confirm:'yes'},{status:409});assert.equal(submitted.length,before+1,'Uncertain acceptance is never automatically retried')
  const revokedDraft=await prepare();revoked=true;await h.command('mailbox.submit',{messageId:revokedDraft.id,confirm:'yes'},{status:409});revoked=false
  disconnectDuringRead=true;inbox.gmail=[mail('gmail','revoked-read',address(4010),account,'Must never be captured after disconnect.')]
  await h.command('mailbox.sync',{provider:'gmail'},{status:409})
  assert.ok(!(await h.get('/api/coffer/donors/'+ada.id)).mailboxMessages.some(r=>r.excerpt.includes('after disconnect')))
  await connect('gmail');await h.command('mailbox.submit',{messageId:revokedDraft.id,confirm:'yes'},{status:409})
  const file=await h.api('/api/coffer/donors/'+ada.id+'/data-request',{requestedOn:'2026-10-18',method:'email'})
  assert.ok(!JSON.stringify(file).includes('would love a reading room visit'),'Private mailbox excerpts remain withheld from donor files')
  if(process.env.COFFER_MAILBOX_BROWSER){const {mailboxesBrowser}=await import('./mailboxes-browser.mjs');await mailboxesBrowser(h,{directory:process.env.COFFER_MAILBOX_BROWSER,donorId:ada.id,keys})}
  const portable=await archive(h),restored=await installation({entry:'tests/engagement-worker.ts',bindings:{COFFER_TEST_NOW:fixedNow,COFFER_REPLY_DOMAIN:'replies.example.test'},outbound:edge})
  try{await restore(restored,portable);assert.equal((await restored.get('/api/coffer/mailboxes')).some(r=>r.connected),false);assert.ok((await restored.get('/api/coffer/donors/'+ada.id)).mailboxMessages.length>0,'Private logged history is portable without reconnecting a provider')}finally{await restored.close()}
  // An original capture follows the merge and undo without retargeting replay.
  const other=await donor(h,'Ada Duplicate',{email:address(4013)})
  const merge=await h.command('donor.merge',{sourceId:ada.id,donorId:other.id,sourceVersion:(await h.get('/api/coffer/donors/'+ada.id)).donor.version,version:other.version,fields:{email:ada.id}})
  assert.ok((await h.get('/api/coffer/donors/'+other.id)).mailboxMessages.length>0)
  await h.command('donor.unmerge',{mergeId:merge.id,reason:'Synthetic mailbox custody undo'})
  assert.ok((await h.get('/api/coffer/donors/'+ada.id)).mailboxMessages.length>0)
  await h.command('donor.erase',{donorId:ada.id,confirm:'ERASE'})
  await donor(h,'New Ada',{email:address(4010)})
  inbox.gmail=[mail('gmail','gmail-received',address(4010),account,'Thank you. I would love a reading room visit.'),mail('gmail','unseen-old',address(4010),account,'Erased old mailbox content')]
  assert.ok((await h.command('mailbox.sync',{provider:'gmail'})).outcomes.every(r=>!r.logged),'Replay and previously unseen old mail cannot resurrect erased history')
 },{entry:'tests/engagement-worker.ts',bindings:{COFFER_TEST_NOW:fixedNow,COFFER_REPLY_DOMAIN:'replies.example.test'},outbound:edge})
}

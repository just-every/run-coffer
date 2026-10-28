import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
import {constantContactEdge,ccAddress} from './constant-contact-edge.mjs'

export async function constantContactJourney(){
 const edge=constantContactEdge(),headers={'x-test-now':'2026-10-15T16:00:00Z'},directory=process.env.COFFER_CC_BROWSER??'.cache/constant-contact'
 await run(async h=>{
  const cmd=(name,p={},options={})=>h.command(name,p,{headers,...options}),get=path=>h.get(path,{headers})
  await reviewed(h)
  const member=await h.person(ccAddress(3603)),owner=(await get('/auth/session')).operator
  const connection={accessToken:'synthetic-coffer-3602',fromName:'Riverbend Literacy Project',fromEmail:edge.sender,replyToEmail:edge.reply,trackingDisabled:'yes',trackingEvidence:'Support case synthetic-coffer-3604; account tracking Off confirmed.',confirm:'yes'}
  await cmd('marketing.connectConstantContact',connection,{as:'',status:401})
  await cmd('marketing.connectConstantContact',connection,{as:member.cookie,status:403})
  await cmd('marketing.connectConstantContact',{...connection,trackingDisabled:''},{status:400})
  await cmd('marketing.connectConstantContact',{...connection,replyToEmail:edge.sender},{status:400})
  await mkdir(directory,{recursive:true})
  await withBrowserWorker(h,async(context,origin)=>{
   await context.setExtraHTTPHeaders({cookie:h.owner,...headers});const page=await context.newPage()
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/settings#constant-contact-sender')
    const panel=page.locator('#constant-contact-sender')
    await panel.getByLabel('Constant Contact access token',{exact:true}).fill(connection.accessToken)
    await panel.getByLabel('Sender name donors see',{exact:true}).fill(connection.fromName)
    await panel.getByLabel('Verified sender email address',{exact:true}).fill(edge.sender)
    await panel.getByLabel('Reply-to email address',{exact:true}).fill(edge.reply)
    await panel.locator('[name=trackingDisabled]').check();await panel.getByLabel('Tracking-off confirmation',{exact:true}).fill(connection.trackingEvidence);await panel.locator('[name=confirm]').check()
    await page.evaluate(()=>window.scrollBy(0,-100))
    await panel.screenshot({path:`${directory}/settings-ready-${width}.png`})
    await panel.getByRole('button',{name:width===1440?'Connect Constant Contact':'Replace Constant Contact sender',exact:true}).click()
    await page.locator('#constant-contact-sender').getByText('Constant Contact is the connected email sender.',{exact:false}).waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.locator('#constant-contact-sender').screenshot({path:`${directory}/settings-connected-${width}.png`})
    await page.goto(origin+'/app/appeals/connect');await page.getByText('Constant Contact', {exact:true}).first().waitFor()
    await page.screenshot({path:`${directory}/connection-${width}.png`,fullPage:true})
   }
  })
  assert.equal(edge.sends.length,0,'Saving the connection does not send a campaign')
  const consent=(d,status='granted')=>cmd('consent.record',{donorIds:[d.id],channel:'email',status,method:'paper form',evidence:'Recorded donor choice',capturedOn:'2026-10-01'})
  const create=async(name,n)=>{const email=ccAddress(n),d={...await donor(h,name,{email},{headers}),email};edge.contacts.set(email,{contact_id:'synthetic-coffer-'+n,email_address:{address:email,permission_to_send:'explicit'},list_memberships:[]});await cmd('donor.profile',{donorId:d.id,version:1,firstName:name.split(' ')[0],lastName:name.split(' ').slice(1).join(' ')});await consent(d);await cmd('gift.record',{donorId:d.id,amount:'125',receivedOn:'2026-10-01',method:'check',goods:'none',fund:'Library'});return d}
  const amina=await create('Amina Okafor',3610),jo=await create('Jo Miller',3611),restricted=await create('Evelyn Chen',3612),newsletter=await create('Sam Patel',3613)
  const preferences=async(d,topics,frequency='unlimited')=>{const current=(await get('/api/coffer/donors/'+d.id+'/preferences')).channels.find(p=>p.channel==='email');return cmd('communication.preferences',{donorId:d.id,channel:'email',version:current.version,topics,frequency,confirm:'yes'})}
  await preferences(amina,['newsletter','appeals'],'monthly');await preferences(newsletter,['newsletter'])
  await cmd('solicitation.set',{donorId:restricted.id,version:0,type:'stop',startsOn:'2026-10-01',source:'person',sourceOn:'2026-10-01'})
  await cmd('custom.define',{key:'reading_interest',label:'Reading interest',kind:'constituent',type:'text'})
  for(const d of [amina,jo,restricted,newsletter])await cmd('custom.set',{key:'reading_interest',recordId:d.id,value:'Adult literacy',source:'Donor form'})
  const selection=await get('/api/coffer/provider-fields')
  await cmd('marketing.fields',{version:selection.version,fields:'{{informal_salutation}}\n{{envelope_name}}\n{{total_given}}\n{{custom.reading_interest}}',confirm:'yes'})
  const appeal=await cmd('appeal.prepare',{name:'Reading room autumn appeal',channel:'email',subject:'Dear {{informal_salutation}}',body:'{{envelope_name}}: Thank you for {{total_given}}. Your interest: {{custom.reading_interest}}.'})
  assert.equal(appeal.excluded['do not solicit'],1);assert.equal(appeal.excluded.topic,1);assert.equal(appeal.recipients,2)
  await cmd('appeal.send',{appealId:appeal.id,version:1},{status:409})
  await cmd('appeal.approve',{appealId:appeal.id,version:1})
  await cmd('appeal.send',{appealId:appeal.id,version:2},{as:member.cookie,status:403})
  const sent=await cmd('appeal.send',{appealId:appeal.id,version:2});assert.equal(sent.submitted,2)
  assert.deepEqual(edge.sends.map(s=>s.email).sort(),[amina.email,jo.email].sort())
  const value=(d,label)=>{const field=edge.fields.find(f=>f.label==='Coffer '+label);return edge.contacts.get(d.email).custom_fields.find(f=>f.custom_field_id===field.custom_field_id).value}
  assert.equal(value(amina,'informal_salutation'),'Amina');assert.equal(value(amina,'envelope_name'),'Amina Okafor');assert.equal(value(amina,'total_given'),'$125.00');assert.equal(value(amina,'custom.reading_interest'),'Adult literacy')
  assert.ok(edge.sends.find(s=>s.email===amina.email).html_content.includes('Your interest: Adult literacy.'))
  const before=edge.sends.length;await cmd('appeal.send',{appealId:appeal.id,version:2});assert.equal(edge.sends.length,before)
  await cmd('appeal.export',{appealId:appeal.id,version:2})
  edge.sends.find(s=>s.email===jo.email).result='bounced'
  assert.equal((await cmd('marketing.refresh')).checked,2)
  assert.equal((await get('/api/coffer/donors/'+jo.id)).communications[0].remote_status,'bounced')
  const next=await cmd('appeal.prepare',{name:'Second October appeal',channel:'email',subject:'Next chapter',body:'Please support the next chapter.'})
  assert.equal(next.excluded.frequency,1)
  await cmd('appeal.approve',{appealId:next.id,version:1});await preferences(jo,['newsletter'])
  const held=edge.sends.length;await cmd('appeal.send',{appealId:next.id,version:2},{status:409});assert.equal(edge.sends.length,held,'Current topic is checked after approval')
  const news=await cmd('appeal.prepare',{name:'October newsletter',channel:'email',purpose:'newsletter',isAsk:'no',subject:'Library news',body:'Here is what your community made possible.'})
  assert.equal(news.recipients,4);await cmd('appeal.approve',{appealId:news.id,version:1});assert.equal((await cmd('appeal.send',{appealId:news.id,version:2})).submitted,4)
  await cmd('appeal.export',{appealId:news.id,version:2})
  assert.ok(edge.sends.slice(before).some(s=>s.email===restricted.email),'Newsletter still serves a restricted donor')
  const portfolio=await cmd('portfolio.save',{name:'Reading room relationships',managerId:member.id,untouchedDays:90})
  const prior=(await get('/api/coffer/portfolios')).portfolios.find(p=>p.rows.some(r=>r.donor_id===amina.id))
  await cmd('portfolio.assign',{donorId:amina.id,portfolioId:portfolio.id,previousPortfolioId:prior?.id})
  const message=(await get('/api/coffer/donors/'+amina.id)).communications.find(m=>m.source_id===appeal.id)
  let serial=0
  const receive=async(body,key='synthetic-coffer-reply-'+(++serial),automatic=false)=>{const response=await h.request('/test-email',{method:'POST',headers,body:{from:amina.email,to:edge.reply,headers:{subject:'Re: '+message.subject,'message-id':key,...(automatic?{'auto-submitted':'auto-replied'}:{})},raw:'Content-Type: text/plain; charset=utf-8\r\n\r\n'+body}});assert.equal(response.status,200);return response.json()}
  const thanks=await receive('Thank you. I would like to visit the reading room.','synthetic-coffer-thanks');assert.deepEqual(thanks.forwarded,[member.session.operator.email])
  assert.deepEqual((await receive('I am out of the office. Please remove me.','synthetic-coffer-automatic',true)).forwarded,[])
  assert.equal((await get('/api/coffer/replies')).find(r=>r.automatic).status,'filed')
  assert.equal((await get('/api/coffer/donors/'+amina.id)).current.email.status,'granted')
  let replies=await get('/api/coffer/replies'),task=replies.find(r=>r.body.includes('visit the reading room'))
  assert.equal(task.communication_id,message.id);assert.equal(task.owner_id,member.id)
  const ambiguous='I would prefer fewer updates about this project.';await receive(ambiguous)
  let proposal=(await get('/api/coffer/replies')).find(r=>r.body===ambiguous);assert.equal(proposal.stop_status,null)
  proposal=await cmd('reply.proposeStop',{taskId:proposal.id,stopVersion:proposal.stop_version});assert.equal((await get('/api/coffer/donors/'+amina.id)).current.email.status,'granted')
  await cmd('reply.confirmStop',{taskId:proposal.id,stopVersion:proposal.stop_version});assert.equal((await get('/api/coffer/donors/'+amina.id)).current.email.status,'withdrawn')
  edge.contacts.get(amina.email).email_address.permission_to_send='explicit';await consent(amina);const clear='Please remove me from your email list.'
  await receive(clear,'synthetic-coffer-stop');let file=await get('/api/coffer/donors/'+amina.id);assert.equal(file.current.email.status,'withdrawn');assert.equal(edge.contacts.get(amina.email).email_address.permission_to_send,'unsubscribed')
  const stopped=file.current.email.id;await receive(clear,'synthetic-coffer-stop');assert.equal((await get('/api/coffer/donors/'+amina.id)).current.email.id,stopped)
  await withBrowserWorker(h,async(context,origin)=>{
   await context.setExtraHTTPHeaders({cookie:h.owner,...headers});const page=await context.newPage()
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/appeals/'+appeal.id);await page.screenshot({path:`${directory}/appeal-results-${width}.png`,fullPage:true});await page.goto(origin+'/app/appeals');const row=page.locator('#donor-replies li').filter({hasText:clear});await row.getByRole('heading',{name:'Email consent withdrawn automatically',exact:true}).waitFor();await row.screenshot({path:`${directory}/reply-stopped-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
  })
  const trial=await create('Luis Romero',3630);edge.contacts.delete(trial.email)
  await cmd('custom.set',{key:'reading_interest',recordId:trial.id,value:'Reading room',source:'Donor form'})
  await cmd('gift.record',{donorId:trial.id,amount:'250',receivedOn:'2026-10-01',method:'check',goods:'none',fund:'Reading room'})
  const trialRun=async name=>{const r=await cmd('appeal.prepare',{name,channel:'email',fund:'Reading room',subject:'Reading room',body:'Thank you for keeping the reading room open.'});assert.equal(r.recipients,1);await cmd('appeal.approve',{appealId:r.id,version:1});return r}
  const lost=await trialRun('New subscriber with uncertain submission');edge.state.loseSend=true
  const priorSends=edge.sends.length;assert.equal((await cmd('appeal.send',{appealId:lost.id,version:2})).uncertain,1);edge.state.loseSend=false
  assert.equal(edge.sends.length,priorSends+1);assert.equal(edge.contacts.get(trial.email).email_address.permission_to_send,'implicit')
  await cmd('appeal.send',{appealId:lost.id,version:2});assert.equal(edge.sends.length,priorSends+1,'An unknown submission is never automatically resent')
  const unsafe=await trialRun('Unexpected provider audience');edge.state.extraRecipient=true
  await cmd('appeal.send',{appealId:unsafe.id,version:2});edge.state.extraRecipient=false;assert.equal(edge.sends.length,priorSends+1,'An extra provider recipient prevents sending')
  const late=await trialRun('Withdrawal during composition');edge.state.beforeCompose=()=>consent(trial,'withdrawn')
  await cmd('appeal.send',{appealId:late.id,version:2});edge.state.beforeCompose=null;assert.equal(edge.sends.length,priorSends+1,'A withdrawal at the final handoff prevents sending')
  const snapshot=await archive(h);assert.ok(!JSON.stringify(snapshot).includes(connection.accessToken),'Archives exclude the sender credential')
  await run(async target=>{await restore(target,snapshot);const restored=await target.get('/api/coffer/donors/'+amina.id);assert.equal(restored.current.email.status,'withdrawn');assert.ok(restored.communications.some(m=>m.id===message.id));assert.ok((await target.get('/api/coffer/replies')).some(r=>r.communication_id===message.id));await target.command('marketing.refresh');assert.equal((await target.get('/api/coffer/provider-fields')).provider,null)})
  edge.contacts.get(amina.email).email_address.permission_to_send='explicit';await consent(amina);await receive(clear,'synthetic-coffer-stop');assert.equal((await get('/api/coffer/donors/'+amina.id)).current.email.status,'granted','Replay cannot replace a newer donor answer')
  const remote=edge.contacts.get(newsletter.email);edge.sends.find(s=>s.email===newsletter.email).result='unsubscribed'
  await cmd('marketing.refresh');assert.equal((await get('/api/coffer/donors/'+newsletter.id)).current.email.status,'withdrawn','The opt-out report withdraws immediately even while the contact answer still lags')
  assert.equal(remote.email_address.permission_to_send,'unsubscribed')
  remote.email_address.permission_to_send='explicit';await consent(newsletter)
  const renewed=(await get('/api/coffer/donors/'+newsletter.id)).current.email.id
  await cmd('marketing.refresh');assert.equal((await get('/api/coffer/donors/'+newsletter.id)).current.email.id,renewed,'Replaying an old opt-out report preserves the newer confirmed donor choice')
  edge.state.revoked=true;const count=edge.sends.length;assert.ok((await cmd('marketing.sync')).pending>0);assert.equal(edge.sends.length,count);edge.state.revoked=false
  const target=await donor(h,'Amina Duplicate',{email:ccAddress(3620)},{headers}),comparison=await get('/api/coffer/duplicates/compare?source='+amina.id+'&target='+target.id)
  const merged=await cmd('donor.merge',{sourceDonorId:amina.id,donorId:target.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.ok((await get('/api/coffer/replies')).every(r=>r.donor_id===target.id))
  assert.ok((await receive(clear,'synthetic-coffer-stop')).rejected,'Merged identity does not reopen the old receiver')
  await cmd('reply.confirmStop',{taskId:proposal.id,stopVersion:proposal.stop_version},{status:409})
  await cmd('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.ok((await get('/api/coffer/replies')).every(r=>r.donor_id===amina.id))
  const current=await get('/api/coffer/donors/'+amina.id);await cmd('donor.erase',{donorId:amina.id,confirm:'ERASE'})
  assert.ok((await receive(clear,'synthetic-coffer-stop')).rejected);assert.ok(!(await get('/api/coffer/replies')).some(r=>r.donor_id===amina.id));await h.get('/api/coffer/donors/'+amina.id,{headers,status:404})
  await cmd('marketing.disconnect');assert.equal((await get('/api/coffer/provider-fields')).provider,null)
 },{entry:'tests/engagement-worker.ts',outbound:edge.outbound,bindings:{COFFER_REPLY_ADDRESS:edge.reply}})
}

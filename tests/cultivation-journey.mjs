import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,archive,restore} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function cultivationJourney(){
 await run(async h=>{
  const headers={'x-test-now':'2026-10-19T16:00:00Z'},cmd=(name,input,options={})=>h.command(name,input,{...options,headers}),get=(path,options={})=>h.get(path,{...options,headers})
  const owner=(await get('/auth/session')).operator, member=await h.person('riley@example.test')
  const ada=await donor(h,'Ada Rivera'),other=await donor(h,'Ada Legacy Record')
  const prospect=await cmd('prospect.save',{donorId:ada.id,label:'Reading room renewal',ownerId:owner.id,stage:'cultivate',askAmount:'5000',expectedCloseOn:'2026-12-01',nextStep:'Tour the reading room.'})
  const prospectId=prospect.id,path='/api/coffer/opportunities/'+prospectId
  const steps=[{offsetDays:0,title:'Tour'},{offsetDays:7,title:'Lunch with the board chair'},{offsetDays:14,title:'Proposal'},{offsetDays:21,title:'Ask'}]
  await cmd('cultivation.template',{name:'Denied',steps},{as:'',status:401})
  const template=await cmd('cultivation.template',{name:'Reading room cultivation',steps})
  await cmd('cultivation.apply',{prospectId,templateId:template.id,templateVersion:0,startOn:'2026-10-19',ownerId:owner.id},{status:400})
  await cmd('cultivation.apply',{prospectId,templateId:template.id,templateVersion:template.version,startOn:'2026-10-19',ownerId:member.id})
  let state=await get(path)
  assert.deepEqual(state.tasks.map(t=>[t.title,t.due_on,t.owner_id,t.status]),steps.map(s=>[s.title,new Date(Date.parse('2026-10-19T00:00Z')+s.offsetDays*86400000).toISOString().slice(0,10),member.id,'open']))
  for(const task of state.tasks.slice(0,2))await cmd('cultivation.complete',{prospectId,taskId:task.id,version:task.version,notes:'Discussed reading-room plans and agreed the next visit.'},{as:member.cookie})
  await cmd('cultivation.complete',{prospectId,taskId:state.tasks[0].id,version:1,notes:'Duplicate completion'},{status:409})
  await cmd('cultivation.template',{templateId:template.id,version:template.version,name:'Revised plan',steps:[{offsetDays:2,title:'New first step'}]})
  await cmd('cultivation.apply',{prospectId,templateId:template.id,templateVersion:template.version,startOn:'2026-10-19',ownerId:owner.id},{status:409})
  state=await get(path);assert.equal(state.tasks.length,4);assert.equal(state.tasks.filter(t=>t.status==='done').length,2)
  assert.equal(state.tasks[0].template_name,'Reading room cultivation')
  let proposal=await cmd('proposal.save',{prospectId,title:'Reading room proposal',body:'A proposal to renew the reading room for 120 local families.'})
  await cmd('proposal.sent',{prospectId,proposalId:proposal.id,version:proposal.version,sentOn:'2026-10-19',method:'Email',evidence:'Sent from the staff mailbox.'},{status:409})
  const content='Reading room renewal\nProposal for a $5,000 contribution.\n'
  await cmd('proposal.attach',{prospectId,proposalId:proposal.id,version:1,fileName:'reading-room.txt',mediaType:'text/plain',contentBase64:Buffer.from(content).toString('base64')})
  let document=await h.request('/api/coffer/proposals/'+proposal.id+'/download',{headers});assert.equal(document.status,200);assert.equal(await document.text(),content)
  await cmd('proposal.sent',{prospectId,proposalId:proposal.id,version:2,sentOn:'2026-10-19',method:'Email',evidence:'Forwarded the attached proposal from the staff mailbox after the meeting.'})
  await cmd('proposal.save',{prospectId,proposalId:proposal.id,version:3,title:'Changed sent proposal',body:'Must retain the sent document.'},{status:409})
  await cmd('proposal.response',{prospectId,proposalId:proposal.id,version:3,responseOn:'2026-10-18',response:'Too early'},{status:400})
  await cmd('proposal.response',{prospectId,proposalId:proposal.id,version:3,responseOn:'2026-10-19',response:'Donor will consider the proposal with the family.'})
  state=await get(path);assert.equal(state.proposals[0].sent_method,'Email');assert.equal(state.proposals[0].response,'Donor will consider the proposal with the family.')
  assert.equal(h.messages.length,1,'Only the staff invitation reached a mail edge; sending a proposal is recorded, not performed')
  await get(path,{as:'',status:401});await h.request('/api/coffer/proposals/'+proposal.id+'/download',{as:'',headers}).then(r=>assert.equal(r.status,401))
  const saved=await archive(h)
  await run(async fresh=>{await restore(fresh,saved);const copy=await fresh.get(path);assert.deepEqual(copy.tasks.map(t=>[t.title,t.due_on,t.status,t.notes]),state.tasks.map(t=>[t.title,t.due_on,t.status,t.notes]));assert.equal(copy.proposals[0].response,state.proposals[0].response);const file=await fresh.request('/api/coffer/proposals/'+proposal.id+'/download');assert.equal(await file.text(),content)})
  if(process.env.COFFER_CULTIVATION_BROWSER){
   const directory=process.env.COFFER_CULTIVATION_BROWSER;await mkdir(directory,{recursive:true})
   await withBrowserWorker(h,async(context,origin)=>{
    await context.setExtraHTTPHeaders({cookie:h.owner,...headers});const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/pipeline')
     await page.screenshot({path:`${directory}/MAJOR-003-pipeline-${width}.png`,fullPage:true})
     await page.getByRole('link',{name:'Action plan and proposals',exact:true}).click()
     assert.ok(await page.getByRole('heading',{name:'Dated plan tasks',exact:true}).isVisible())
     assert.equal(await page.getByText('Complete step',{exact:true}).count(),2)
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await page.screenshot({path:`${directory}/MAJOR-003-plan-${width}.png`,fullPage:true})
     const draft=page.locator('form').filter({has:page.getByRole('button',{name:'Create proposal draft',exact:true})})
     await draft.getByLabel('Proposal title',{exact:true}).fill(`Renewal follow-up ${width}`)
     await draft.getByLabel('Proposal draft',{exact:true}).fill('The revised reading-room proposal after the family meeting.')
     await draft.getByRole('button',{name:'Create proposal draft',exact:true}).click()
     let article=page.locator('article').filter({has:page.getByRole('heading',{name:`Renewal follow-up ${width} Draft`,exact:true})})
     await page.screenshot({path:`${directory}/MAJOR-003-draft-${width}.png`,fullPage:true})
     await article.locator('input[type=file]').setInputFiles({name:'follow-up.txt',mimeType:'text/plain',buffer:Buffer.from(content)})
     await article.getByRole('button',{name:'Attach document',exact:true}).click()
     article=page.locator('article').filter({has:page.getByRole('heading',{name:`Renewal follow-up ${width} Draft`,exact:true})})
     await article.getByLabel('Sending method',{exact:true}).fill('Hand-delivered')
     await article.getByLabel('Sending evidence',{exact:true}).fill('Delivered this document at the donor meeting.')
     await article.getByRole('button',{name:'Record sending',exact:true}).click()
     article=page.locator('article').filter({has:page.getByRole('heading',{name:`Renewal follow-up ${width} Sending recorded`,exact:true})})
     await article.getByLabel('Response',{exact:true}).fill('The donor requested a December follow-up.')
     await article.getByRole('button',{name:'Record response',exact:true}).click()
     assert.ok(await page.getByText('The donor requested a December follow-up.',{exact:false}).first().isVisible())
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await page.screenshot({path:`${directory}/MAJOR-003-response-${width}.png`,fullPage:true})
    }
   })
  }
  const comparison=await get(`/api/coffer/duplicates/compare?source=${ada.id}&target=${other.id}`)
  const merged=await cmd('donor.merge',{sourceDonorId:ada.id,donorId:other.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.equal((await get(path)).prospect.donor_id,other.id)
  await cmd('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'});assert.equal((await get(path)).prospect.donor_id,ada.id)
  await cmd('donor.erase',{donorId:ada.id,confirm:'ERASE'})
  await get(path,{status:404});const erased=await archive(h)
  assert.ok(!JSON.stringify(erased).includes('120 local families'))
  document=await h.request('/api/coffer/proposals/'+proposal.id+'/download',{headers});assert.equal(document.status,404)
 },{entry:'tests/advancing-clock-worker.ts'})
}

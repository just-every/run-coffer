import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore,installation} from './harness.mjs'

const now='2026-10-26T12:00:00.000Z',month='2026-09',at={headers:{'x-test-now':now}}
const pointer=(value,path)=>path.split('/').slice(1).reduce((row,key)=>row[key.replace(/~1/g,'/').replace(/~0/g,'~')],value)
const reportApi='/api/coffer/agent/reports'

async function grant(h,enabled=true){
 const state=await h.get('/api/coffer/agent/grants',at),g=state.find(row=>row.id==='development_reports')
 return h.api('/api/coffer/agent/grants',{id:g.id,version:g.version,enabled,scope:'all',dailyLimit:12},at)
}
async function fixture(h){
 await reviewed(h)
 const owner=(await h.get('/auth/session')).operator,ada=await donor(h,'Ada Board'),ben=await donor(h,'Ben Board')
 const gift=(d,amount,receivedOn,extra={})=>h.command('gift.record',{donorId:d.id,amount,receivedOn,method:'check',goods:'none',fund:'Library',...extra},at)
 await gift(ada,'100','2025-09-10');await gift(ada,'200','2026-09-10',{fund:'',allocations:[{fund:'Library',amount:'120'},{fund:'Meals',amount:'80'}]})
 const returned=await gift(ben,'50','2026-09-12')
 await h.command('gift.reverse',{giftId:returned.id,reason:'Returned gift',reversedOn:'2026-09-15'},at)
 await gift(ben,'15','2026-09-16');await gift(ben,'15','2026-09-16')
 await h.command('dashboard.goal',{year:2026,fiscalStart:'01-01',dimension:'month',key:'09',amount:'500',version:0},at)
 await h.command('prospect.save',{donorId:ada.id,ownerId:owner.id,label:'Reading room commitment',stage:'identify',askAmount:'1000',expectedAmount:'900',probability:50,fund:'Library',expectedCloseOn:'2026-12-15',nextStep:'Arrange a donor meeting'},at)
 await h.command('pledge.create',{donorId:ada.id,amount:'120',pledgedOn:'2026-09-01',fund:'Library',installments:[{dueOn:'2026-09-20',amount:'120'}]},at)
 return {ada,ben}
}
function doors(h){
 const action=(name,input,options={})=>h.api(reportApi+'/'+name,input,{...at,...options,headers:{...at.headers,...options.headers}})
 const state=()=>h.get(reportApi+'?month='+month,at)
 const row=async id=>(await state()).reports.find(r=>r.id===id)
 const saved=async()=>{
  const drafted=await action('draft',{month}),r=await row(drafted.id)
  await action('save',{id:r.id,version:r.version,subject:r.subject,introduction:'The board should prioritize stewardship.',raisedNote:'Received contributions support our work.',recipients:'director@example.test, board@example.test'})
  return row(r.id)
 }
 const approve=async(r,options={})=>action('approve',{id:r.id,version:r.version,contentHash:r.content_hash,reviewed:'yes',authorityNote:'Director explicitly reviewed the exact report and recipients.'},options)
 const send=(r,options={})=>action('send',{id:r.id,version:r.version,contentHash:r.content_hash,confirm:'SEND'},options)
 return {action,state,row,saved,approve,send}
}

/** The real HTTP and mail transport doors; the paid mail edge alone is faked. */
export async function developmentReportJourney(){
 await run(async h=>{
  const {ada,ben}=await fixture(h),d=doors(h),member=await h.person('board-entry@example.test'),admin=await h.person('board-director@example.test','admin')
  await h.get(reportApi,{as:'',status:401})
  await h.get(reportApi,{as:member.cookie,status:403})
  await h.get('/api/coffer/reports/development-sources?month='+month,{as:member.cookie,status:403})
  await d.action('draft',{month},{status:403})
  await grant(h)
  const preparation=(await d.state()).schedule,initialMessages=h.messages.length
  await d.action('schedule',{version:preparation.version,enabled:'yes',dayOfMonth:26,reviewed:'yes'})
  const tick=async instant=>{const response=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+Date.parse(instant),{headers:{'x-test-now':instant}});assert.equal(response.status,200,await response.text())}
  await tick('2026-10-25T12:00:00.000Z');assert.equal((await d.state()).reports.length,0)
  await tick(now);await tick(now)
  const monthly=(await d.state()).reports
  assert.equal(monthly.length,1,'Monthly ticks prepare a completed month exactly once')
  assert.equal(monthly[0].month,month);assert.equal(monthly[0].status,'draft')
  assert.equal(h.messages.length,initialMessages,'Monthly preparation never submits email')
  const key=await h.command('agent.create',{label:'Report preparation key'})
  await d.action('draft',{month},{as:'',headers:{authorization:'Bearer '+key.token},status:403})
  await d.action('draft',{month:'2026-99'},{status:400})
  await d.action('draft',{month:'2027-01'},{status:400})
  const before=h.messages.length,r=await d.saved()
  assert.equal(h.messages.length,before,'Drafting and editing never send email')
  assert.equal(r.sourceDocument.sections.length,6)
  for(const section of r.sourceDocument.sections)for(const metric of section.metrics){
   assert.ok(metric.value===null||(typeof metric.value==='number'&&Number.isFinite(metric.value)),section.title+': '+metric.label+' is a usable numeric fact')
   const source=await h.get(metric.source.api,at)
   assert.equal(pointer(source,metric.source.pointer),metric.value,section.title+': '+metric.label)
   const response=await h.request(metric.source.href,at);assert.equal(response.status,200,'Every linked source page exists')
  }
  const raised=r.sourceDocument.sections.find(s=>s.key==='raised'),pipeline=r.sourceDocument.sections.find(s=>s.key==='pipeline'),overdue=r.sourceDocument.sections.find(s=>s.key==='overdue')
  assert.equal(raised.metrics[0].value,23000,'Reversed gifts do not inflate received contributions')
  assert.equal(raised.metrics[1].value,50000)
  assert.equal(pipeline.metrics.find(m=>m.label==='Probability-weighted commitments').value,45000)
  assert.equal(overdue.metrics[0].value,1);assert.equal(overdue.metrics[1].value,12000)
  const sources=await h.get('/api/coffer/reports/development-sources?month='+month,at)
  assert.equal(sources.notable.filter(g=>g.donorName==='Ben Board').length,2,'Distinct same-day gifts keep their identities')
  assert.equal(sources.notable.find(g=>g.donorName==='Ada Board').amountCents,20000,'Fund allocations combine once per gift')
  assert.equal((await h.get('/api/coffer/agent/followups',at)).findings.length,0,'Report preparation does not run the reminder agent')
  await d.send(r,{status:409})
  await d.action('save',{id:r.id,version:r.version,subject:r.subject,introduction:'We raised $999.',recipients:'board@example.test'},{status:400})
  await d.action('approve',{id:r.id,version:r.version,contentHash:'changed',reviewed:'yes',authorityNote:'Reviewed'},{status:400})
  await d.approve(r,{as:member.cookie,status:403})
  await d.approve(r)
  const approved=await d.row(r.id)
  await d.action('save',{id:r.id,version:r.version,subject:r.subject,recipients:'board@example.test'},{status:409})
  await d.action('save',{id:r.id,version:approved.version,subject:r.subject,introduction:'The director added context.',recipients:'board@example.test'})
  const edited=await d.row(r.id)
  assert.equal(edited.status,'draft');assert.equal(edited.approved_by,null)
  assert.notEqual(edited.content_hash,approved.content_hash)
  await d.send(edited,{status:409});await d.approve(edited)
  let ready=await d.row(r.id)
  const envelope={id:ready.id,version:ready.version,contentHash:ready.content_hash,confirm:'SEND'}
  const sent=await Promise.all([h.request(reportApi+'/send',{method:'POST',body:envelope,...at}),h.request(reportApi+'/send',{method:'POST',body:envelope,...at})])
  assert.deepEqual(sent.map(r=>r.status).sort(),[200,409],'Exactly one concurrent sender succeeds and the other is refused')
  assert.equal(h.messages.filter(m=>m.subject===ready.subject).length,1)
  const mail=h.messages.find(m=>m.subject===ready.subject)
  assert.deepEqual(mail.to,['board@example.test']);assert.ok(mail.text.includes('The director added context.'));assert.ok(mail.html.includes('data-source-pointer='))
  assert.ok(mail.html.includes(h.origin+'/app/reports/dashboard'))
  await d.send(await d.row(r.id),{status:409})
  const custody=(await d.state()).approvals.filter(a=>a.report_id===r.id)
  assert.equal(custody.length,2);assert.ok(custody.some(a=>a.content_hash===ready.content_hash&&a.version===ready.version))
  const stale=await d.saved();await d.approve(stale)
  await h.command('gift.record',{donorId:ada.id,amount:'10',receivedOn:'2026-09-22',method:'check',goods:'none',fund:'Library'},at)
  await d.send(await d.row(stale.id),{status:409})
  const authority=await d.saved();await d.approve(authority,{as:admin.cookie})
  await h.api('/auth/operator/role',{operatorId:admin.id,role:'member'},at)
  await d.send(await d.row(authority.id),{status:409})
  const stopped=await d.saved();await d.approve(stopped)
  await grant(h,false);await d.send(await d.row(stopped.id),{status:409});await grant(h,true)
  const killed=await d.saved();await d.approve(killed)
  const control=(await h.get('/api/coffer/agent-grants',at)).control
  await h.command('agentGrant.kill',{version:control.version,enabled:false},at)
  await d.send(await d.row(killed.id),{status:409})
  await h.command('agentGrant.kill',{version:control.version+1,enabled:true},at)
  const heldByMerge=await d.saved();await d.approve(heldByMerge)
  const twin=await donor(h,'Ada Board Separate Record',{addressLine1:'24 Cedar Lane'})
  const comparison=await h.get('/api/coffer/duplicates/compare?source='+ada.id+'&target='+twin.id,at)
  const merge=await h.command('donor.merge',{sourceDonorId:ada.id,donorId:twin.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'},at)
  assert.ok((await d.row(heldByMerge.id)).custody_hold,'A merge holds retained report identity and approval')
  await d.send(await d.row(heldByMerge.id),{status:409})
  await h.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'},at)
  assert.ok((await d.row(heldByMerge.id)).custody_hold,'Undo never revives a former disclosure approval')
  await h.command('donor.erase',{donorId:ben.id,confirm:'ERASE'},at)
  const redacted=await d.state()
  assert.ok(redacted.reports.every(r=>r.custody_hold),'Erasure holds retained source-linked artifacts')
  assert.ok(!JSON.stringify(redacted).includes('Ben Board'),'Retained reports redact erased source names and director prose')
  if(process.env.COFFER_DEVELOPMENT_REPORT_BROWSER){
   const {developmentReportBrowser}=await import('./development-report-browser.mjs')
   await developmentReportBrowser(h,{month,now},process.env.COFFER_DEVELOPMENT_REPORT_BROWSER)
  }
  const savedArchive=await archive(h),fresh=await installation({entry:'tests/advancing-clock-worker.ts',bindings:{COFFER_TEST_NOW:now},triggerHandlers:true})
  try{
   await restore(fresh,savedArchive)
   const retained=await fresh.get(reportApi+'?month='+month,at)
   assert.equal(retained.reports.length,redacted.reports.length,'Retained reports survive an archive restore')
   assert.equal(retained.schedule.enabled,0,'Schedule authority stays stopped on the destination installation')
   assert.equal((await fresh.get('/api/coffer/agent/grants',at)).find(g=>g.id==='development_reports').enabled,0)
   assert.equal(fresh.messages.filter(m=>m.subject===ready.subject).length,0,'Restore never resubmits a retained report')
  }finally{await fresh.close()}
  const audit=await h.get('/api/coffer/audit?action=developmentReport.draft',at)
  assert.ok(audit.rows.some(a=>JSON.parse(a.detail).grantId==='automation:development_reports'))
 },{entry:'tests/advancing-clock-worker.ts',bindings:{COFFER_TEST_NOW:now},triggerHandlers:true})
 await uncertainReportJourney()
}

async function uncertainReportJourney(){
 let submissions=0
 await run(async h=>{
  await fixture(h);await grant(h)
  const d=doors(h),r=await d.saved();await d.approve(r)
  const ready=await d.row(r.id),result=await d.send(ready)
  assert.equal(result.status,'uncertain')
  const count=submissions
  await d.send(await d.row(r.id),{status:409})
  assert.equal(submissions,count,'Uncertain envelopes are never automatically retried')
  assert.ok((await d.state()).deliveries.every(row=>row.detail.includes('unconfirmed')))
 },{entry:'tests/advancing-clock-worker.ts',bindings:{COFFER_TEST_NOW:now,MAIL_PROVIDER:'sendgrid'},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.sendgrid.com');await request.json();submissions++
  return new Response('',{status:503})
 }})
}

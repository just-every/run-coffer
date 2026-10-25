import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'
import {reportSchedulesBrowser} from './report-schedules-browser.mjs'

export async function reportSchedulesJourney(){
 const messages=[];let outcome='accepted'
 await run(async h=>{
  const headers={'x-test-now':'2026-10-18T02:00:00.000Z'},options={headers}
  await reviewed(h)
  const d=await donor(h,'Riverbend Report Donor')
  await h.command('gift.record',{donorId:d.id,amount:'125.50',receivedOn:'2025-03-02',method:'check',goods:'none',fund:'Library'},options)
  const selections=[
   ['/app?year=2025','/api/coffer/reports/dashboard?year=2025'],
   ['/app/reports/dashboard?year=2025','/api/coffer/reports/dashboard?year=2025'],
   ['/app/reports/dashboard?year=2025&view=entries&dimension=fund&key=Library','/api/coffer/reports/dashboard/entries?year=2025&view=entries&dimension=fund&key=Library'],
   ['/app/retention?year=2025&basis=calendar&fund=Library','/api/coffer/retention?year=2025&basis=calendar&fund=Library'],
   ['/app/lapses?annual=1&year=2025','/api/coffer/reports/annual-lapses?year=2025'],
   ['/app/funds?from=2025-01-01&through=2025-12-31&fund=Library','/api/coffer/reports/funds?from=2025-01-01&through=2025-12-31&fund=Library'],
   ['/app/reports/states?year=2025&basis=calendar&fund=Library','/api/coffer/reports/states?year=2025&basis=calendar&fund=Library'],
   ['/app/gifts/attribution?from=2025-01-01&to=2025-12-31','/api/coffer/reports/attribution?from=2025-01-01&to=2025-12-31'],
   ['/app/reports/custom-fields?from=2025-01-01&through=2025-12-31','/api/coffer/reports/custom-fields?from=2025-01-01&through=2025-12-31'],
   ['/app/reports/honor-roll?from=2025-01-01&through=2025-12-31','/api/coffer/reports/honor-roll?from=2025-01-01&through=2025-12-31'],
   ['/app/giving/health?from=2025-01&through=2025-12','/api/coffer/reports/recurring?from=2025-01&through=2025-12'],
   ['/app/funds/restrictions?through=2025-12-31','/api/coffer/reports/restrictions?through=2025-12-31'],
   ['/app/reports/tax?year=2025&basis=calendar','/api/coffer/reports/tax?year=2025&basis=calendar'],
  ]
  const input={name:'Weekly director report',reportPath:selections[0][0],recipients:'director@example.test, board@example.test',cadence:'weekly',startsAt:'2026-10-25T02:00',reviewed:'yes'}
  await h.command('reportSchedule.save',{...input,reviewed:''},{...options,status:400})
  await h.command('reportSchedule.save',{...input,reportPath:'https://example.test/report'},{...options,status:400})
  await h.command('reportSchedule.save',{...input,reportPath:'/app/donors'},{...options,status:400})
  const invitedEmail='synthetic-coffer-1601@example.test'
  const invite=await h.request('/app/people/invite',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({email:invitedEmail,role:'member',displayName:'Report member'}).toString()});assert.equal(invite.status,303)
  const inviteMail=messages.find(m=>m.personalizations[0].to.some(p=>p.email===invitedEmail))
  const token=new URL(inviteMail.content.find(c=>c.type==='text/plain').value.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]).searchParams.get('token')
  const confirm=await h.request('/auth/confirm',{method:'POST',as:'',body:{token}});assert.equal(confirm.status,303)
  const member={cookie:confirm.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')}
  await h.command('reportSchedule.save',input,{...options,as:member.cookie,status:403})
  await h.get('/api/coffer/report-schedules',{as:member.cookie,status:403})
  await h.get('/api/coffer/report-schedules',{as:'',status:401})
  const agent=await h.command('agent.create',{label:'Report reader'})
  await h.command('reportSchedule.save',input,{...options,as:'',headers:{...headers,authorization:'Bearer '+agent.token},status:403})
  for(const [i,[path]]of selections.entries())await h.command('reportSchedule.save',{...input,name:'Selected report '+i,reportPath:path,recipients:'director@example.test'},options)
  const month=await h.command('reportSchedule.save',{...input,name:'Monthly board report',cadence:'monthly',startsAt:'2026-10-31T02:00'},options)
  const paused=await h.command('reportSchedule.save',{...input,name:'Paused report'},options)
  await h.command('reportSchedule.pause',{scheduleId:paused.id,version:1},options)
  await h.command('reportSchedule.pause',{scheduleId:paused.id,version:1},{...options,status:409})
  const state=await h.get('/api/coffer/report-schedules',options)
  for(const [path]of selections)assert.ok(state.schedules.some(s=>s.report_path===path))
  assert.equal(messages.filter(m=>m.attachments).length,0)
  if(process.env.COFFER_REPORT_SCHEDULE_BROWSER)await reportSchedulesBrowser(h,process.env.COFFER_REPORT_SCHEDULE_BROWSER,'saved')
  // A later ledger entry proves the due report is recomputed, rather than the saved preview.
  await h.command('gift.record',{donorId:d.id,amount:'24.50',receivedOn:'2025-04-02',method:'check',goods:'none',fund:'Library'},options)
  const tick=async at=>{const r=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+Date.parse(at),{headers:{'x-test-now':at}});assert.equal(r.status,200,await r.text())}
  await tick('2026-10-25T01:59:00Z');assert.equal(messages.filter(m=>m.attachments).length,0)
  await Promise.all([tick('2026-10-25T02:00:00Z'),tick('2026-10-25T02:00:00Z')])
  await tick('2026-10-25T02:00:00Z')
  const sent=messages.filter(m=>m.attachments)
  for(const [i,[path,api]]of selections.entries()){
   const mail=sent.find(m=>m.subject==='Selected report '+i);assert.ok(mail,path)
   assert.deepEqual(mail.personalizations[0].to.map(p=>p.email),['director@example.test'])
   assert.ok(mail.content[0].value.includes(h.origin+path))
   const attachment=JSON.parse(Buffer.from(mail.attachments[0].content,'base64').toString('utf8'))
   assert.equal(attachment.selection,path)
   assert.deepEqual(attachment.report,await h.get(api,{headers:{'x-test-now':'2026-10-25T02:00:00Z'}}))
  }
  assert.equal(JSON.parse(Buffer.from(sent.find(m=>m.subject==='Selected report 0').attachments[0].content,'base64').toString()).report.summary.currentCents,15000)
  assert.equal(sent.some(m=>m.subject==='Paused report'),false)
  const count=sent.length;await tick('2026-10-25T02:00:00Z');assert.equal(messages.filter(m=>m.attachments).length,count)
  const after=await h.get('/api/coffer/report-schedules',options);assert.ok(after.runs.every(r=>r.status==='submitted'));assert.ok(after.schedules.filter(s=>s.name.startsWith('Selected')).every(s=>s.next_at==='2026-11-01T02:00:00.000Z'))
  if(process.env.COFFER_REPORT_SCHEDULE_BROWSER)await reportSchedulesBrowser(h,process.env.COFFER_REPORT_SCHEDULE_BROWSER,'submitted')
  await tick('2026-10-31T02:00:00Z')
  assert.equal(messages.filter(m=>m.subject==='Monthly board report'&&m.attachments).length,2,'Separate envelopes protect recipient addresses')
  assert.equal((await h.get('/api/coffer/report-schedules')).schedules.find(s=>s.id===month.id).next_at,'2026-11-30T02:00:00.000Z')
  // Isolate subsequent outcomes from other genuine weekly occurrences.
  for(const s of (await h.get('/api/coffer/report-schedules')).schedules.filter(s=>s.enabled))await h.command('reportSchedule.pause',{scheduleId:s.id,version:s.version})
  for(const status of ['uncertain','rejected']){
   const schedule=await h.command('reportSchedule.save',{...input,name:status+' report'},options);outcome=status
   await tick('2026-10-25T02:00:00Z');const length=messages.length;await tick('2026-10-25T02:00:00Z');assert.equal(messages.length,length,'No repeat after a failed or unknown submission')
   const result=await h.get('/api/coffer/report-schedules');assert.ok(result.runs.filter(r=>r.schedule_id===schedule.id).every(r=>r.status===status));assert.equal(result.runs.filter(r=>r.schedule_id===schedule.id).length,2)
  }
  const audit=await h.get('/api/coffer/audit?action=reportSchedule.save');assert.ok(JSON.stringify(audit).includes('explicitDisclosureApproval'))
 },{entry:'tests/advancing-clock-worker.ts',triggerHandlers:true,bindings:{MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-coffer-1602'},outbound:async request=>{
  assert.equal(new URL(request.url).origin,'https://api.sendgrid.com');const body=await request.json();messages.push(body)
  if(!body.attachments)return new Response(null,{status:202,headers:{'x-message-id':'synthetic-coffer-1603'}})
  return new Response(null,{status:outcome==='accepted'?202:outcome==='rejected'?400:500,headers:outcome==='accepted'?{'x-message-id':'synthetic-coffer-1604'}:{}})
 }})
 // The same attachment contract crosses the core provider adapter too.
 await run(async h=>{
  await reviewed(h)
  const options={headers:{'x-test-now':'2026-10-18T02:00:00.000Z'}}
  await h.command('reportSchedule.save',{name:'Resend director report',reportPath:'/app/reports/dashboard?year=2025',recipients:'director@example.test',cadence:'weekly',startsAt:'2026-10-25T02:00',reviewed:'yes'},options)
  const tick=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+Date.parse('2026-10-25T02:00:00Z'));assert.equal(tick.status,200,await tick.text())
  const message=h.messages.find(m=>m.subject==='Resend director report');assert.ok(message)
  assert.equal(JSON.parse(Buffer.from(message.attachments[0].content,'base64').toString()).selection,'/app/reports/dashboard?year=2025')
  assert.equal((await h.get('/api/coffer/report-schedules')).runs[0].status,'submitted')
 },{entry:'tests/advancing-clock-worker.ts',triggerHandlers:true})

}

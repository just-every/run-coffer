import {taxReportsJourney} from './tax-reports-journey.mjs'
import {inKindJourney} from './in-kind-journey.mjs'
import {retentionJourney} from './retention-journey.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run,donor,archive,restore} from './harness.mjs'

const year=new Date().getUTCFullYear(), day=new Date().toISOString().slice(0,10)
const gift=(h,d,amount,receivedOn)=>h.command('gift.record',{donorId:d.id,amount,receivedOn,method:'check',goods:'none',fund:'Library'})

test('a lapsed donor becomes an owned call, reassignment and snooze preserve it, and completion logs on the donor',()=>run(async h=>{
 const tom=await donor(h,'Tom Okafor',{phone:'202-555-0149'})
 await gift(h,tom,'1200',`${year-1}-06-12`)
 const owner=(await h.get('/auth/session')).operator
 const colleague=await h.person('riley@example.test')
 const flagged=(await h.get('/api/coffer/lapses')).rows.find(d=>d.donorId===tom.id)
 assert.ok(flagged)
 assert.equal(flagged.amountCents,120000)
 const input={sourceKey:flagged.key,ownerId:owner.id,dueOn:day}
 await h.command('task.generate',input,{as:'',status:401})
 await h.command('task.generate',{...input,ownerId:'unknown'},{status:409})
 let task=await h.command('task.generate',input)
 const repeated=await h.command('task.generate',{...input,ownerId:colleague.id})
 assert.equal(repeated.id,task.id)
 assert.equal(repeated.owner_id,owner.id)
 task=await h.command('task.assign',{taskId:task.id,version:task.version,ownerId:colleague.id,dueOn:day})
 await h.command('task.assign',{taskId:task.id,version:1,ownerId:owner.id,dueOn:day},{status:409})
 const later=new Date(Date.now()+7*86400000).toISOString().slice(0,10)
 task=await h.command('task.snooze',{taskId:task.id,version:task.version,dueOn:later},{as:colleague.cookie})
 assert.equal(task.status,'snoozed')
 assert.equal((await h.get(`/api/coffer/tasks?owner=${colleague.id}`)).tasks[0].due_on,later)
 task=await h.command('task.complete',{taskId:task.id,version:task.version,outcome:'connected',notes:'Discussed the library renewal. Tom requested a proposal.',nextStep:'Send the reading-room proposal Friday.'},{as:colleague.cookie})
 assert.equal(task.status,'done')
 const prospect=await h.command('prospect.save',{donorId:tom.id,ownerId:colleague.id,stage:'cultivate',askAmount:'5000',expectedCloseOn:later,nextStep:'Discuss the library renewal.'})
 const pipeline=await h.get('/api/coffer/prospects')
 const opportunity=pipeline.find(p=>p.id===prospect.id)
 assert.equal(opportunity.ask_amount_cents,500000)
 assert.equal(opportunity.engagement.conversations.count,1)
 assert.ok(opportunity.engagement.conversations.points>0)
 const moved=await h.command('prospect.save',{id:prospect.id,version:prospect.version,donorId:tom.id,ownerId:owner.id,stage:'ask',askAmount:'6000',expectedCloseOn:later,nextStep:'Send final proposal.'})
 assert.equal(moved.version,prospect.version+1)
 const history=await h.get(`/api/coffer/donors/${tom.id}`)
 const call=history.depth.interactions.find(i=>i.id===task.interaction_id)
 assert.equal(call.kind,'call')
 assert.match(call.notes,/Tom requested a proposal/)
 assert.match(call.next_step,/reading-room/)
 await h.command('task.complete',{taskId:task.id,version:task.version,outcome:'no_answer',notes:'Again'},{status:409})
 const html=await (await h.request(`/app/donors/${tom.id}`)).text()
 assert.match(html,/Tom requested a proposal/)
 // A different source, an overdue pledge, feeds the same list.
 await h.command('pledge.create',{donorId:tom.id,amount:'90',pledgedOn:`${year-1}-01-01`,fund:'Library',installments:[{dueOn:`${year-1}-03-01`,amount:'90'}]})
 const source=(await h.get('/api/coffer/tasks')).sources.find(s=>s.kind==='pledge')
 assert.equal(source.amountCents,9000)
 const pledgeTask=await h.command('task.generate',{sourceKey:source.key,ownerId:colleague.id,dueOn:day})
 assert.notEqual(pledgeTask.id,task.id)
}))

test('REPORT-001: three-year cohorts, fiscal boundaries, movements and scoped ledger drilldowns',retentionJourney)

test('STEW-002: quarterly completion and overdue monthly Cron create exactly one next task, including month ends and custody',()=>run(async h=>{
 const owner=(await h.get('/auth/session')).operator
 const board=await donor(h,'Avery Board Member'),other=await donor(h,'Avery Separate Record')
 const input={title:'Quarterly board-member check-in',ownerId:owner.id,dueOn:'2030-01-31',intervalMonths:3,donorId:board.id}
 await h.command('task.repeatCreate',input,{as:'',status:401})
 await h.command('task.repeatCreate',{...input,ownerId:'not-an-operator'},{status:409})
 await h.command('task.repeatCreate',{...input,intervalMonths:2},{status:400})
 const quarter=await h.command('task.repeatCreate',input)
 await h.get('/api/coffer/recurring-tasks',{as:'',status:401})
 assert.equal((await h.get('/api/coffer/recurring-tasks?owner=another-person')).length,0)
 await h.command('task.repeatComplete',{taskId:quarter.id,version:quarter.version,notes:''},{status:400})
 await h.command('task.repeatComplete',{taskId:quarter.id,version:quarter.version,notes:'Reviewed the library plan and next board meeting.'})
 await h.command('task.repeatComplete',{taskId:quarter.id,version:quarter.version,notes:'Duplicate click'},{status:409})
 let tasks=await h.get('/api/coffer/recurring-tasks'),next=tasks.find(t=>t.previous_id===quarter.id)
 assert.equal(next.due_on,'2030-04-30')
 assert.equal(next.owner_id,owner.id)
 assert.equal(next.donor_id,board.id)
 assert.equal(tasks.find(t=>t.id===quarter.id).status,'done')
 const monthly=await h.command('task.repeatCreate',{title:'Monthly donor-retention review',ownerId:owner.id,dueOn:'2030-01-31',intervalMonths:1})
 const tick=()=>h.mf.dispatchFetch(h.origin+'/cdn-cgi/local/scheduled?time='+Date.parse('2030-02-01T12:00:00Z')+'&format=json')
 for(const response of await Promise.all([tick(),tick()]))assert.equal(response.status,200,await response.text())
 tasks=await h.get('/api/coffer/recurring-tasks')
 const february=tasks.find(t=>t.previous_id===monthly.id)
 assert.equal(february.due_on,'2030-02-28')
 assert.equal(february.donor_id,null)
 assert.equal(tasks.filter(t=>t.previous_id===monthly.id).length,1)
 await h.command('task.repeatComplete',{taskId:monthly.id,version:monthly.version,notes:'Completed the overdue retention review.'})
 await h.command('task.repeatComplete',{taskId:february.id,version:february.version,notes:'Reviewed the February donor cohorts.'})
 tasks=await h.get('/api/coffer/recurring-tasks')
 assert.equal(tasks.find(t=>t.previous_id===february.id).due_on,'2030-03-31')
 assert.equal(tasks.filter(t=>t.previous_id===monthly.id).length,1)
 const page=await h.request('/app/calls?owner=&status=all');assert.equal(page.status,200)
 assert.ok((await page.text()).includes(next.due_on.slice(0,4)))
 const saved=await archive(h)
 await run(async fresh=>{await restore(fresh,saved);const copied=await fresh.get('/api/coffer/recurring-tasks');assert.deepEqual(copied.map(t=>[t.id,t.due_on,t.status,t.notes]),tasks.map(t=>[t.id,t.due_on,t.status,t.notes]))})
 const comparison=await h.get(`/api/coffer/duplicates/compare?source=${board.id}&target=${other.id}`)
 const merged=await h.command('donor.merge',{sourceDonorId:board.id,donorId:other.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
 assert.ok((await h.get('/api/coffer/recurring-tasks')).filter(t=>t.series_id===quarter.series_id).every(t=>t.donor_id===other.id))
 await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
 assert.ok((await h.get('/api/coffer/recurring-tasks')).filter(t=>t.series_id===quarter.series_id).every(t=>t.donor_id===board.id))
 if(process.env.COFFER_STEW_BROWSER){const {recurringBrowser}=await import('./recurring-browser.mjs');await recurringBrowser(h,board.id,process.env.COFFER_STEW_BROWSER)}
 await h.command('donor.erase',{donorId:board.id,confirm:'ERASE'})
 const remaining=await h.get('/api/coffer/recurring-tasks')
 assert.ok(!remaining.some(t=>t.series_id===quarter.series_id))
 assert.ok(remaining.some(t=>t.series_id===monthly.series_id))
 const erasedBackup=JSON.stringify(await archive(h));assert.ok(!erasedBackup.includes('Reviewed the library plan and next board meeting.'))
},{triggerHandlers:true}))

test('MAJOR-007: planned intentions, legacy enrollment and estate distributions preserve ledger, merge and erasure',async()=>{
 const {plannedGivingJourney}=await import('./planned-giving-journey.mjs')
 await plannedGivingJourney()
})

test('MAJOR-002: portfolios count manager moves, current pipeline, signed giving and untouched prospects with custody',async()=>{
 const {portfoliosJourney}=await import('./portfolios-journey.mjs')
 await portfoliosJourney()
})

test('MAJOR-003: dated cultivation tasks and attached proposals retain sending, responses and custody',async()=>{
 const {cultivationJourney}=await import('./cultivation-journey.mjs')
 await cultivationJourney()
})


test('MAJOR-004: every constituent has transparent configurable engagement and independent retention risk',async()=>{
 const {engagementJourney}=await import('./engagement-journey.mjs')
 await engagementJourney()
})


test('MAJOR-006: foundation requests become restricted pledges with payment schedules, documents and reporting tasks',async()=>{
 const {grantsJourney}=await import('./grants-journey.mjs')
 await grantsJourney()
})

test('REPORT-002: independent annual LYBUNT/SYBUNT lists feed approved appeals and call tasks with ledger custody',async()=>{
 const {annualLapsesJourney}=await import('./annual-lapses-journey.mjs')
 await annualLapsesJourney()
})


test('MAJOR-001: configurable opportunity boards and lists link wins once and reconcile the probability-weighted forecast',async()=>{
 const {opportunityJourney}=await import('./opportunity-journey.mjs')
 await opportunityJourney()
})

test('GIFT-001/GIFT-009: property acknowledgments omit internal values, disposal reminders and custody stay separate from cash',inKindJourney)

test('REPORT-007: Schedule B rules and five-year donor giving reconcile to monetary and noncash records',taxReportsJourney)


test('DONOR-010: recorded and imported volunteer roles, yearly hours, never-given segments, scoring and custody',async()=>{
 const {volunteeringJourney}=await import('./volunteering-journey.mjs');await volunteeringJourney()
})


test('MAJOR-005: restricted WealthEngine screening retains estimates with provenance and donor custody',async()=>{
 const {researchJourney}=await import('./research-journey.mjs');await researchJourney()
})

test('REPORT-003: fiscal dashboard, explicit goals, exact ledger drilldowns, cohorts, recurring sources and pipeline',async()=>{const {dashboardJourney}=await import('./dashboard-journey.mjs');await dashboardJourney()})

test('STEW-001: daily task reminders, manager escalation and owner fallback preserve timeline completion',async()=>{const {taskRemindersJourney}=await import('./task-reminders-journey.mjs');await taskRemindersJourney()})

test('DEV-010: overdue pledge installments, grant reports and employer matches receive approved reminders, escalation and recorded resolution',async()=>{const {developmentFollowupsJourney}=await import('./development-followups-journey.mjs');await developmentFollowupsJourney()})

test('DEV-005: weekly manager call priorities preserve capacity, non-ask restrictions, overflow and observed giving and retention',async()=>{const {callPrioritiesJourney}=await import('./call-priorities-journey.mjs');await callPrioritiesJourney()})

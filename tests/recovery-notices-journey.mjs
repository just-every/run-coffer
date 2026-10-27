import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {run,donor,archive,restore} from './harness.mjs'
import {recoveryForm,recoveryNoticeEdge} from './recovery-notices-edge.mjs'

export async function recoveryNoticesJourney(frequency='monthly') {
 const edge=recoveryNoticeEdge(frequency),base=Date.parse('2026-10-27T12:00:00.000Z'),at=days=>new Date(base+days*86400000).toISOString()
 await run(async h=>{
  const timeZone=(await h.get('/api/coffer/settings')).timezone,localDay=instant=>new Intl.DateTimeFormat('en-CA',{timeZone}).format(new Date(instant)),day=localDay(base)
  const endpoint='/api/coffer/agent/recovery/notice-action',state=()=>h.get('/api/coffer/agent/recovery/notices'),action=(p,options={})=>h.api(endpoint,p,options),runAt=(days,options={})=>h.api('/api/coffer/agent/recovery/run',{}, {...options,headers:{...options.headers,'x-test-now':at(days)}})
  const ownerAt=async days=>{
   const headers={'x-test-now':at(days)},requested=await h.request('/auth/magic-link',{method:'POST',as:'',body:{email:'owner@example.test'},headers});assert.equal(requested.status,202)
   const link=h.messages.at(-1).text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]
   const renewed=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:new URL(link).searchParams.get('token')},headers});assert.equal(renewed.status,303)
   return {as:renewed.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),headers}
  }
  const portalMessages=()=>h.messages.filter(m=>m.text?.includes('/giving/portal/confirm?token='))
  const consent=(p,status,days=0)=>h.command('consent.record',{donorIds:[p.donor.id],channel:'email',status,method:'paper form',evidence:'Recorded recovery-contact channel permission',capturedOn:day},{headers:{'x-test-now':at(days)}})
  const otherAdmin=await h.person('notices.admin@example.test','admin'),member=await h.person('notices.member@example.test')
  await h.api('/api/coffer/giving/campaigns',{name:'Monthly notice reading',slug:'notice-reading',description:'Monthly readers',fund:'Reading',goal:'10000'})
  for(const p of edge.plans) {
   p.donor=await donor(h,p.name,{email:p.email})
   await consent(p,'granted')
   await h.command('interaction.record',{donorId:p.donor.id,kind:'call',occurredOn:day,notes:'Donor confirmed private portal recovery contact is welcome.',who:'Recovery care team'})
   const checkout=await h.request('/give/notice-reading/checkout',recoveryForm({name:p.name,email:p.email,amount:'25',frequency,'cf-turnstile-response':'synthetic-coffer-security-token',requestId:randomUUID()}))
   assert.equal(checkout.status,303,await checkout.text())
   if(p.id!=='ben')await action({action:'permission',donorId:p.donor.id,version:0,enabled:true,channel:'email',intervalDays:2,maxNotices:2,sourceOn:day,evidence:'Donor explicitly authorized up to two recovery notices at least two days apart.'})
  }
  const [ana,ben,mira]=edge.plans
  const majorGift=await h.command('gift.record',{donorId:mira.donor.id,amount:'1500',receivedOn:day,method:'check',goods:'none'})
  await action({action:'policy',version:1,enabled:false,majorAmount:'1000'})
  assert.equal((await state()).policy.approved_by,null,'Turning notices off does not implicitly designate the person saving the policy')
  if(process.env.COFFER_RECOVERY_NOTICES_BROWSER&&frequency==='monthly'){const {recoveryNoticesBrowser}=await import('./recovery-notices-browser.mjs');await recoveryNoticesBrowser(h,{directory:process.env.COFFER_RECOVERY_NOTICES_BROWSER,phase:'no-implicit-lead'})}
  await action({action:'policy',version:2,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000'},{as:member.cookie,status:403})
  for(const p of edge.plans)await edge.fail(h,p,'evt_notice_'+p.id,at(0))
  assert.equal(portalMessages().length,0,'Explicitly off does not fall back to existing automatic invitations')
  await action({action:'policy',version:2,enabled:true,standingApproval:true,majorAmount:'1000'},{status:400})
  await action({action:'policy',version:2,enabled:true,developmentLead:true,majorAmount:'1000'},{status:400})
  await action({action:'policy',version:2,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000'})
  const designated=(await h.get('/auth/session')).operator,policyApproval=(await h.get('/api/coffer/audit?action=recovery.standingApproval')).rows.find(row=>JSON.parse(row.detail).enabled)
  assert.equal((await state()).policy.approved_by,designated.id,'Designation is always the authenticated current approver, never a nominated account')
  assert.equal(policyApproval.actor_id,designated.id);assert.equal(policyApproval.actor_role,'owner');assert.ok(policyApproval.at)

  await runAt(0)
  assert.equal(portalMessages().length,1,'Standing approval alone never grants donor recovery-contact permission')
  assert.match((await state()).steps.find(n=>n.donor_id===ben.donor.id).reason,/permission/i)
  await action({action:'permission',donorId:ben.donor.id,version:0,enabled:true,channel:'email',intervalDays:2,maxNotices:2,sourceOn:day,evidence:'Donor explicitly authorized two notices at least two days apart.'})
  await Promise.all([runAt(0),runAt(0)])
  assert.equal(portalMessages().length,2,'Only two standard donors receive automatic notices')
  let data=await state(),major=data.steps.find(n=>n.donor_id===mira.donor.id)
  assert.equal(major.state,'awaiting_approval')
  assert.ok(data.steps.every(n=>JSON.parse(n.evidence).some(s=>s.kind==='subscription')&&JSON.parse(n.evidence).some(s=>s.kind==='interaction')&&JSON.parse(n.evidence).some(s=>s.kind==='channel-consent')))
  assert.ok(JSON.parse(major.evidence).some(s=>s.kind==='gift'),'Major-donor history is cited')
  const cited=JSON.parse(major.evidence)
  assert.deepEqual(cited.find(s=>s.kind==='subscription').facts,{amountCents:2500,status:'past_due'})
  assert.equal(cited.find(s=>s.kind==='giving-history').facts.lifetimeCents,150000)
  assert.equal(cited.find(s=>s.kind==='gift'&&s.id===majorGift.id).facts.amount_cents,150000)
  assert.equal(cited.find(s=>s.kind==='channel-consent').facts.status,'granted')
  assert.equal(cited.find(s=>s.kind==='recovery-permission').facts.channel,'email')
  assert.equal(cited.find(s=>s.kind==='interaction').facts.notes,'Donor confirmed private portal recovery contact is welcome.')
  await h.command('gift.reverse',{giftId:majorGift.id,reason:'Synthetic original contribution was returned.'})
  const owner=(await h.get('/auth/session')).operator
  await h.command('prospect.save',{donorId:mira.donor.id,ownerId:owner.id,stage:'cultivate',askAmount:'1000',expectedCloseOn:localDay(at(3)),nextStep:'Human review of the existing relationship.'})
  await runAt(0)
  major=(await state()).steps.find(n=>n.donor_id===mira.donor.id)
  assert.equal(major.state,'awaiting_approval','A recorded prospect requires review independently of net giving history')
  assert.equal(JSON.parse(major.evidence).find(s=>s.kind==='prospect').facts.stage,'cultivate')
  if(process.env.COFFER_RECOVERY_NOTICES_BROWSER&&frequency==='monthly'){const {recoveryNoticesBrowser}=await import('./recovery-notices-browser.mjs');await recoveryNoticesBrowser(h,{directory:process.env.COFFER_RECOVERY_NOTICES_BROWSER})}
  await action({action:'approve',stepId:major.id,version:major.version+1},{status:409})
  await action({action:'approve',stepId:major.id,version:major.version},{as:otherAdmin.cookie,status:403})
  await action({action:'approve',stepId:major.id,version:major.version})
  await action({action:'approve',stepId:major.id,version:major.version},{status:409})
  await runAt(0);assert.equal(portalMessages().length,3)
  await runAt(0);await runAt(1);assert.equal((await state()).steps.length,3,'No next step is prepared before the full two-day interval')
  await consent(ben,'withdrawn')
  await runAt(3)
  data=await state()
  const anaSteps=data.steps.filter(n=>n.donor_id===ana.donor.id).sort((a,b)=>a.ordinal-b.ordinal)
  assert.equal(anaSteps.length,2);assert.ok(anaSteps.every(n=>n.state==='sent'))
  assert.equal(portalMessages().length,4,'Frequency elapsed only for an eligible standard donor')
  assert.equal(data.steps.find(n=>n.donor_id===ben.donor.id&&n.ordinal===2).state,'held')
  assert.equal(data.steps.find(n=>n.donor_id===mira.donor.id&&n.ordinal===2).state,'awaiting_approval','Each major-donor notice needs a fresh named-lead approval')
  const atMaximum=portalMessages().length
  await runAt(5)
  assert.equal((await state()).steps.filter(n=>n.donor_id===ana.donor.id).length,2,'Maximum notices wins after another full interval')
  assert.equal(portalMessages().length,atMaximum)
  ana.paid=true;ana.status='active';ana.attempt=2;ana.paidAt=Date.parse(at(6))
  await edge.fail(h,ana,'evt_notice_ana_paid',at(6),'invoice.paid')
  data=await state()
  assert.ok(data.steps.find(n=>n.id===anaSteps[1].id).recovered_at)
  assert.equal(data.steps.find(n=>n.id===anaSteps[0].id).recovered_at,null,'Only the latest actual sent step receives recovery attribution')
  assert.equal((await h.get('/api/coffer/agent')).recovery.rows.find(r=>r.subscription_id==='sub_notice_ana').state,'recovered')
  await action({action:'permission',donorId:ana.donor.id,version:1,enabled:true,channel:'email',intervalDays:2,maxNotices:3,sourceOn:day,evidence:'Donor permits up to three notices for an unresolved failure.'})
  await runAt(6)
  assert.equal((await state()).steps.filter(n=>n.donor_id===ana.donor.id).length,2,'Verified recovery stops follow-ups even with additional permitted capacity')
  // A hosted handoff is not the actual payment update and cannot stop notices.
  const clock={'x-test-now':at(3)},login=await h.request('/giving/portal/request',recoveryForm({email:mira.email},'',clock));assert.equal(login.status,200)
  const link=new URL(portalMessages().at(-1).text.match(/https?:\/\/[^\s<>]+\/giving\/portal\/confirm\?token=[^\s<>]+/)[0])
  const confirmed=await h.request('/giving/portal/confirm',recoveryForm({token:link.searchParams.get('token')},'',clock));assert.equal(confirmed.status,303)
  const cookie=confirmed.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
  const start=await h.request('/giving/portal/card',recoveryForm({subscription:'sub_notice_mira'},cookie,clock));assert.equal(start.status,303,await start.text())
  await runAt(3)
  assert.equal((await state()).steps.find(n=>n.donor_id===mira.donor.id&&n.ordinal===2).state,'awaiting_approval')
  mira.method='synthetic-coffer-3004'
  const returned=new URL(mira.hostedReturn),completed=await h.request(returned.pathname+returned.search,{as:cookie,headers:clock});assert.equal(completed.status,303,await completed.text())
  assert.equal((await h.get('/api/coffer/audit?action=portal.paymentMethodUpdated')).rows[0].subject_id,'sub_notice_mira')
  await runAt(6)
  assert.equal((await state()).steps.find(n=>n.donor_id===mira.donor.id&&n.ordinal===2).state,'stopped')
  // Mail and phone remain prepared on the actual permitted channel, with a
  // human completing the contact; no email permission is silently substituted.
  await consent(ben,'granted',4)
  await h.command('consent.record',{donorIds:[ben.donor.id],channel:'phone',status:'granted',method:'paper form',evidence:'Recorded phone recovery permission',capturedOn:day})
  await action({action:'permission',donorId:ben.donor.id,version:1,enabled:true,channel:'phone',intervalDays:2,maxNotices:2,sourceOn:day,evidence:'Donor now wants recovery follow-up by phone.'})
  const beforePhone=portalMessages().length;await runAt(6)
  let phone=(await state()).steps.find(n=>n.donor_id===ben.donor.id&&n.ordinal===2)
  assert.equal(phone.channel,'phone');assert.equal(phone.state,'prepared');assert.equal(portalMessages().length,beforePhone)
  await action({action:'complete',stepId:phone.id,version:phone.version,evidence:'Spoke to donor; they will use their private portal.'},{headers:{'x-test-now':at(6)}})
  // A changed amount and an expiring current method both use the same guarded
  // approval path. Neither changes the amount or stores card details.
  ana.paid=false;ana.status='past_due';ana.invoice='in_notice_ana_revised';ana.amount=3500;ana.method='synthetic-coffer-3005';ana.expiryOffset=1;ana.expiryBase=Date.parse(localDay(at(6)))
  await edge.fail(h,ana,'evt_notice_amount_changed',at(6));await runAt(6)
  data=await state()
  assert.equal(data.steps.find(n=>n.invoice_id===ana.invoice).state,'awaiting_approval')
  let expiry=data.steps.find(n=>n.donor_id===ana.donor.id&&n.kind==='expiry');assert.equal(expiry.state,'awaiting_approval')
  await action({action:'approve',stepId:expiry.id,version:expiry.version},{headers:{'x-test-now':at(6)}})
  await runAt(6)
  assert.equal((await state()).steps.find(n=>n.id===expiry.id).state,'sent')
  const beforeReplace=portalMessages().length;ana.method='synthetic-coffer-3006';await runAt(6);assert.equal(portalMessages().length,beforeReplace)
  assert.ok(!JSON.stringify(await state()).includes('synthetic-coffer-3005'),'Notice sources never retain old provider payment-method references')
  // Merging never transfers contact permission or lets a moved plan bypass
  // the interval observed on its original donor. Undo needs reconfirmation.
  const target=await donor(h,'Recovery merge target',{email:'target.notices@example.test'}),mergeClock={headers:{'x-test-now':at(6.5)}}
  await h.command('consent.record',{donorIds:[target.id],channel:'email',status:'granted',method:'paper form',evidence:'Independent target recovery channel permission',capturedOn:day})
  await action({action:'permission',donorId:target.id,version:0,enabled:true,channel:'email',intervalDays:2,maxNotices:3,sourceOn:day,evidence:'Target independently authorized scheduled recovery contact.'})
  const merge=async()=>{const compared=await h.get('/api/coffer/duplicates/compare?source='+ana.donor.id+'&target='+target.id,mergeClock);return h.command('donor.merge',{sourceDonorId:ana.donor.id,donorId:target.id,sourceVersion:compared.source.version,version:compared.target.version,reason:'duplicate_record'},mergeClock)}
  const merged=await merge()
  let sourcePermission=(await state()).permissions.find(p=>p.donor_id===ana.donor.id)
  assert.equal(sourcePermission.enabled,0)
  assert.ok((await state()).steps.filter(n=>n.donor_id===ana.donor.id&&!n.claim_id).every(n=>n.state==='closed'))
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'},mergeClock)
  sourcePermission=(await state()).permissions.find(p=>p.donor_id===ana.donor.id)
  assert.equal(sourcePermission.enabled,0,'Undo never silently regrants automated contact')
  await action({action:'permission',donorId:ana.donor.id,version:sourcePermission.version,enabled:true,channel:'email',intervalDays:2,maxNotices:3,sourceOn:day,evidence:'Original donor permission explicitly reconfirmed after undo.'})
  assert.equal((await state()).permissions.find(p=>p.donor_id===ana.donor.id).enabled,1)
  await merge()
  ana.invoice='in_notice_merged_target'
  const beforeMergeFollowup=portalMessages().length
  await edge.fail(h,ana,'evt_notice_after_merge',at(6.5))
  assert.equal(portalMessages().length,beforeMergeFollowup)
  assert.ok(!(await state()).steps.some(n=>n.invoice_id===ana.invoice),'The moved plan retains donor-wide frequency custody before preparing another notice')
  // A standard current-card warning uses the configured automatic path too.
  // The prior phone contact still enforces the same donor-wide interval.
  await action({action:'permission',donorId:ben.donor.id,version:2,enabled:true,channel:'email',intervalDays:2,maxNotices:3,sourceOn:day,evidence:'Donor explicitly reconfirmed recovery email as the permitted channel.'})
  ben.method='synthetic-coffer-3007';ben.expiryOffset=1;ben.expiryBase=Date.parse(localDay(at(8)));ben.status='active';ben.paid=true;ben.paidAt=Date.parse(at(6.5))
  await edge.fail(h,ben,'evt_notice_ben_paid',at(6.5),'invoice.paid')
  const beforeStandardExpiry=portalMessages().length
  await runAt(6.5);assert.equal(portalMessages().length,beforeStandardExpiry)
  const owner8=await ownerAt(8)
  await runAt(8,owner8)
  data=await state()
  const standardExpiry=data.steps.find(n=>n.donor_id===ben.donor.id&&n.kind==='expiry')
  assert.equal(standardExpiry.state,'sent');assert.equal(standardExpiry.approved_by,null,'A standard expiry uses explicit standing approval')
  assert.equal(portalMessages().length,beforeStandardExpiry+1)
  await runAt(8,owner8)
  assert.equal((await state()).steps.find(n=>n.id===standardExpiry.id).recovered_at,null,'A notice sent after an already-paid invoice never receives false recovery attribution')
  const assertActualBody=step=>{const donor=edge.plans.find(p=>p.donor.id===step.donor_id),message=portalMessages().filter(m=>m.to.includes(donor.email)&&m.subject===step.subject).at(-1),link=message.text.match(/https?:\/\/[^\s<>]+\/giving\/portal\/confirm\?token=[^\s<>]+/)[0];assert.equal(message.text,step.body.replaceAll('{{private_giving_portal_link}}',link))}
  assertActualBody(standardExpiry);assertActualBody(data.steps.find(n=>n.id===major.id))
  const approved=(await h.get('/api/coffer/audit?record='+major.id+'&action=recovery.noticeApproved')).rows[0]
  assert.equal(JSON.parse(approved.detail).contentHash,data.steps.find(n=>n.id===major.id).content_hash,'The actual sent body retains the exact approved hash')
  await action({action:'close',stepId:phone.id,reason:'Donor requested no further recovery follow-up.'},owner8)
  ben.invoice='in_notice_ben_closed';ben.paid=false;ben.status='past_due'
  await edge.fail(h,ben,'evt_notice_after_close',at(8.5));await runAt(8.5,owner8)
  assert.ok(!(await state()).steps.some(n=>n.invoice_id===ben.invoice),'Manual closure stops a new failure despite available notice capacity')
  mira.invoice='in_notice_mira_lapsed';mira.status='unpaid'
  await edge.fail(h,mira,'evt_notice_lapsed',at(8.5))
  assert.equal((await h.get('/api/coffer/agent')).recovery.rows.find(r=>r.invoice_id===mira.invoice).state,'lapsed')
  assert.ok(!(await state()).steps.some(n=>n.invoice_id===mira.invoice),'Lapse stops new notices independently of a past portal update')
  await action({action:'policy',version:3,enabled:false,majorAmount:'1000'},owner8)
  const beforeOff=portalMessages().length,owner10=await ownerAt(10)
  await runAt(10,owner10);assert.equal(portalMessages().length,beforeOff,'Explicitly off stops all additional notice steps')
  const adminLogin=await h.request('/auth/magic-link',{method:'POST',as:'',body:{email:'notices.admin@example.test'},headers:{'x-test-now':at(10)}})
  assert.equal(adminLogin.status,202)
  const adminLink=new URL(h.messages.at(-1).text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0])
  const adminSession=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:adminLink.searchParams.get('token')},headers:{'x-test-now':at(10)}})
  assert.equal(adminSession.status,303)
  const adminOptions={as:adminSession.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),headers:{'x-test-now':at(10)}}
  await action({action:'policy',version:4,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000',approvedBy:designated.id},adminOptions)
  assert.equal((await state()).policy.approved_by,otherAdmin.id,'A current admin can explicitly designate only themselves')
  await h.api('/auth/operator/role',{operatorId:otherAdmin.id,role:'member'},owner10)
  const beforeRoleChange=portalMessages().length
  mira.invoice='in_notice_authority_changed';mira.status='past_due';mira.paid=false
  await edge.fail(h,mira,'evt_notice_authority_changed',at(10.5));await runAt(10.5,owner10)
  const invalidated=(await state()).steps.find(n=>n.invoice_id===mira.invoice)
  assert.ok(invalidated);assert.equal(invalidated.state,'held');assert.match(invalidated.reason,/standing authority changed/)
  assert.equal(portalMessages().length,beforeRoleChange,'A designation cannot survive its holder losing the required role')
  await action({action:'policy',version:5,enabled:false,majorAmount:'1000'},owner10)
  assert.equal((await state()).policy.approved_by,otherAdmin.id,'A different person turning notices off cannot silently take the lead designation')
  assert.equal(JSON.parse((await h.get('/api/coffer/audit?action=recovery.standingApproval')).rows[0].detail).developmentLead,false)
  assert.ok(!edge.calls.some(([method,path])=>method==='POST'&&/invoices\/.*\/pay|payment_intents|\/subscriptions\//.test(path)),'Recovery never makes an extra charge or changes the plan')
 },{...edge.options,bindings:{...edge.options.bindings,COFFER_TEST_NOW:at(0)}})
}

/** Unknown provider submissions retain individual custody across plan moves. */
export async function uncertainRecoveryJourney(){
 const edge=recoveryNoticeEdge(),base='2026-10-27T12:00:00.000Z',later='2026-10-30T12:00:00.000Z',submissions=[]
 edge.plans.push({...edge.plans[0],id:'other',name:'Independent Recovery',email:'independent.notices@example.test',invoice:'synthetic-coffer-4400'})
 const options={...edge.options,bindings:{...edge.options.bindings,COFFER_TEST_NOW:base,MAIL_PROVIDER:'resend',MAIL_API_KEY:'synthetic-coffer-4307'},outbound:async request=>{
  if(new URL(request.url).hostname==='api.sendgrid.com'){
   submissions.push(await request.json())
   return new Response(null,{status:submissions.length<=2?503:202})
  }
  return edge.options.outbound(request)
 }}
 await run(async h=>{
  const state=()=>h.get('/api/coffer/agent/recovery/notices'),action=(p,o={})=>h.api('/api/coffer/agent/recovery/notice-action',p,o),runLater=()=>h.api('/api/coffer/agent/recovery/run',{}, {headers:{'x-test-now':later}})
  const member=await h.person('uncertainty.member@example.test'),admin=await h.person('uncertainty.admin@example.test','admin'),owner=(await h.get('/auth/session')).operator
  await h.replaceBindings({MAIL_PROVIDER:'sendgrid'})
  await h.api('/api/coffer/giving/campaigns',{name:'Synthetic recovery sequence',slug:'synthetic-recovery',description:'Recurring recovery',fund:'Reading',goal:'10000'})
  await action({action:'policy',version:1,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000'})
  const permission=async(p,enabled=true)=>{const current=(await state()).permissions.find(v=>v.donor_id===p.donor.id);return action({action:'permission',donorId:p.donor.id,version:current?.version??0,enabled,channel:'email',intervalDays:1,maxNotices:3,sourceOn:'2026-10-27',evidence:'synthetic-coffer-4302'})}
  const consent=(p,status)=>h.command('consent.record',{donorIds:[p.donor.id],channel:'email',status,method:'paper form',evidence:'synthetic-coffer-4301',capturedOn:'2026-10-27'})
  for(const p of edge.plans){
   p.donor=await donor(h,p.name,{email:p.email})
   await consent(p,'granted');await permission(p)
   const checkout=await h.request('/give/synthetic-recovery/checkout',recoveryForm({name:p.name,email:p.email,amount:'25',frequency:'monthly','cf-turnstile-response':'synthetic-coffer-security-token',requestId:randomUUID()}))
   assert.equal(checkout.status,303)
  }
  const [ana,ben,mira,other]=edge.plans
  await edge.fail(h,ana,'synthetic-coffer-4303',base)
  await edge.fail(h,ben,'synthetic-coffer-4304',base)
  const originals=(await state()).steps.filter(n=>n.state==='uncertain').sort((a,b)=>a.subscription_id.localeCompare(b.subscription_id))
  assert.deepEqual(originals.map(n=>n.subscription_id),['sub_notice_ana','sub_notice_ben'])
  assert.equal(submissions.length,2)
  ana.invoice='synthetic-coffer-4305'
  await edge.fail(h,ana,'synthetic-coffer-4306',later)
  assert.equal((await state()).steps.find(n=>n.invoice_id===ana.invoice).state,'held','A new invoice cannot clear uncertainty')
  const merge=async p=>{const compared=await h.get('/api/coffer/duplicates/compare?source='+p.donor.id+'&target='+mira.donor.id);await h.command('donor.merge',{sourceDonorId:p.donor.id,donorId:mira.donor.id,sourceVersion:compared.source.version,version:compared.target.version,reason:'duplicate_record'})}
  await merge(ana);await merge(ben)
  await edge.fail(h,mira,'synthetic-coffer-4308',later);await runLater()
  let held=(await state()).steps.find(n=>n.invoice_id===mira.invoice)
  assert.equal(held.state,'held');assert.match(held.reason,/earlier recovery submission is uncertain/)
  assert.equal(submissions.length,2,'Moved plans retain both unresolved submissions across the elapsed interval')
  await edge.fail(h,other,'synthetic-coffer-4309',later)
  assert.equal((await state()).steps.find(n=>n.invoice_id===other.invoice).state,'sent','An unrelated eligible donor proceeds')
  assert.equal(submissions.length,3)
  const close={action:'close',stepId:originals[0].id,version:originals[0].version,finding:'Still unknown after checking the provider submission log.',reason:'Stop this affected plan contact after investigation.'}
  await action(close,{as:member.cookie,status:403})
  const denied=await h.request('/app/agent/recovery/notice-action',recoveryForm(close,member.cookie));assert.equal(denied.status,403)
  await action({...close,finding:''},{status:400})
  if(process.env.COFFER_RECOVERY_NOTICES_BROWSER){
   const {investigatedRecoveryBrowser}=await import('./recovery-notices-browser.mjs')
   await investigatedRecoveryBrowser(h,{directory:process.env.COFFER_RECOVERY_NOTICES_BROWSER,stepId:close.stepId,finding:close.finding,reason:close.reason})
  }else await action(close)
  await action(close,{status:409})
  await runLater()
  let data=await state()
  assert.equal(submissions.length,3,'Investigation sends nothing and never resubmits an unknown message')
  assert.equal(data.steps.find(n=>n.invoice_id===mira.invoice).state,'held','Closing one submission cannot clear a second uncertainty')
  const investigation=data.investigations.find(v=>v.step_id===close.stepId)
  assert.deepEqual(investigation,{step_id:close.stepId,subscription_id:'sub_notice_ana',finding:close.finding,reason:close.reason,closed_by:owner.id,closed_at:base})
  const audit=(await h.get('/api/coffer/audit?record='+close.stepId+'&action=recovery.closed')).rows[0]
  assert.equal(audit.actor_id,owner.id);assert.equal(audit.actor_role,'owner');assert.equal(audit.at,base)
  assert.deepEqual(JSON.parse(audit.detail),{stepId:close.stepId,subscriptionId:'sub_notice_ana',scope:'plan',finding:close.finding,reason:close.reason,actorId:owner.id,at:base})
  const immutable=n=>({state:n.state,claim_id:n.claim_id,claimed_at:n.claimed_at,ordinal:n.ordinal,body:n.body,content_hash:n.content_hash,sent_at:n.sent_at})
  const assertOriginals=async target=>{const current=await target.get('/api/coffer/agent/recovery/notices');assert.deepEqual(originals.map(n=>immutable(current.steps.find(v=>v.id===n.id))),originals.map(immutable));assert.deepEqual(current.investigations,[investigation])}
  await h.replaceBindings({});await assertOriginals(h);await runLater()
  assert.equal((await state()).steps.find(n=>n.invoice_id===mira.invoice).state,'held','Restart keeps the second unresolved hold')
  const portable=await archive(h),beforeRestore=submissions.length
  await run(async fresh=>{
   await restore(fresh,portable);await assertOriginals(fresh)
   const restored=await fresh.get('/api/coffer/agent/recovery/notices')
   assert.equal(restored.policy.enabled,0);assert.equal(restored.policy.approved_at,null,'Archive recovery never revives standing outbound approval')
   await fresh.api('/api/coffer/agent/recovery/run',{}, {headers:{'x-test-now':later}})
   assert.equal(submissions.length,beforeRestore,'Restored records cannot fall back to legacy automatic mail')
   await assertOriginals(fresh)
   assert.equal((await fresh.get('/api/coffer/agent/recovery/notices')).steps.find(n=>n.invoice_id===mira.invoice).state,'held')
  },{...options,givingProtection:false})
  const adminClose={action:'close',stepId:originals[1].id,version:originals[1].version,finding:'Provider could not establish delivery; still unknown.',reason:'Admin deliberately ends this plan contact.'}
  if(process.env.COFFER_RECOVERY_NOTICES_BROWSER){const {investigatedRecoveryBrowser}=await import('./recovery-notices-browser.mjs');await investigatedRecoveryBrowser(h,{directory:process.env.COFFER_RECOVERY_NOTICES_BROWSER,...adminClose,actorCookie:admin.cookie,capture:false})}else await action(adminClose,{as:admin.cookie})
  const adminInvestigation=(await state()).investigations.find(v=>v.step_id===originals[1].id)
  assert.deepEqual(adminInvestigation,{step_id:originals[1].id,subscription_id:'sub_notice_ben',finding:adminClose.finding,reason:adminClose.reason,closed_by:admin.id,closed_at:base})
  const adminAudit=(await h.get('/api/coffer/audit?record='+originals[1].id+'&action=recovery.closed')).rows[0]
  assert.equal(adminAudit.actor_role,'admin');assert.equal(JSON.parse(adminAudit.detail).subscriptionId,'sub_notice_ben')
  await permission(mira,false);await runLater()
  held=(await state()).steps.find(n=>n.invoice_id===mira.invoice)
  assert.equal(held.state,'held');assert.match(held.reason,/donor recovery permission/);assert.equal(submissions.length,3)
  await permission(mira);await consent(mira,'withdrawn');await runLater()
  held=(await state()).steps.find(n=>n.invoice_id===mira.invoice)
  assert.equal(held.state,'held');assert.match(held.reason,/selected channel/);assert.equal(submissions.length,3)
  await consent(mira,'granted')
  await action({action:'policy',version:2,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000'},{as:admin.cookie})
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  const reactivated=await h.api('/auth/operator/status',{operatorId:admin.id,status:'active'});assert.equal(reactivated.role,'admin');assert.ok(reactivated.version>admin.session.operator.version)
  await runLater()
  held=(await state()).steps.find(n=>n.invoice_id===mira.invoice)
  assert.equal(held.state,'held');assert.match(held.reason,/standing authority changed/);assert.equal(submissions.length,3,'Same-role account version change invalidates authority on resumed dispatch')
  await action({action:'policy',version:3,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000'})
  await runLater()
  data=await state()
  assert.equal(data.steps.find(n=>n.invoice_id===mira.invoice).state,'sent','Another independently eligible same-donor plan resumes after each investigation and the interval')
  assert.equal(submissions.length,4)
  assert.deepEqual(originals.map(n=>immutable(data.steps.find(v=>v.id===n.id))),originals.map(immutable),'Both original outcomes and contact counts remain unchanged')
  ana.invoice='synthetic-coffer-4310';ben.invoice='synthetic-coffer-4311'
  await edge.fail(h,ana,'synthetic-coffer-4312',later);await edge.fail(h,ben,'synthetic-coffer-4313',later);await runLater()
  assert.equal(submissions.length,4,'Deliberately closed plans stay stopped even after a new failure and policy or permission changes')
  assert.ok(!(await state()).steps.some(n=>[ana.invoice,ben.invoice].includes(n.invoice_id)))
  if(process.env.COFFER_RECOVERY_NOTICES_BROWSER){const {investigatedRecoveryBrowser}=await import('./recovery-notices-browser.mjs');await investigatedRecoveryBrowser(h,{directory:process.env.COFFER_RECOVERY_NOTICES_BROWSER,phase:'resumed',stepId:close.stepId})}
  assert.ok(!edge.calls.some(([method,path])=>method==='POST'&&/invoices.*pay|payment_intents|subscriptions/.test(path)),'No Coffer payment retry, plan mutation or catch-up charge')
 },options)
}

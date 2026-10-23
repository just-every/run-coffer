import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {run,donor} from './harness.mjs'
import {recoveryForm,recoveryNoticeEdge} from './recovery-notices-edge.mjs'

export async function recoveryNoticesJourney() {
 const edge=recoveryNoticeEdge(),base=Date.now(),at=days=>new Date(base+days*86400000).toISOString(),day=new Date(base).toISOString().slice(0,10)
 await run(async h=>{
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
   const checkout=await h.request('/give/notice-reading/checkout',recoveryForm({name:p.name,email:p.email,amount:'25',frequency:'monthly',requestId:randomUUID()}))
   assert.equal(checkout.status,303,await checkout.text())
   if(p.id!=='ben')await action({action:'permission',donorId:p.donor.id,version:0,enabled:true,channel:'email',intervalDays:2,maxNotices:2,sourceOn:day,evidence:'Donor explicitly authorized up to two recovery notices at least two days apart.'})
  }
  const [ana,ben,mira]=edge.plans
  const majorGift=await h.command('gift.record',{donorId:mira.donor.id,amount:'1500',receivedOn:day,method:'check',goods:'none'})
  await action({action:'policy',version:1,enabled:false,majorAmount:'1000'})
  await action({action:'policy',version:2,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000'},{as:member.cookie,status:403})
  for(const p of edge.plans)await edge.fail(h,p,'evt_notice_'+p.id)
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
  await h.command('gift.reverse',{giftId:majorGift.id,reason:'Synthetic original contribution was returned.'})
  const owner=(await h.get('/auth/session')).operator
  await h.command('prospect.save',{donorId:mira.donor.id,ownerId:owner.id,stage:'cultivate',askAmount:'1000',expectedCloseOn:at(3).slice(0,10),nextStep:'Human review of the existing relationship.'})
  await runAt(0)
  major=(await state()).steps.find(n=>n.donor_id===mira.donor.id)
  assert.equal(major.state,'awaiting_approval','A recorded prospect requires review independently of net giving history')
  assert.ok(JSON.parse(major.evidence).some(s=>s.kind==='prospect'))
  if(process.env.COFFER_RECOVERY_NOTICES_BROWSER){const {recoveryNoticesBrowser}=await import('./recovery-notices-browser.mjs');await recoveryNoticesBrowser(h,{directory:process.env.COFFER_RECOVERY_NOTICES_BROWSER})}
  await action({action:'approve',stepId:major.id,version:major.version},{as:otherAdmin.cookie,status:403})
  await action({action:'approve',stepId:major.id,version:major.version})
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
  ana.paid=false;ana.status='past_due';ana.invoice='in_notice_ana_revised';ana.amount=3500;ana.method='synthetic-coffer-3005';ana.expiryOffset=1;ana.expiryBase=Date.parse(at(6))
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
  ben.method='synthetic-coffer-3007';ben.expiryOffset=1;ben.expiryBase=Date.parse(at(6));ben.status='active';ben.paid=true;ben.paidAt=Date.parse(at(6.5))
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
  assert.ok(!edge.calls.some(([method,path])=>method==='POST'&&/invoices\/.*\/pay|payment_intents|\/subscriptions\//.test(path)),'Recovery never makes an extra charge or changes the plan')
 },edge.options)
}

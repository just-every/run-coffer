import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {run,donor,archive,restore} from './harness.mjs'
import {recoveryForm,recoveryNoticeEdge} from './recovery-notices-edge.mjs'

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
  let dispatchAt=later
  const state=()=>h.get('/api/coffer/agent/recovery/notices'),action=(p,o={})=>h.api('/api/coffer/agent/recovery/notice-action',p,o),runLater=()=>h.api('/api/coffer/agent/recovery/run',{}, {headers:{'x-test-now':dispatchAt}})
  const member=await h.person('uncertainty.member@example.test'),admin=await h.person('uncertainty.admin@example.test','admin'),owner=(await h.get('/auth/session')).operator
  await h.replaceBindings({MAIL_PROVIDER:'sendgrid'})
  await h.api('/api/coffer/giving/campaigns',{name:'Synthetic recovery sequence',slug:'synthetic-recovery',description:'Recurring recovery',fund:'Reading',goal:'10000'})
  await action({action:'policy',version:1,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000'})
  const permission=async(p,enabled=true,intervalDays=1,maxNotices=p.id==='other'?1:3,channel='email')=>{const current=(await state()).permissions.find(v=>v.donor_id===p.donor.id);return action({action:'permission',donorId:p.donor.id,version:current?.version??0,enabled,channel,intervalDays,maxNotices,sourceOn:'2026-10-27',evidence:'synthetic-coffer-4302'})}
  const consent=(p,status)=>h.command('consent.record',{donorIds:[p.donor.id],channel:'email',status,method:'paper form',evidence:'synthetic-coffer-4301',capturedOn:'2026-10-27'})
  for(const p of edge.plans){
   p.donor=await donor(h,p.name,{email:p.email})
   await consent(p,'granted');await permission(p)
   const checkout=await h.request('/give/synthetic-recovery/checkout',recoveryForm({name:p.name,email:p.email,amount:'25',frequency:'monthly','cf-turnstile-response':'synthetic-coffer-security-token',requestId:randomUUID()}))
   assert.equal(checkout.status,303,await checkout.text())
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
  await permission(mira)
  await action({action:'policy',version:(await state()).policy.version,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000'})
  await runLater()
  assert.equal((await state()).steps.find(n=>n.invoice_id===mira.invoice).state,'held','Permission and policy changes cannot clear uncertainty')
  assert.equal(submissions.length,3)
  for(const channel of ['phone','mail']){
   await h.command('consent.record',{donorIds:[mira.donor.id],channel,status:'granted',method:'paper form',evidence:'synthetic-coffer-4410',capturedOn:'2026-10-27'})
   await permission(mira,true,1,3,channel);await runLater()
   const manual=(await state()).steps.find(n=>n.invoice_id===mira.invoice)
   assert.equal(manual.state,'held');assert.equal(manual.channel,channel);assert.match(manual.reason,/earlier recovery submission is uncertain/)
   await action({action:'complete',stepId:manual.id,version:manual.version,evidence:'synthetic-coffer-4411'},{status:409})
   assert.equal(submissions.length,3,'Changing channel cannot bypass unresolved recovery contact')
  }
  await permission(mira)
  const close={action:'close',stepId:originals[0].id,version:originals[0].version,finding:'Still unknown after checking the provider submission log.',reason:'Stop this affected plan contact after investigation.'}
  await action(close,{as:member.cookie,status:403})
  const denied=await h.request('/app/agent/recovery/notice-action',recoveryForm(close,member.cookie));assert.equal(denied.status,403,await denied.text())
  await action({...close,finding:''},{status:400})
  await action({...close,version:close.version+10},{status:409})
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
  const assertOriginals=async(target,investigations=[investigation])=>{const current=await target.get('/api/coffer/agent/recovery/notices');assert.deepEqual(originals.map(n=>immutable(current.steps.find(v=>v.id===n.id))),originals.map(immutable));assert.deepEqual(current.investigations.toSorted((a,b)=>a.subscription_id.localeCompare(b.subscription_id)),investigations.toSorted((a,b)=>a.subscription_id.localeCompare(b.subscription_id)))}
  await h.replaceBindings({});await assertOriginals(h);await runLater()
  assert.equal((await state()).steps.find(n=>n.invoice_id===mira.invoice).state,'held','Restart keeps the second unresolved hold')
  async function archiveProof(portable,investigations,expectedState,phase){
   const beforeRestore=submissions.length,restoredAt=phase==='closed'?'2026-11-01T12:00:00.000Z':later
   await run(async fresh=>{
    await restore(fresh,portable);await fresh.replaceBindings({MAIL_PROVIDER:'sendgrid'});await assertOriginals(fresh,investigations)
    const restored=await fresh.get('/api/coffer/agent/recovery/notices')
    assert.equal(restored.policy.enabled,0);assert.equal(restored.policy.approved_by,null);assert.equal(restored.policy.approved_at,null,'Archive recovery never revives standing outbound approval')
    const priorInvoice=ana.invoice
    ana.invoice='synthetic-coffer-restored-'+phase
    await edge.fail(fresh,ana,'synthetic-coffer-restored-event-'+phase,restoredAt)
    ana.invoice=priorInvoice
    await fresh.api('/api/coffer/agent/recovery/run',{}, {headers:{'x-test-now':restoredAt}})
    assert.equal(submissions.length,beforeRestore,'Restored records cannot fall back to legacy automatic mail, including a new invoice')
    await assertOriginals(fresh,investigations)
    assert.equal((await fresh.get('/api/coffer/agent/recovery/notices')).steps.find(n=>n.invoice_id===mira.invoice).state,expectedState)
    if(process.env.COFFER_RECOVERY_NOTICES_BROWSER){const {investigatedRecoveryBrowser}=await import('./recovery-notices-browser.mjs');await investigatedRecoveryBrowser(fresh,{directory:process.env.COFFER_RECOVERY_NOTICES_BROWSER,phase:'archive-'+phase,stepId:close.stepId,at:restoredAt,expectedState,expectedInvestigations:investigations.length,planStepId:restored.steps.find(n=>n.invoice_id===mira.invoice).id})}
   },{...options,givingProtection:false})
  }
  const partialArchive=await archive(h)
  await permission(mira,true,4)
  const adminClose={action:'close',stepId:originals[1].id,version:originals[1].version,finding:'Provider could not establish delivery; still unknown.',reason:'Admin deliberately ends this plan contact.'}
  if(process.env.COFFER_RECOVERY_NOTICES_BROWSER){const {investigatedRecoveryBrowser}=await import('./recovery-notices-browser.mjs');await investigatedRecoveryBrowser(h,{directory:process.env.COFFER_RECOVERY_NOTICES_BROWSER,...adminClose,actorCookie:admin.cookie,phase:'admin-investigation'})}else await action(adminClose,{as:admin.cookie})
  const adminInvestigation=(await state()).investigations.find(v=>v.step_id===originals[1].id)
  assert.deepEqual(adminInvestigation,{step_id:originals[1].id,subscription_id:'sub_notice_ben',finding:adminClose.finding,reason:adminClose.reason,closed_by:admin.id,closed_at:base})
  const adminAudit=(await h.get('/api/coffer/audit?record='+originals[1].id+'&action=recovery.closed')).rows[0]
  assert.equal(adminAudit.actor_role,'admin');assert.equal(JSON.parse(adminAudit.detail).subscriptionId,'sub_notice_ben')
  await runLater()
  assert.equal(submissions.length,3,'Closing uncertainty does not waive the full elapsed interval')
  assert.match((await state()).steps.find(n=>n.invoice_id===mira.invoice).reason,/minimum notice interval/)
  dispatchAt='2026-11-01T12:00:00.000Z'
  await permission(mira,false,4);await runLater()
  held=(await state()).steps.find(n=>n.invoice_id===mira.invoice)
  assert.equal(held.state,'held');assert.match(held.reason,/donor recovery permission/);assert.equal(submissions.length,3)
  await permission(mira,true,4);await consent(mira,'withdrawn');await runLater()
  held=(await state()).steps.find(n=>n.invoice_id===mira.invoice)
  assert.equal(held.state,'held');assert.match(held.reason,/selected channel/);assert.equal(submissions.length,3)
  await consent(mira,'granted')
  await action({action:'policy',version:(await state()).policy.version,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000'},{as:admin.cookie})
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  const reactivated=await h.api('/auth/operator/status',{operatorId:admin.id,status:'active'});assert.equal(reactivated.role,'admin');assert.ok(reactivated.version>admin.session.operator.version)
  await action(adminClose,{as:admin.cookie,status:401})
  await runLater()
  held=(await state()).steps.find(n=>n.invoice_id===mira.invoice)
  assert.equal(held.state,'held');assert.match(held.reason,/standing authority changed/);assert.equal(submissions.length,3,'Same-role account version change invalidates authority on resumed dispatch')
  await action({action:'policy',version:(await state()).policy.version,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000'})
  await runLater()
  data=await state()
  assert.equal(data.steps.find(n=>n.invoice_id===mira.invoice).state,'sent','Another independently eligible same-donor plan resumes after each investigation and the interval')
  assert.equal(submissions.length,4)
  assert.deepEqual(originals.map(n=>immutable(data.steps.find(v=>v.id===n.id))),originals.map(immutable),'Both original outcomes and contact counts remain unchanged')
  await h.replaceBindings({});await assertOriginals(h,[investigation,adminInvestigation]);await runLater()
  assert.equal(submissions.length,4,'Restart preserves investigated closures without resubmitting contact')
  if(process.env.COFFER_RECOVERY_NOTICES_BROWSER){const {investigatedRecoveryBrowser}=await import('./recovery-notices-browser.mjs');await investigatedRecoveryBrowser(h,{directory:process.env.COFFER_RECOVERY_NOTICES_BROWSER,phase:'resumed',stepId:close.stepId,at:dispatchAt,planStepId:data.steps.find(n=>n.invoice_id===mira.invoice).id})}
  await h.command('consent.record',{donorIds:[other.donor.id],channel:'mail',status:'granted',method:'paper form',evidence:'synthetic-coffer-4412',capturedOn:'2026-10-27'})
  await permission(other,true,1,1,'mail')
  other.invoice='synthetic-coffer-manual-mail'
  await edge.fail(h,other,'synthetic-coffer-manual-mail-event',dispatchAt)
  const mail=(await state()).steps.find(n=>n.invoice_id===other.invoice)
  assert.equal(mail.state,'prepared');assert.equal(mail.channel,'mail');assert.equal(submissions.length,4,'A permitted postal notice stays prepared for a person')
  await action({action:'complete',stepId:mail.id,version:mail.version,evidence:'Posted the approved recovery letter.'},{headers:{'x-test-now':dispatchAt}})
  assert.equal((await state()).steps.find(n=>n.id===mail.id).state,'completed');assert.equal(submissions.length,4)
  const completeArchive=await archive(h)
  await permission(mira,true,1,1)
  dispatchAt='2026-11-02T12:00:00.000Z'
  ana.invoice='synthetic-coffer-4310';ben.invoice='synthetic-coffer-4311'
  await edge.fail(h,ana,'synthetic-coffer-4312',dispatchAt);await edge.fail(h,ben,'synthetic-coffer-4313',dispatchAt);await runLater()
  assert.equal(submissions.length,4,'Deliberately closed plans stay stopped after a new failure, policy or permission changes and the full elapsed interval')
  assert.ok(!(await state()).steps.some(n=>[ana.invoice,ben.invoice].includes(n.invoice_id)))
  await archiveProof(partialArchive,[investigation],'held','unresolved')
  await archiveProof(completeArchive,[investigation,adminInvestigation],'sent','closed')
  assert.ok(!edge.calls.some(([method,path])=>method==='POST'&&/invoices.*pay|payment_intents|subscriptions/.test(path)),'No Coffer payment retry, plan mutation or catch-up charge')
 },options)
}

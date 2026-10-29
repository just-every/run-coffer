import assert from 'node:assert/strict'
import {run,reviewed,archive,restore} from './harness.mjs'
import {reconciliationBrowser} from './move-in-reconciliation-browser.mjs'
const endpoint='/api/coffer/move-in'
const post=(h,action,input,options)=>h.api(endpoint+'/'+action,input,options)
const id=n=>'synthetic-coffer-'+n
const apply=async(h,p,extra={})=>{
 let job=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no',acknowledgeFrom:'2025-01-01',...extra})
 while(job.state==='applying')job=await post(h,'continue',{id:p.id})
 assert.equal(job.state,'completed');return job
}
const row=(rows,scope,key)=>{const result=rows.find(r=>r.scope===scope&&r.key===key);assert.ok(result,scope+' '+key);return result}
const controls=[
 ['gift acknowledgment','acknowledged',2,'900'],['gift acknowledgment','not acknowledged',2,'550'],['gift acknowledgment','do not acknowledge',1,'250'],
 ['soft-credit acknowledgment','acknowledged',1,'100'],['soft-credit acknowledgment','not acknowledged',1,'50'],['soft-credit acknowledgment','do not acknowledge',1,'70'],
 ['goods','all',5,'60'],['goods','provided',1,'60'],['goods','none',3,'0'],['goods','unknown',1,'0'],
 ['tribute','',3,'1000'],['tribute','memory:river reed',2,'750'],['tribute','honor:river reed',1,'250'],
 ['tribute source group','Memorial source',2,'750'],['tribute source group','Honor source',1,'250'],
]
function tables(source,{mismatch=false,extra=false}={}){
 const [donor,gift,type,honoree,kind,group,restriction]=({lgl:['LGL Constituent ID','LGL Gift ID','Gift','Tribute Hon./Mem. Name','Tribute Dedication','Tribute Name','Communication Tags'],bloomerang:['Account Number','Transaction Number','Donation','Tribute','Tribute Type','Tribute Group','Communication Restrictions'],'re-nxt':['Constituent ID','Gift ID','Cash','Tribute Honoree','Tribute Type','Tribute Group','Solicit Codes']})[source]
 return [
  ['constituents',[[donor,'Name',restriction], [id(9101),'First Import Donor','Do Not Solicit'],[id(9102),'Second Import Donor','Do Not Mail'],[id(9103),'Credit Import Donor','']]],
  ['gifts',[[gift,donor,'Gift Type','Gift Date','Amount','Payment Method','Non-Deductible Amount','Acknowledgment Status','Acknowledgment Date','Acknowledgment Method','Acknowledgment Interaction ID','Acknowledgment Reference',honoree,kind,group,'Tribute Recipient Name','Tribute Recipient Address'],
   [id(9111),id(9101),type,'2026-09-01','500','Check','0','acknowledged','2026-09-02','email',id(9131),'','River Reed','memory','Memorial source','Family Reed','1 Reading Road'],
   [id(9112),id(9102),type,'2026-09-03','250','Check','60','not acknowledged','','','','','River Reed','memory','Memorial source','',''],
   [id(9113),id(9101),type,'2026-09-04','250','Check','0','do not acknowledge','','','','','River Reed','honor','Honor source','',''],
   [id(9114),id(9101),type,'2020-09-01','300','Check','','not acknowledged','','','','','','','','',''],
   [id(9115),id(9102),type,'2026-09-05','400','Check','0','acknowledged','','','','Source receipt 42','','','','',''],
   ...(extra?[[id(9116),id(9101),type,'2026-09-06','25','Check','0','not acknowledged','','','','','','','','','']]:[])]],
  ['soft-credits',[['Soft Credit ID',donor,'Original Gift ID','Amount','Acknowledgment Status','Acknowledgment Date','Acknowledgment Method','Acknowledgment Interaction ID'],
   [id(9121),id(9102),id(9111),'100','acknowledged','2026-09-02','phone call',id(9132)],
   [id(9122),id(9103),id(9112),'50','not acknowledged','','',''],[id(9123),id(9103),id(9113),'70','do not acknowledge','','','']]],
  ['interactions',[['Interaction ID',donor,'Interaction Date','Interaction Type','Note'],[id(9131),id(9101),'2026-09-02','email','Imported gift thank-you'],[id(9132),id(9102),'2026-09-02','call','Independent source credit thank-you']]],
  ['controls',[['Control Scope','Control Key','Control Count','Control Amount'],...controls.map(([scope,key,count,amount])=>[scope,key,mismatch&&scope.includes('acknowledgment')?Number(count)+1:count,mismatch&&scope==='tribute source group'?'-1':mismatch&&['goods','tribute'].includes(scope)?String(Number(amount)+1):amount])]],
 ]
}
function assertControls(rows){
 for(const [scope,key,count,amount] of controls){
  const r=row(rows,'source report '+scope,key)
  assert.deepEqual([r.sourceCount,r.cofferCount,r.sourceCents,r.cofferCents,r.matches],[count,count,Number(amount)*100,Number(amount)*100,true],scope+' '+key)
 }
}
/** Source controls are independent literals, not totals computed from normalized import output. */
export async function reconciliationJourney(files){
 for(const source of ['lgl','bloomerang','re-nxt'])for(const format of ['csv','xlsx'])await run(async h=>{
  console.log('Reconciliation journey: '+source+' '+format)
  await reviewed(h)
  const input=async opts=>({source,files:await files(tables(source,opts),format),solicitCodes:{'Do Not Solicit':{type:'stop'},...(source==='re-nxt'?{'Do Not Mail':{type:'channels',channels:['mail']}}:{})}})
  const bad=await post(h,'preview',await input({mismatch:true}))
  assert.equal(bad.canApply,true,JSON.stringify(bad.diagnostics));assert.equal(bad.needsAcceptance,true)
  assert.equal(row(bad.reconciliation,'source report tribute source group','Memorial source').sourceCents,-100,'Signed source controls remain source facts even when they disagree')
  assert.ok(bad.controlTotals.every(c=>!c.matches),'Each deliberately wrong independent control must remain different')
  assert.ok(bad.reconciliation.filter(r=>r.scope.startsWith('source report ')).every(r=>!r.matches))
  await post(h,'apply',{id:bad.id,fingerprint:bad.fingerprint},{status:409})
  assert.equal((await h.get('/api/coffer/donors')).total,0)
  const uploaded=await input()
  const p=await post(h,'preview',uploaded)
  assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));assert.equal(p.needsAcceptance,false,JSON.stringify(p.unmapped));assertControls(p.reconciliation)
  assert.deepEqual(p.acknowledgmentPreview.byYear,{'2020':{count:1,amountCents:30000},'2026':{count:1,amountCents:25000}},'Review separates old and recent source gifts still waiting for thanks')
  assert.deepEqual([p.sourceTotals.giftCount,p.sourceTotals.amountCents],[5,170000],'Soft credits and goods are never counted as additional cash')
  await post(h,'apply',{id:p.id,fingerprint:'stale'},{status:409})
  const member=await h.person([id(9191),'example.test'].join('@'))
  await post(h,'preview',uploaded,{as:member.cookie,status:403})
  await post(h,'apply',{id:p.id,fingerprint:p.fingerprint},{as:member.cookie,status:403})
  const admin=await h.person([id(9192),'example.test'].join('@'),'admin')
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await post(h,'apply',{id:p.id,fingerprint:p.fingerprint},{as:admin.cookie,status:401})
  if(source==='bloomerang'&&format==='csv')await reconciliationBrowser(h,{preview:p,input:uploaded})
  else await apply(h,p)
  const people=(await h.get('/api/coffer/donors')).donors,first=people.find(d=>d.name==='First Import Donor'),second=people.find(d=>d.name==='Second Import Donor'),credited=people.find(d=>d.name==='Credit Import Donor')
  const detail=await h.get('/api/coffer/donors/'+first.id),other=await h.get('/api/coffer/donors/'+second.id)
  const gifts=Object.fromEntries([...detail.gifts,...other.gifts].map(g=>[g.reference.split(':')[1],g]))
  assert.equal(gifts[id(9111)].acknowledgment.link.id,detail.depth.interactions.find(i=>i.notes==='Imported gift thank-you').id)
  assert.equal(other.giftDepth.creditedGifts[0].acknowledgment.link.id,other.depth.interactions.find(i=>i.notes==='Independent source credit thank-you').id)
  assert.equal(gifts[id(9114)].acknowledgment.status,'not acknowledged')
  assert.deepEqual((await h.get('/api/coffer/letters')).due.map(g=>g.id),[gifts[id(9112)].id],'Only the current not-acknowledged gift reaches the queue; the older one stays excluded')
  const agent=await h.get('/api/coffer/agent');assert.deepEqual(agent.missingReceipts.map(g=>g.id),[gifts[id(9112)].id],'DEV-003 serves the current gift and excludes the older not-acknowledged gift')
  const report=(await h.get(endpoint+'/journal?id='+p.id)).job
  assertControls(report.check_report.rows);assert.equal(report.check_report.matches,true)
  await post(h,'check',{id:p.id},{as:member.cookie,status:403})
  await post(h,'check',{id:p.id},{as:admin.cookie,status:401})
  assert.deepEqual((await h.get(endpoint+'/journal?id='+p.id)).job.check_report,report.check_report,'Refused reconciliation cannot replace the recorded controls or current check')
  assert.deepEqual(report.report.controlTotals,p.controlTotals,'Supplied controls retain their independent values and original locations')
  assert.equal(row(report.check_report.rows,'restriction','Restricted constituents').cofferCount,2)
  assert.equal(row(report.check_report.rows,'restriction','mail withdrawals').cofferCount,source==='re-nxt'?0:1)
  const saved=await archive(h)
  await run(async fresh=>{await restore(fresh,saved);assertControls((await post(fresh,'check',{id:p.id})).rows);await post(fresh,'undo',{id:p.id});assert.equal((await fresh.get('/api/coffer/donors')).total,0)})
  const repeat=await post(h,'preview',uploaded);assert.equal((await apply(h,repeat)).unchanged,true);assert.equal((await h.get('/api/coffer/donors')).total,3)
  await post(h,'undo',{id:p.id});assert.equal((await h.get('/api/coffer/donors')).total,0)
  const again=await post(h,'preview',uploaded);await apply(h,again)
  // A second move-in also reconciles soft credits owned by the first one.
  const later=await post(h,'preview',await input({extra:true}));await apply(h,later,{acceptedReason:'The additional gift is outside the earlier control report.'})
  assert.equal(row((await post(h,'check',{id:later.id})).rows,'source report soft-credit acknowledgment','acknowledged').cofferCount,1)
  await post(h,'undo',{id:later.id});assert.equal((await post(h,'check',{id:again.id})).matches,true)
  const stale=await post(h,'preview',await input({extra:true}))
  await h.command('gift.resetAcknowledgment',{giftId:gifts[id(9111)].id,version:1})
  await post(h,'apply',{id:stale.id,fingerprint:stale.fingerprint,acceptedReason:'A reason cannot approve facts changed after review.'},{status:409})
  assert.equal((await h.get('/api/coffer/donors/'+first.id)).gifts.length,3,'Stale reconciliation applies none of the additional gifts')
  const sc=(await h.get('/api/coffer/donors/'+credited.id)).giftDepth.creditedGifts.find(s=>s.gift_id===gifts[id(9112)].id)
  await h.command('softCredit.doNotAcknowledge',{softCreditId:sc.id,version:1,reason:'Later native instruction'})
  await h.command('gift.classify',{giftId:gifts[id(9114)].id,version:1,goods:'provided',goodsValue:'10',goodsDescription:'Later source review'})
  const notification=await h.command('tributeNotification.prepare',{giftId:gifts[id(9111)].id})
  const notice=(await h.get('/api/coffer/donors/'+first.id)).tributeNotifications.find(n=>n.id===notification.id)
  assert.ok(!notice.body.includes('$'),'Reconciliation never grants family amount permission')
  assert.equal((await h.get('/api/coffer/donors/'+first.id)).giftDepth.tributes.find(t=>t.gift_id===gifts[id(9111)].id).amount_permission,0)
  await h.command('gift.reverse',{giftId:gifts[id(9111)].id,reason:'Signed tribute correction',reversedOn:'2026-10-01'})
  const check=await post(h,'check',{id:again.id});assert.equal(check.matches,false)
  assert.deepEqual([row(check.rows,'source report gift acknowledgment','acknowledged').sourceCount,row(check.rows,'source report gift acknowledgment','acknowledged').cofferCount],[2,1])
  assert.deepEqual([row(check.rows,'source report soft-credit acknowledgment','not acknowledged').sourceCount,row(check.rows,'source report soft-credit acknowledgment','not acknowledged').cofferCount],[1,0])
  assert.deepEqual([row(check.rows,'source report goods','all').sourceCents,row(check.rows,'source report goods','all').cofferCents],[6000,7000])
  assert.deepEqual([row(check.rows,'source report tribute','memory:river reed').sourceCents,row(check.rows,'source report tribute','memory:river reed').cofferCents],[75000,25000])
  assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.key==='memory:river reed').totalCents,25000)
  if(source==='bloomerang'&&format==='csv')await reconciliationBrowser(h,{preview:again,phase:'check'})
  await post(h,'undo',{id:again.id},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,3,'Later native work is never removed by undo')
  const changedPreview=await post(h,'preview',await input({extra:true}));assert.equal(row(changedPreview.reconciliation,'source report goods','all').cofferCents,7000,'Preview reads newer native goods facts, not cached source calculations')
  assert.equal(row(changedPreview.reconciliation,'source report gift acknowledgment','acknowledged').cofferCount,1,'A missing native status uses the native default, never the old source status')
  await h.command('donor.erase',{donorId:first.id,confirm:'ERASE'})
  assert.equal((await post(h,'preview',uploaded)).canApply,false)
  await post(h,'apply',{id:again.id,fingerprint:again.fingerprint},{status:409})
  await post(h,'check',{id:again.id},{status:409})
  const erased=(await h.get(endpoint+'/journal?id='+again.id)).job
  assert.deepEqual(erased.report,{});assert.equal(erased.check_report,null,'Erasure removes the recorded reconciliation as well as its source controls')
  assert.ok(!JSON.stringify(await archive(h)).includes('First Import Donor'),'Erasure removes retained source controls, samples and current checks')
 })
}

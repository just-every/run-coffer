import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {recognitionEdges,form} from './recognition-edge.mjs'
import {signInPortal} from './portal-journey.mjs'

const address=name=>name+String.fromCharCode(64)+'example.test'
const options=edge=>({bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-9101'},outbound:edge.outbound})
const pagePath=id=>'/giving/peer/pages/'+id
const boardPath=id=>'/giving/peer/leaderboard/'+id+'?format=json'
const portalPost=async(h,path,input,as,status=200)=>{
 const response=await h.request('/giving/peer/'+path+'?format=json',{...form(input),as})
 assert.equal(response.status,status,await response.clone().text())
 return status===200?response.json():response
}
async function seed(h){
 await reviewed(h)
 const parent=await h.api('/api/coffer/giving/campaigns',{name:'Community reading',slug:'community-reading',description:'Books across the county.',fund:'Reading',goal:'60000'})
 const campaign={...await h.api('/api/coffer/giving/campaigns',{name:'Peer reading',slug:'peer-reading',description:'Readers raising support together.',fund:'Reading',goal:'1000',parentId:parent.id}),slug:'peer-reading'}
 const first=await donor(h,'First Fundraiser',{email:address('first.peer')}),second=await donor(h,'Second Fundraiser',{email:address('second.peer')})
 const firstCookie=(await signInPortal(h,address('first.peer'))).cookie,secondCookie=(await signInPortal(h,address('second.peer'))).cookie
 return {parent,campaign,first,second,firstCookie,secondCookie}
}
async function recognition(h,as,name,extra={}){
 const current=await h.get('/giving/peer/state',{as})
 return portalPost(h,'recognition',{version:current.recognition.version,recognitionName:name,anonymous:'no',honorRollOptIn:'yes',...extra},as)
}
async function give(h,pageId,who,cents,extra={}){
 const input={name:who,email:address(who.toLowerCase().replaceAll(' ','.')),amount:(cents/100).toFixed(2),frequency:'once',requestId:randomUUID(),peerPageId:pageId,'cf-turnstile-response':'synthetic-coffer-security-token',...extra}
 const response=await h.request('/give/peer-reading/checkout',{...form(input),as:''})
 assert.equal(response.status,303,await response.text())
 const sessionId=new URL(response.headers.get('location')).pathname.split('/').at(-1)
 const completed=await h.request('/giving/thanks?session_id='+sessionId,{as:''});assert.equal(completed.status,200,await completed.text())
 const owner=(await h.get('/api/coffer/donors')).donors.find(d=>d.name===who),state=await h.get('/api/coffer/donors/'+owner.id)
 assert.equal(state.totals.lifetimeCents,cents)
 return {input,sessionId,donorId:owner.id,gift:state.gifts.find(g=>g.kind==='gift')}
}

export async function peerJourney(){
 const edge=recognitionEdges()
 await run(async h=>{
  const {parent,campaign,first,second,firstCookie,secondCookie}=await seed(h)
  const state=as=>h.get('/giving/peer/state',{as}),pub=id=>h.get(pagePath(id)+'?format=json',{as:''}),board=()=>h.get(boardPath(campaign.id),{as:''})
  const create={campaignId:campaign.id,title:'Readers together',goal:'100',publish:'yes',publicationPermission:'yes'}
  await portalPost(h,'teams',create,firstCookie,409)
  assert.deepEqual((await state(firstCookie)).teams,[],'Unapproved public recognition cannot create a published team')
  await recognition(h,firstCookie,'First Reading Champion');await recognition(h,secondCookie,'Second Reading Champion')
  await portalPost(h,'teams',{...create,publicationPermission:'no'},firstCookie,400)
  const team=await portalPost(h,'teams',create,firstCookie)
  const draft=await portalPost(h,'pages',{campaignId:campaign.id,title:'Private preparation',goal:'50'},firstCookie)
  assert.equal((await h.request(pagePath(draft.id),{as:''})).status,404)
  assert.ok(!(await state(secondCookie)).pages.some(p=>p.id===draft.id),'Other supporters cannot read private editing state')
  assert.equal((await h.request('/giving/peer/state',{as:h.owner})).status,303,'A staff session does not impersonate a supporter')
  assert.equal((await h.request('/giving/peer/pages', {...form(create),as:''})).status,303)
  const p1=await portalPost(h,'pages',{...create,title:'First reading page',teamId:team.id},firstCookie)
  const p2=await portalPost(h,'pages',{...create,title:'Second reading page',teamId:team.id},secondCookie)
  const before=await state(firstCookie)
  await portalPost(h,'pages',{...create,id:p1.id,version:1,title:'Wrong supporter',teamId:team.id},secondCookie,409)
  assert.deepEqual(await state(firstCookie),before,'Cross-supporter mutation changes nothing')
  await portalPost(h,'pages',{...create,id:p1.id,version:99,teamId:team.id},firstCookie,409)
  await portalPost(h,'pages',{...create,campaignId:parent.id,teamId:team.id},firstCookie,409)
  const crossOrigin=await h.request('/giving/peer/pages',{...form(create),as:firstCookie,headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://other.invalid'}})
  assert.equal(crossOrigin.status,403)
  assert.equal((await board()).pages.length,2)
  const firstGift=await give(h,p1.id,'First Actual Giver',2500,{wallOptIn:'yes',recognitionName:'Private Giving Name',anonymous:'yes'})
  const secondGift=await give(h,p2.id,'Second Actual Giver',4000,{wallOptIn:'yes',recognitionName:'The Book Circle'})
  const privateGift=await give(h,p2.id,'Private Actual Giver',1500,{wallOptIn:'no',recognitionName:'Never Publish This'})
  assert.deepEqual((await pub(p1.id)).wall.map(r=>[r.name,r.amountCents]),[['Anonymous',2500]])
  assert.deepEqual((await pub(p2.id)).wall.map(r=>[r.name,r.amountCents]),[['The Book Circle',4000]])
  const serialized=JSON.stringify(await pub(p2.id))
  for(const value of [secondGift.donorId,secondGift.gift.id,'Second Actual Giver',address('second.actual.giver'),'Never Publish This'])assert.ok(!serialized.includes(value),value)
  assert.deepEqual((await board()).pages.map(p=>[p.id,p.raisedCents]).sort(),[[p1.id,2500],[p2.id,5500]].sort())
  assert.equal((await board()).teams[0].raisedCents,8000)
  for(const [d,expected] of [[first,2500],[second,5500]]){
   const detail=await h.get('/api/coffer/donors/'+d.id)
   assert.equal(detail.totals.lifetimeCents,0,'Fundraising does not create donor hard credit')
   assert.equal(detail.giftDepth.recognitionCents,expected)
   assert.equal(detail.giftDepth.creditedGifts.filter(c=>c.active).reduce((n,c)=>n+c.recognized_cents,0),expected)
  }
  let progress=await h.get('/api/coffer/giving/campaigns/'+parent.id)
  assert.deepEqual([progress.raisedCents,progress.softCreditCents,progress.giftCount,progress.donorCount,progress.newDonors,progress.averageGiftCents],[8000,8000,3,3,3,2667])
  assert.equal(progress.entries.reduce((sum,row)=>sum+row.amount_cents,0),8000)
  const credits=(await h.get('/api/coffer/donors/'+second.id)).giftDepth.creditedGifts
  await h.command('softCredit.remove',{softCreditId:credits.find(c=>c.gift_id===privateGift.gift.id).id})
  for(const paid of [firstGift,secondGift,privateGift]){
   assert.equal((await h.request('/giving/thanks?session_id='+paid.sessionId,{as:''})).status,200)
   const changed=await h.request('/give/peer-reading/checkout',{...form({...paid.input,peerPageId:paid===firstGift?p2.id:p1.id}),as:''});assert.equal(changed.status,409)
   const generic={...paid.input};delete generic.peerPageId
   assert.equal((await h.request('/give/peer-reading/checkout',{...form(generic),as:''})).status,409)
  }
  assert.equal((await h.get('/api/coffer/donors/'+second.id)).giftDepth.creditedGifts.length,1,'Replayed capture does not recreate a removed soft credit')
  assert.equal((await board()).raisedCents,8000,'Credits never inflate ledger cash')
  await h.command('recognition.gift',{giftId:secondGift.gift.id,anonymous:true,wallOptIn:true})
  assert.deepEqual((await pub(p2.id)).wall.map(r=>r.name),['Anonymous'])
  await recognition(h,firstCookie,'First Reading Champion',{anonymous:'yes'})
  assert.equal((await h.request(pagePath(p1.id),{as:''})).status,404)
  const attempts=edge.sessions.size
  assert.equal((await h.request('/give/peer-reading/checkout',{...form({...firstGift.input,requestId:randomUUID()}),as:''})).status,409)
  assert.equal(edge.sessions.size,attempts,'Unpublished pages never contact the payment provider')
  await recognition(h,firstCookie,'First Reading Champion')
  assert.equal((await h.request(pagePath(p1.id),{as:''})).status,404,'A later recognition grant does not republish a withdrawn page')
  const own=(await state(firstCookie)).pages.find(p=>p.id===p1.id)
  await portalPost(h,'pages',{...create,id:p1.id,version:own.version,title:'First reading page',teamId:team.id},firstCookie)
  const saved=await archive(h),expectedBoard=await board()
  await run(async fresh=>{
   await restore(fresh,saved)
   assert.deepEqual(await fresh.get(boardPath(campaign.id),{as:''}),expectedBoard)
   assert.equal((await fresh.request('/giving/peer/state',{as:firstCookie})).status,303,'Restore cannot restore a supporter credential')
   assert.equal((await fresh.get('/api/coffer/donors/'+first.id)).giftDepth.recognitionCents,2500)
  },{bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-9101'},givingProtection:false})
  const file=await h.api('/api/coffer/donors/'+first.id+'/data-request',{requestedOn:'2026-09-15',method:'email'})
  assert.ok(file.records.peer_pages.some(p=>p.id===p1.id))
  assert.ok(!JSON.stringify(file.records).includes('First Actual Giver'),'Fundraiser data file does not expose the donor behind a soft credit')
  await h.command('gift.reverse',{giftId:firstGift.gift.id,reason:'Returned gift',reversedOn:'2026-09-16'})
  assert.equal((await pub(p1.id)).raisedCents,0);assert.equal((await pub(p1.id)).giftCount,0)
  assert.equal((await h.get('/api/coffer/donors/'+first.id)).giftDepth.recognitionCents,0)
  assert.equal((await h.get('/api/coffer/giving/campaigns/'+parent.id)).raisedCents,5500)
  assert.equal((await h.request('/giving/thanks?session_id='+firstGift.sessionId,{as:''})).status,200)
  assert.equal((await pub(p1.id)).raisedCents,0,'Replayed paid capture cannot reverse a reversal')
  const comparison=await h.get('/api/coffer/duplicates/compare?source='+first.id+'&target='+second.id)
  const merged=await h.command('donor.merge',{sourceDonorId:first.id,donorId:second.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.equal((await h.request('/giving/peer/state',{as:firstCookie})).status,303)
  assert.equal((await h.request('/giving/peer/state',{as:secondCookie})).status,303)
  assert.equal((await board()).pages.length,0,'Merge invalidates both public permissions')
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.equal((await board()).pages.length,0,'Undo does not revive public permissions')
  assert.equal((await h.get('/api/coffer/donors/'+second.id)).giftDepth.recognitionCents,4000)
  const freshCookie=(await signInPortal(h,address('first.peer'))).cookie
  const revived=(await state(freshCookie)).pages.find(p=>p.id===p1.id)
  await portalPost(h,'pages',{...create,id:p1.id,version:revived.version,title:'First reading page'},freshCookie)
  await h.command('donor.erase',{donorId:first.id,confirm:'ERASE'})
  assert.equal((await h.request(pagePath(p1.id),{as:''})).status,404)
  assert.equal((await h.request('/giving/peer/state',{as:freshCookie})).status,303)
  assert.equal((await h.request('/giving/thanks?session_id='+firstGift.sessionId,{as:''})).status,200)
  assert.equal((await board()).pages.length,0)
  const erased=JSON.stringify(await archive(h))
  for(const text of ['First Reading Champion','First reading page','Private preparation','Readers together'])assert.ok(!erased.includes(text),text+' erased from retained private state')
  assert.equal((await h.get('/api/coffer/giving/campaigns/'+parent.id)).raisedCents,5500)
  await h.command('donor.erase',{donorId:secondGift.donorId,confirm:'ERASE'})
  assert.equal((await h.request('/giving/thanks?session_id='+secondGift.sessionId,{as:''})).status,409,'Erased payment identity is not recreated by capture replay')
  assert.ok(!(await h.get('/api/coffer/donors')).donors.some(d=>d.name==='Second Actual Giver'))
  assert.equal((await h.get('/api/coffer/giving/campaigns/'+parent.id)).raisedCents,5500)
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'},{status:409})
 },options(edge))
 if(process.env.COFFER_PEER_BROWSER){
  const browserEdge=recognitionEdges()
  await run(async h=>{const data=await seed(h);const {peerBrowser}=await import('./peer-browser.mjs');await peerBrowser(h,browserEdge,data,process.env.COFFER_PEER_BROWSER)},options(browserEdge))
 }
}

import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'

export async function automationGrantsJourney() {
 await run(async h=>{
  await reviewed(h)
  const a=await donor(h,'Maya Automation'),b=await donor(h,'Blake Outside Scope')
  const day='2026-01-15',tick=()=>h.mf.dispatchFetch(h.origin+'/cdn-cgi/local/scheduled?time='+Date.parse('2026-10-23T12:00:00Z')+'&format=json')
  const gift=(d,amount)=>h.command('gift.record',{donorId:d.id,amount,receivedOn:day,method:'check',goods:'none'})
  await gift(a,'25');await gift(b,'35')
  const grants=()=>h.get('/api/coffer/agent/grants')
  let receipt=(await grants()).find(g=>g.id==='receipts')
  const save=p=>h.api('/api/coffer/agent/grants',{id:receipt.id,version:receipt.version,dailyLimit:1,enabled:true,scope:'selected',donorIds:a.id,...p})
  await save({})
  assert.equal((await tick()).status,200)
  let letters=await h.get('/api/coffer/letters')
  assert.equal(letters.batches.length,1)
  const batch=await h.get('/api/coffer/letters/'+letters.batches[0].id)
  assert.deepEqual(batch.letters.map(l=>l.donor_id),[a.id])
  const events=(await h.get('/api/coffer/audit?limit=100')).rows
  assert.ok(events.some(e=>e.action==='automation.claim'&&JSON.parse(e.detail).grantId==='automation:receipts'))
  await gift(a,'45')
  const control=(await h.get('/api/coffer/agent-grants')).control
  await h.command('agentGrant.kill',{version:control.version,enabled:false})
  assert.equal((await tick()).status,200)
  assert.equal((await h.get('/api/coffer/letters')).batches.length,1,'Global kill stops all built-in jobs as well as bearer tools')
  const stopped=(await h.get('/api/coffer/agent-grants')).control
  await h.command('agentGrant.kill',{version:stopped.version,enabled:true})
  assert.equal((await tick()).status,200)
  assert.equal((await h.get('/api/coffer/letters')).batches.length,1,'Daily limit refuses a second autonomous preparation')
  receipt=(await grants()).find(g=>g.id==='receipts')
  await save({donorIds:b.id,dailyLimit:2})
  assert.equal((await tick()).status,200)
  letters=await h.get('/api/coffer/letters')
  assert.equal(letters.batches.length,2)
  const newest=await h.get('/api/coffer/letters/'+letters.batches.find(x=>x.id!==batch.batch.id).id)
  assert.deepEqual(newest.letters.map(l=>l.donor_id),[b.id],'Narrowed records replace prior scope immediately')
  receipt=(await grants()).find(g=>g.id==='receipts')
  await save({enabled:false})
  await h.api('/api/coffer/agent/grants',{id:'receipts',version:receipt.version,dailyLimit:1,enabled:true},{as:'',status:401})
  if(process.env.COFFER_GRANT_BROWSER){const {automationGrantsBrowser}=await import('./agent-grants-browser.mjs');await automationGrantsBrowser(h,process.env.COFFER_GRANT_BROWSER)}
 },{entry:'tests/automation-worker.ts',triggerHandlers:true})
}

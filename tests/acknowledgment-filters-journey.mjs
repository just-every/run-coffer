import {parseCsv} from './exports-journey.mjs'
import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'
import {acknowledgmentFiltersBrowser} from './acknowledgment-filters-browser.mjs'

const query=input=>new URLSearchParams(input).toString()
export async function acknowledgmentFiltersJourney(){await run(async h=>{
 await reviewed(h)
 const mixed=await donor(h,'Rivera Family'),waiting=await donor(h,'Reading Room Friends'),excluded=await donor(h,'Internal Payroll'),thanked=await donor(h,'Bookmobile Funders')
 const give=(d,amount)=>h.command('gift.record',{donorId:d.id,amount,receivedOn:'2025-08-01',method:'check',goods:'none',fund:'Literacy'})
 const big=await give(mixed,'1000'),small=await give(mixed,'100'),g300=await give(waiting,'300'),g600=await give(waiting,'600'),boundary=await give(waiting,'250'),skip=await give(excluded,'500'),phone=await give(thanked,'400'),letter=await give(thanked,'800')
 await h.command('gift.acknowledge',{giftId:big.id,version:0,acknowledgedOn:'2025-08-02',method:'letter',notes:'synthetic-coffer-1201'})
 await h.command('gift.doNotAcknowledge',{giftId:skip.id,version:0,reason:'synthetic-coffer-1202'})
 const call=await h.command('interaction.record',{donorId:thanked.id,kind:'call',occurredOn:'2025-08-03',who:'Casey',notes:'synthetic-coffer-1203'})
 await h.command('gift.acknowledge',{giftId:phone.id,version:0,acknowledgedOn:'2025-08-03',method:'phone call',interactionId:call.id})
 const letterAck=await h.command('gift.acknowledge',{giftId:letter.id,version:0,acknowledgedOn:'2025-08-04',method:'handwritten note',notes:'synthetic-coffer-1204'})
 await h.command('custom.define',{key:'ack_project',label:'Project',kind:'gift',type:'text',entry:'free-form'})
 const saved=await h.command('list.save',{name:'Waiting gifts over $250',filters:{ackStatus:'not acknowledged',giftOver:'250'}})
 const ids=async()=> (await h.get(`/api/coffer/lists/${saved.id}/members`)).donorIds.sort()
 const exported=async suffix=>{
  const response=await h.request('/api/coffer/exports/gifts.csv?'+suffix);assert.equal(response.status,200)
  const text=await response.text()
  const rows=parseCsv(text)
  return {text,rows,ids:rows.map(row=>row.id).sort()}
 }
 assert.deepEqual(await ids(),[waiting.id],'Amount and status belong to the same gift, never separate gifts from a donor')
 assert.deepEqual((await exported('list=saved:'+saved.id)).ids,[g300.id,g600.id].sort(),'Only waiting gifts strictly over $250, never an acknowledged sibling, exclusion or exact boundary')
 assert.equal((await h.get('/api/coffer/exports/preview?type=gifts&list=saved:'+saved.id)).selection.scope,'matching-gifts')
 const readAcks=async()=>{
  const facts=[]
  for(const d of [mixed,waiting,excluded,thanked])for(const g of (await h.get('/api/coffer/donors/'+d.id)).gifts)facts.push([g.id,g.acknowledgment])
  return facts.sort((a,b)=>a[0].localeCompare(b[0]))
 }
 const before=await readAcks(),audit=await h.get('/api/coffer/audit?action=gift.acknowledgment')
 const cases=[
  [{ackStatus:'not acknowledged',giftOver:'250'},[g300.id,g600.id],90000],
  [{ackStatus:'acknowledged',ackFrom:'2025-08-03',ackThrough:'2025-08-03',ackMethod:'phone call',ackLink:call.id},[phone.id],40000],
  [{ackFrom:'2025-08-04'},[letter.id],80000],
  [{ackThrough:'2025-08-02'},[big.id],100000],
  [{ackMethod:'handwritten note',ackLink:letterAck.noteId},[letter.id],80000],
  [{ackStatus:'do not acknowledge'},[skip.id],50000],
  [{ackStatus:'acknowledged',ackMethod:'phone call',ackLink:letterAck.noteId},[],0],
 ]
 for(const [filters,expected,cents] of cases){
  const q=query(filters),list=await h.command('list.save',{name:'Thank-you selection',filters})
  assert.deepEqual((await exported('list=saved:'+list.id)).ids,[...expected].sort(),'Saved gift selection '+q)
  for(const report of ['funds','states','attribution','custom-fields','honor-roll','dashboard-money']){
   const params=query({...filters,report,year:'2025',from:'2025-01-01',through:'2025-12-31',to:'2025-12-31',field:'ack_project'})
   const preview=await h.get('/api/coffer/exports/preview?type=gifts&'+params)
   assert.equal(preview.reportCents,cents,report+' filtered total '+q)
   assert.deepEqual((await exported(params)).ids,[...expected].sort(),report+' exact gift membership '+q)
  }
  const nativeParams=query({...filters,year:'2025',from:'2025-01-01',through:'2025-12-31',to:'2025-12-31'})
  assert.equal((await h.get('/api/coffer/reports/states?'+nativeParams)).totalCents,cents,'Native by-state total')
  assert.equal((await h.get('/api/coffer/reports/attribution?'+nativeParams)).ledgerCents,cents,'Native attribution total')
  assert.equal((await h.get('/api/coffer/reports/honor-roll?'+nativeParams)).totalCents,cents,'Native honor-roll total')
  const dashboard=await h.get('/api/coffer/reports/dashboard?'+nativeParams)
  assert.equal(dashboard.summary.currentCents,cents,'Native dashboard total')
  const drill=await h.get('/api/coffer/reports/dashboard/entries?'+nativeParams)
  assert.equal(drill.totalCents,cents)
  assert.deepEqual([...new Set(drill.entries.map(r=>r.gift_id))].sort(),[...expected].sort(),'Dashboard drilldown retains thank-you filters')
  const funds=await h.get('/api/coffer/reports/funds?'+q)
  assert.deepEqual([...new Set(funds.entries.map(r=>r.gift_id))].sort(),[...expected].sort())
  assert.equal(funds.funds.reduce((n,r)=>n+r.amount_cents,0),cents)
  const custom=await h.get('/api/coffer/reports/custom-fields?field=ack_project&'+q)
  assert.deepEqual(custom.records.map(r=>r.originalId).sort(),[...expected].sort());assert.equal(custom.totalCents,cents)
 }
 // Validate both invalid enums and impossible date intervals through the saved-list door.
 await h.command('list.save',{name:'Invalid',filters:{ackFrom:'2025-08-04',ackThrough:'2025-08-03'}},{status:400})
 await h.get('/api/coffer/reports/funds?ackMethod=check',{status:400})
 assert.deepEqual(await readAcks(),before,'Reading and saving filters never change any acknowledgment fact or version')
 assert.deepEqual((await h.get('/api/coffer/audit?action=gift.acknowledgment')).rows,audit.rows,'Filter reads append no acknowledgment audit event')
 await h.command('gift.acknowledge',{giftId:g300.id,version:0,acknowledgedOn:'2025-08-05',method:'letter',notes:'synthetic-coffer-1205'})
 assert.deepEqual((await exported('list=saved:'+saved.id)).ids,[g600.id],'Saved gift selection stays live')
 await h.command('gift.resetAcknowledgment',{giftId:g300.id,version:1})
 assert.deepEqual((await exported('list=saved:'+saved.id)).ids,[g300.id,g600.id].sort())
 const receiptRows=(await exported(query({ackLink:call.id}))).rows
 assert.equal(receiptRows.length,1)
 assert.deepEqual([receiptRows[0].acknowledgment_status,receiptRows[0].acknowledged_on,receiptRows[0].acknowledgment_method,JSON.parse(receiptRows[0].acknowledgment_link)],[ 'acknowledged','2025-08-03','phone call',{kind:'interaction',id:call.id} ])
 if(process.env.COFFER_ACK_FILTER_BROWSER)await acknowledgmentFiltersBrowser(h,{saved,call,phone,g300,g600,directory:process.env.COFFER_ACK_FILTER_BROWSER})
 await h.command('gift.reverse',{giftId:phone.id,reason:'synthetic-coffer-1206'})
 const reversal=await h.get('/api/coffer/reports/funds?'+query({ackLink:call.id}))
 assert.equal(reversal.entries.length,2)
 assert.deepEqual([...new Set(reversal.entries.map(r=>r.gift_id))],[phone.id],'A reversal follows the original gift acknowledgment')
 assert.equal(reversal.funds[0].amount_cents,0)
 assert.equal((await h.get('/api/coffer/reports/funds?'+query({ackLink:call.id,giftOver:'250'}))).entries.length,0,'Gift amount filters use the remaining positive gift balance')
})}

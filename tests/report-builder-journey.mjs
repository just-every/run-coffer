import assert from 'node:assert/strict'
import readXlsxFile from 'read-excel-file/node'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {parseCsv as csvRecords} from './exports-journey.mjs'
const parseCsv=input=>[input.slice(0,input.indexOf('\r\n')).split(','),...csvRecords(input).map(Object.values)]
import {builderBrowser} from './report-builder-browser.mjs'

const headers={'x-test-now':'2026-10-18T02:00:00.000Z'},options={headers}
const definition={recordType:'gifts',columns:['id','received_on','fund','amount_cents'],groupBy:['fund','month'],totals:['amount_cents'],from:'2025-01-01',through:'2025-12-31',filters:[]}
async function seed(h){
 await reviewed(h)
 const d=await donor(h,'Marisol Alvarez',{email:null})
 const a=await h.command('gift.record',{donorId:d.id,amount:'123.45',receivedOn:'2025-01-10',method:'check',goods:'none',allocations:[{fund:'Library',amountCents:10001},{fund:'Scholarships',amountCents:2344}]},options)
 await h.command('gift.record',{donorId:d.id,amount:'200.01',receivedOn:'2025-02-10',fund:'Library',method:'check',goods:'none'},options)
 const reversed=await h.command('gift.record',{donorId:d.id,amount:'10.01',receivedOn:'2025-02-11',fund:'Library',method:'check',goods:'none'},options)
 await h.command('gift.reverse',{giftId:reversed.id,reason:'Corrected entry',reversedOn:'2025-03-01'},options)
 await h.command('inKind.save',{donorId:d.id,description:'Books',quantity:'2',statedValue:'50',receivedOn:'2025-03-02',goods:'none'},options)
 return {d,a}
}
export async function reportBuilderJourney(){
 let document,expected,portable
 await run(async h=>{
  const {d,a}=await seed(h),member=await h.person('synthetic-coffer-5101'+String.fromCharCode(64)+'example.test'),other=await h.person('synthetic-coffer-5102'+String.fromCharCode(64)+'example.test')
  const save={name:'Gifts by fund and month',definition}
  await h.command('report.save',save,{...options,as:'',status:401})
  await h.command('report.save',save,{...options,as:member.cookie,status:403})
  const agent=await h.command('agent.create',{label:'synthetic-coffer-5103'}),asAgent={as:'',headers:{...headers,authorization:'Bearer '+agent.token}}
  await h.command('report.save',save,{...asAgent,status:403})
  const saved=await h.command('report.save',save,options),path='/api/coffer/reports/builder?id='+saved.id
  const data=await h.get(path,options);assert.equal(data.totals.amount_cents,32346);assert.equal(data.count,4)
  assert.deepEqual(data.groups.map(g=>[g.fund,g.month,g.amount_cents]).sort(),[['Library','2025-01',10001],['Library','2025-02',21002],['Library','2025-03',-1001],['Scholarships','2025-01',2344],['Unrestricted','2025-03',0]].sort())
  const ledger=await h.get('/api/coffer/reports/funds?from=2025-01-01&through=2025-12-31',options)
  assert.equal(data.totals.amount_cents,ledger.funds.reduce((n,f)=>n+f.amount_cents,0))
  await h.get(path,{...options,as:member.cookie,status:404})
  await h.command('report.share',{reportId:saved.id,version:1,operatorId:member.id},{...options,status:400})
  await h.command('report.share',{reportId:saved.id,version:1,operatorId:member.id,reviewed:'yes'},options)
  assert.deepEqual((await h.get(path,{...options,as:member.cookie})).rows,data.rows)
  await h.get(path,{...options,as:other.cookie,status:404})
  await h.get(path+'&download=csv',{...options,as:member.cookie,status:403})
  await h.get(path,{...asAgent,status:403})
  const file=await h.request(path+'&download=csv',options);assert.equal(file.status,200);const csv=parseCsv(await file.text())
  assert.deepEqual(csv[0],definition.columns);assert.equal(csv.slice(1).reduce((n,row)=>n+Number(row[3]),0),32346)
  const xlsx=await h.request(path+'&download=xlsx',options);assert.equal(xlsx.status,200)
  const sheet=(await readXlsxFile(Buffer.from(await xlsx.arrayBuffer())))[0].data;assert.deepEqual(sheet[0],csv[0]);assert.deepEqual(sheet.slice(1).map(r=>r.map(v=>String(v??''))),csv.slice(1))
  const apiExport=await h.request('/api/coffer/exports/gifts.csv?report=builder&id='+saved.id,options);assert.equal(apiExport.status,200)
  const raw=parseCsv(await apiExport.text()),amount=raw[0].indexOf('amount_cents');assert.equal(raw.slice(1).reduce((n,r)=>n+Number(r[amount]),0),32346)
  await h.command('reportSchedule.save',{name:'Monthly saved report',reportPath:'/app/reports/builder?id='+saved.id+'&',recipients:'synthetic-coffer-5101'+String.fromCharCode(64)+'example.test',cadence:'weekly',startsAt:'2026-10-25T02:00',reviewed:'yes'},options)
  assert.equal((await h.get('/api/coffer/report-schedules')).schedules[0].report_path,'/app/reports/builder?id='+saved.id)
  const tick=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+Date.parse('2026-10-25T02:00:00Z'),{headers:{'x-test-now':'2026-10-25T02:00:00Z'}});assert.equal(tick.status,200)
  const sent=h.messages.find(m=>m.subject==='Monthly saved report');assert.ok(sent?.attachments)
  assert.equal(JSON.parse(Buffer.from(sent.attachments[0].content,'base64').toString()).report.totals.amount_cents,32346)
  const edited=await h.command('report.save',{...save,reportId:saved.id,version:1,definition:{...definition,columns:[...definition.columns,'method']}},options)
  await h.command('report.save',{...save,reportId:saved.id,version:1},{...options,status:409})
  await h.get(path,{...options,as:member.cookie,status:404})
  assert.equal((await h.get('/api/coffer/report-schedules')).schedules[0].enabled,0)
  await h.command('report.share',{reportId:saved.id,version:2,operatorId:member.id,reviewed:'yes'},options)
  await h.command('report.revoke',{reportId:saved.id,version:2,operatorId:member.id},options)
  await h.get(path,{...options,as:member.cookie,status:404})
  const approver=await h.person('synthetic-coffer-5104'+String.fromCharCode(64)+'example.test','admin')
  await h.command('report.share',{reportId:saved.id,version:2,operatorId:member.id,reviewed:'yes'},{...options,as:approver.cookie})
  assert.equal((await h.get(path,{...options,as:member.cookie})).count,4)
  await h.api('/auth/operator/status',{operatorId:approver.id,status:'inactive'},options)
  await h.get(path,{...options,as:member.cookie,status:404})
  await h.get(path,{...options,as:approver.cookie,status:401})
  const json=await h.request(path+'&download=json',options);document=await json.json();expected=(await h.get(path,options)).totals
  assert.deepEqual(document.definition.columns,[...definition.columns,'method']);assert.ok(!JSON.stringify(document).includes(d.id),'Portable definitions contain fields, not source records')
  await h.command('custom.define',{key:'area',label:'Gift area',kind:'gift',type:'text',entry:'pick-one',choices:['Reading','Science']},options)
  await h.command('custom.set',{key:'area',recordId:a.id,version:0,value:'Reading'},options)
  const custom=await h.command('report.save',{name:'Reading gifts',definition:{...definition,columns:['id','custom.area','amount_cents'],groupBy:['custom.area'],filters:[{field:'custom.area',operator:'eq',value:'Reading'}]}},options)
  assert.equal((await h.get('/api/coffer/reports/builder?id='+custom.id,options)).totals.amount_cents,12345)
  await h.command('custom.renameChoice',{key:'area',version:1,from:'Reading',to:'Literacy'},options)
  const renamed=await h.get('/api/coffer/reports/builder?id='+custom.id,options)
  assert.equal(renamed.totals.amount_cents,12345);assert.equal(renamed.definition.filters[0].value,'Literacy');assert.equal(renamed.groups[0]['custom.area'],'Literacy')
  const call=await h.command('interaction.record',{donorId:d.id,kind:'call',occurredOn:'2025-01-11',notes:'Thank you'},options)
  await h.command('gift.acknowledge',{giftId:a.id,version:0,acknowledgedOn:'2025-01-11',method:'phone call',interactionId:call.id},options)
  const ack=await h.command('report.save',{name:'Thanked reading gifts',definition:{...definition,acknowledgment:{ackStatus:'acknowledged',ackFrom:'2025-01-11',ackThrough:'2025-01-11',ackMethod:'phone call',ackLink:call.id}}},options)
  assert.deepEqual((await h.get('/api/coffer/reports/builder?id='+ack.id,options)).rows.map(r=>r.id),[a.id])
  const wrong=await h.command('report.save',{name:'No matching thanks',definition:{...definition,acknowledgment:{ackStatus:'acknowledged',ackMethod:'email'}}},options)
  assert.equal((await h.get('/api/coffer/reports/builder?id='+wrong.id,options)).count,0)
  const pledge=await h.command('pledge.create',{donorId:d.id,amount:'100',pledgedOn:'2025-02-01',fund:'Library',installments:[{dueOn:'2026-12-01',amount:'100'}]},options)
  const owner=(await h.get('/auth/session')).operator
  const prospect=await h.command('prospect.save',{donorId:d.id,label:'Library expansion',ownerId:owner.id,stage:'cultivate',askAmount:'500',expectedAmount:'400',probability:50,expectedCloseOn:'2025-12-01',nextStep:'Discuss plans'},options)
  for(const [type,columns,totals,id] of [['constituents',['id','name'],[],d.id],['pledges',['id','amount_cents'],['amount_cents'],pledge.id],['opportunities',['id','expected_amount_cents'],['expected_amount_cents'],prospect.id],['interactions',['id','notes'],[],call.id]]){
   const r=await h.command('report.save',{name:type+' report',definition:{recordType:type,columns,groupBy:[],totals,filters:[{field:'id',operator:'eq',value:id}]}},options)
   assert.equal((await h.get('/api/coffer/reports/builder?id='+r.id,options)).count,1)
   const download=await h.request(`/api/coffer/exports/${type}.csv?report=builder&id=${r.id}`,options);assert.equal(download.status,200)
   assert.equal(parseCsv(await download.text()).length,2)
  }
  await builderBrowser(h,{id:saved.id,member,headers},process.env.COFFER_REPORT_BUILDER_BROWSER||'.cache/report-builder')
  const audit=await h.get('/api/coffer/audit?action=export.csv');assert.ok(audit.rows.some(r=>r.subject_id===saved.id&&JSON.parse(r.detail).rowCount===4))
  const backup=await archive(h);portable=backup;assert.ok(backup.some(line=>JSON.stringify(line).includes(saved.id)))
  await h.command('donor.erase',{donorId:d.id,confirm:'ERASE'})
  assert.equal((await h.get(path,options)).count,0)
  const replay=await h.command('report.import',{name:'Replayed definition after erasure',document},options)
  assert.equal((await h.get('/api/coffer/reports/builder?id='+replay.id,options)).count,0)
 },{entry:'tests/advancing-clock-worker.ts',triggerHandlers:true})
 await run(async h=>{
  await restore(h,portable)
  const restoredMember=await h.person('synthetic-coffer-5101'+String.fromCharCode(64)+'example.test')
  assert.equal((await h.get('/api/coffer/reports/builder',{...options,as:restoredMember.cookie})).reports.length,0,'Restoring data cannot restore an old disclosure identity')
  const imported=await h.command('report.import',{name:'Imported fund report',document},options)
  const data=await h.get('/api/coffer/reports/builder?id='+imported.id,options)
  assert.deepEqual(data.totals,expected);assert.equal(data.count,4);assert.ok(data.definition.columns.includes('method'))
  await h.command('report.import',{name:'Unsafe definition',document:{format:'coffer-report',definition:{...definition,columns:['payment_method']}}},{...options,status:400})
 })
}

import assert from 'node:assert/strict'

// Only the two postal-provider HTTP boundaries are faked. All constituents,
// connection changes, passes and scheduled batches use the real public doors.
export const verifiedMailBindings={SMARTY_AUTH_ID:'synthetic-coffer-1',SMARTY_AUTH_TOKEN:'synthetic-coffer-2',MELISSA_SMARTMOVER_KEY:'synthetic-coffer-3'}
const state=value=>({Minnesota:'MN',Illinois:'IL',California:'CA','New York':'NY',Texas:'TX',Massachusetts:'MA',Wisconsin:'WI',Florida:'FL',Washington:'WA',Oregon:'OR'})[value]??value
export function verifiedMailOutbound(outbound) {
 return async request=>{
  const u=new URL(request.url)
  if(u.hostname==='us-street.api.smarty.com'){
   assert.equal(request.method,'POST');assert.equal(u.pathname,'/street-address')
   assert.ok(request.headers.get('authorization')?.startsWith('Basic '))
   const records=await request.json();assert.equal(records.length,1)
   return Response.json(records.map((r,index)=>{
    const [zip,plus4]=r.zipcode.split('-')
    assert.match(zip,/^\d{5}$/);assert.match(state(r.state),/^[A-Z]{2}$/)
    return {input_id:r.input_id,input_index:index,candidate_index:0,delivery_line_1:r.street,delivery_line_2:r.street2??'',components:{city_name:r.city,state_abbreviation:state(r.state),zipcode:zip,...(plus4?{plus4_code:plus4}:{})},analysis:{dpv_match_code:'Y',dpv_vacant:'N',dpv_no_stat:'N',dpv_footnotes:'AABB'}}
   }))
  }
  if(u.hostname==='smartmover.melissadata.net'){
   assert.equal(request.method,'POST');assert.equal(u.pathname,'/V3/WEB/SmartMover/doSmartMover')
   const body=await request.json();assert.equal(body.Actions,'NCOA');assert.ok(body.Records.length>0&&body.Records.length<=100)
   return Response.json({TransmissionResults:'',TransmissionReference:body.TransmissionReference,TotalRecords:String(body.Records.length),Records:body.Records.map(r=>({...r,State:state(r.State),CountryCode:'US',Results:'AS01',MoveReturnCode:'00',DPVFootNotes:'AABB'}))})
  }
  assert.ok(outbound,`Unexpected outbound host ${u.hostname}`)
  return outbound(request)
 }
}

export async function prepareVerifiedMail(h,{headers={}}={}) {
 assert.equal(h.verifiedMail,true,'Enable the verifiedMail harness option for this fixture')
 const options={headers}
 if(!h.verifiedMailConstituents){
  const ids=[]
  for(let n=1;n<=100;n++){
   const d=await h.command('donor.create',{name:`Postal Fixture ${n}`,email:`synthetic-coffer-${n}@example.test`,addressLine1:`${n} Main Street`,city:'Springfield',region:'IL',postalCode:'62701',country:'US'},options)
   ids.push(d.id)
  }
  h.verifiedMailConstituents=ids
 }
 let state=await h.get('/api/coffer/addresses',options)
 if(!state.connection.enabled){
  await h.command('address.processing',{version:state.connection.version,enabled:'yes',pafReference:'synthetic-coffer-4',reviewed:'yes'},options)
 }
 const queued=await h.command('address.queueNcoa',{},options)
 state=await h.get('/api/coffer/addresses',options)
 const run=state.runs.find(r=>r.id===queued.id)
 assert.ok(run,'Queued pass is visible through the public API')
 // The batch bound derives from the genuine public queue result, not a retry
 // allowance. Any failed/uncertain provider outcome fails this fixture.
 assert.ok(Number.isSafeInteger(run.total)&&run.total>=100,'The pass contains the real eligible list')
 for(let batch=0;batch<Math.ceil(run.total/100);batch++){
  const instant=headers['x-test-now']?Date.parse(headers['x-test-now']):Date.now()
  assert.ok(Number.isFinite(instant))
  const response=await h.request(`/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time=${instant}`,{headers})
  assert.equal(response.status,200,await response.text())
  state=await h.get('/api/coffer/addresses',options)
  const result=state.runs.find(r=>r.id===run.id)
  assert.ok(result,'Queued pass remains visible through the public API')
  assert.ok(['queued','completed'].includes(result.state),JSON.stringify(result))
  if(result.state==='completed'){
   assert.equal(result.processed,result.total)
   return result
  }
 }
 assert.fail('The real scheduled address pass did not complete its queued batches')
}

import assert from 'node:assert/strict'
import {zipSync,strToU8} from 'fflate'
import {run,archive} from './harness.mjs'

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
const csv=(name,rows)=>({name,base64:Buffer.from(rows.map(row=>row.map(c=>'"'+String(c).replaceAll('"','""')+'"').join(',')).join('\r\n')).toString('base64')})
// Synthetic workbook exercises the same XLSX upload reader as owner exports.
function xlsx(name,rows) {
 const sheet=rows.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('')
 const parts={
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Constituents" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
 }
 return {name,base64:Buffer.from(zipSync(Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,strToU8(v)])))).toString('base64')}
}
const move=async(h,input)=>{
 const review=await h.api('/api/coffer/move-in/preview',input)
 assert.equal(review.canApply,true,JSON.stringify(review.diagnostics))
 assert.equal(review.needsAcceptance,false,JSON.stringify(review.unmapped))
 let job=await h.api('/api/coffer/move-in/apply',{id:review.id,fingerprint:review.fingerprint,acknowledged:'no'})
 while(job.state==='applying')job=await h.api('/api/coffer/move-in/continue',{id:review.id})
 assert.equal(job.state,'completed')
 return review
}

export async function solicitationImportJourney() {
 await run(async h=>{
  let serial=400
  const completed=[]
  for(const source of ['lgl','bloomerang','re-nxt'])for(const format of ['csv','xlsx']) {
   const first=`synthetic-coffer-${++serial}`,second=`synthetic-coffer-${++serial}`
   const id=source==='lgl'?'LGL Constituent ID':source==='bloomerang'?'Account Number':'Constituent ID'
   const column=source==='lgl'?'Communication Tags':source==='bloomerang'?'Communication Restrictions':'Solicit Codes'
   const codes={'synthetic-coffer-430':{type:'stop'},'synthetic-coffer-431':{type:'limit',maxAsks:1}}
   const rows=[[id,'Name',column,'Communication Restriction Date'],[first,first,source==='re-nxt'?'synthetic-coffer-430':'Do Not Solicit;Do Not Mail;Do Not Call','2025-09-10'],[second,second,source==='re-nxt'?'synthetic-coffer-431':'Do Not Email','2025-09-11']]
   const file=format==='csv'?csv:xlsx
   const input={source,files:[file(`constituents.${format}`,rows)],...(source==='re-nxt'&&format==='csv'?{solicitCodes:codes}:{})}
   const review=await move(h,input)
   completed.push({review,input,first,second,source})
   const all=(await h.get('/api/coffer/donors')).donors
   const a=all.find(d=>d.name===first),b=all.find(d=>d.name===second)
   assert.ok(a&&b)
   const history=await h.get('/api/coffer/donors/'+a.id)
   assert.equal(history.solicitation.type,'stop')
   assert.equal(history.solicitation.version,1)
   assert.equal(history.solicitation.source,'import')
   assert.equal(history.solicitation.source_on,'2025-09-10')
   assert.equal(history.solicitation.source_ref,`${source}:${first}`)
   assert.ok(history.solicitation.recorded_at)
   if(source!=='re-nxt')for(const channel of ['mail','phone']) {
    const consent=history.consents.find(c=>c.channel===channel)
    assert.equal(consent.status,'withdrawn');assert.equal(consent.captured_on,'2025-09-10')
   }
   else {
    const limited=await h.get('/api/coffer/donors/'+b.id)
    assert.equal(limited.solicitation.type,'limit');assert.equal(limited.solicitation.max_asks,1)
   }
   const journal=await h.get('/api/coffer/move-in/journal?id='+review.id)
   assert.ok(journal.job.check_report.rows.filter(r=>r.scope==='restriction').every(r=>r.matches))
   assert.equal(journal.job.check_report.matches,true)
   assert.ok(history.events.some(e=>e.action==='solicitation.import'))
   // The identical upload does not create another restriction or history version.
   await move(h,input)
   assert.equal((await h.get('/api/coffer/donors/'+a.id)).solicitation.version,1)
  }
  const snapshot=await archive(h)
  const histories=snapshot.filter(r=>r.kind==='part').flatMap(r=>r.items).filter(r=>r.kind==='row'&&r.table==='cf_solicitation_history').map(r=>r.row)
  assert.ok(histories.length>=6,'Versioned imported answers survive the public archive door')
  const untouched=completed.find(x=>x.source==='bloomerang')
  await h.api('/api/coffer/move-in/undo',{id:untouched.review.id})
  assert.ok(!(await h.get('/api/coffer/donors')).donors.some(d=>d.name===untouched.first),'Undo removes the unchanged imported restriction and channel withdrawals with its donor')
  const protectedImport=completed[0]
  const donor=(await h.get('/api/coffer/donors')).donors.find(d=>d.name===protectedImport.first)
  await h.command('solicitation.set',{donorId:donor.id,version:1,type:'limit',maxAsks:2,startsOn:'2026-01-01'})
  await h.api('/api/coffer/move-in/undo',{id:protectedImport.review.id},{status:409})
  await move(h,protectedImport.input)
  assert.equal((await h.get('/api/coffer/donors/'+donor.id)).solicitation.max_asks,2,'Repeated history cannot overwrite a staff choice')
  const unknown={source:'re-nxt',files:[csv('constituents.csv',[['Constituent ID','Name','Solicit Codes'],['synthetic-coffer-450','synthetic-coffer-450','synthetic-coffer-451']])]}
  const blocked=await h.api('/api/coffer/move-in/preview',unknown)
  assert.equal(blocked.canApply,false);assert.ok(blocked.diagnostics.some(d=>d.code==='SOLICITATION_CODE'))
 })
}

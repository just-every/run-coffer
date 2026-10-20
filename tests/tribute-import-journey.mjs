import assert from 'node:assert/strict'

const endpoint='/api/coffer/move-in'
const csv=(name,rows)=>({name,base64:Buffer.from(rows.map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n')+'\r\n').toString('base64')})
const post=(h,action,input,options)=>h.api(`${endpoint}/${action}`,input,options)
async function apply(h,p) {
 let job=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no'})
 while(job.state==='applying')job=await post(h,'continue',{id:p.id})
 assert.equal(job.state,'completed')
}

/** Public upload/review/apply/donor-history/undo journey; called by the integration suite. */
export async function tributeImportJourney(h) {
 for(const source of ['bloomerang','lgl','re-nxt']) {
  const [donorColumn,giftColumn,giftType,head,values]=({
   bloomerang:['Account Number','Transaction Number','Donation',['Tribute','Tribute Type','Has Tribute'],['Morgan Ellis','In Memory Of','Yes']],
   lgl:['LGL Constituent ID','LGL Gift ID','Gift',['Tribute Hon./Mem. Name','Tribute Dedication','Tribute Name','Tribute Recipient Name','Tribute Recipient Email','Tribute Recipient Address'],['Morgan Ellis','In Memory Of','Memorial - General','Jamie Ellis','jamie@example.org','12 Garden Street']],
   're-nxt':['Constituent ID','Gift ID','Cash',['Tribute Honoree','Tribute Type'],['Morgan Ellis','memory']],
  })[source]
  const input=(tributeValues=values)=>({source,noGoodsOrServices:true,files:[
   csv('constituents.csv',[[donorColumn,'Name'],['TR_PERSON','Tribute importer']]),
   csv('gifts.csv',[[giftColumn,donorColumn,'Gift Type','Gift Date','Amount','Payment Method',...head],['TR_GIFT','TR_PERSON',giftType,'2026-10-01','125','Check',...tributeValues]]),
  ]})
  const kindIndex=1
  for(const bad of [values.map((v,i)=>i===kindIndex?'Celebration':v),values.map((v,i)=>i===0?'':v)]) {
   const p=await post(h,'preview',input(bad))
   assert.equal(p.canApply,false)
   assert.ok(p.diagnostics.some(d=>d.severity==='error'&&d.file==='gifts.csv'&&d.row===2&&['TRIBUTE_TYPE','TRIBUTE_HONOREE'].includes(d.code)))
   await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acceptedReason:'Do not infer a tribute person or kind'},{status:409})
  }
  const ambiguous=input()
  ambiguous.files[1]=csv('gifts.csv',[[giftColumn,donorColumn,'Gift Type','Gift Date','Amount','Payment Method',...head,head[0]],['TR_GIFT','TR_PERSON',giftType,'2026-10-01','125','Check',...values,'A different honoree']])
  const ambiguity=await post(h,'preview',ambiguous)
  assert.equal(ambiguity.canApply,false,'Two columns naming different honorees cannot silently choose one')
  assert.ok(ambiguity.diagnostics.some(d=>d.code==='DUPLICATE_COLUMN'&&d.severity==='error'))
  const p=await post(h,'preview',input())
  assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));assert.equal(p.needsAcceptance,false,JSON.stringify(p.unmapped))
  assert.equal(p.gifts[0].tribute.honoree,'Morgan Ellis')
  if(source==='lgl')assert.equal(p.gifts[0].tribute.sourceGroup,'Memorial - General')
  await apply(h,p)
  const donor=(await h.get('/api/coffer/donors')).donors.find(d=>d.name==='Tribute importer')
  const history=await h.get(`/api/coffer/donors/${donor.id}`),tribute=history.giftDepth.tributes[0]
  assert.equal(history.totals.lifetimeCents,12500)
  assert.equal(tribute.honoree,'Morgan Ellis');assert.equal(tribute.kind,'memory')
  assert.equal(tribute.amount_permission,0,'Source tribute records never grant permission to disclose the gift amount')
  if(source==='lgl') {
   assert.equal(tribute.source_group,'Memorial - General')
   assert.equal(tribute.notified_name,'Jamie Ellis');assert.equal(tribute.notified_email,'jamie@example.org');assert.equal(tribute.notified_address,'12 Garden Street')
  } else assert.equal(tribute.notified_name,null,'Missing source notification contacts stay absent')
  const repeat=await post(h,'preview',input())
  assert.equal((await post(h,'apply',{id:repeat.id,fingerprint:repeat.fingerprint})).unchanged,true)
  assert.equal((await h.get(`/api/coffer/donors/${donor.id}`)).giftDepth.tributes.length,1)
  const changed=await post(h,'preview',input(values.map((v,i)=>i===0?'Another person':v)))
  assert.equal(changed.canApply,false,'A later source file cannot overwrite imported tribute facts')
  assert.equal((await h.get(`/api/coffer/donors/${donor.id}`)).giftDepth.tributes[0].honoree,'Morgan Ellis')
  if(source==='lgl') {
   const contactChange=await post(h,'preview',input(values.map((v,i)=>i===4?'different@example.org':v)))
   assert.equal(contactChange.canApply,false,'Source hashes include tribute contact metadata')
  }
  const records=(await h.get(`${endpoint}/journal?id=${p.id}`)).records
  assert.equal(records.find(r=>r.kind==='tribute').added,1)
  await post(h,'undo',{id:p.id})
  assert.equal((await h.get('/api/coffer/donors')).total,0,'Undo deletes owned tribute rows before gifts and donors')
 }
}

import assert from 'node:assert/strict'
import {run,reviewed,settings} from './harness.mjs'

const endpoint='/api/coffer/move-in'
const day='2026-10-02'
const csv=(name,rows)=>({name,base64:Buffer.from(rows.map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',')).join('\r\n')+'\r\n').toString('base64')})
const post=(h,action,input,options)=>h.api(`${endpoint}/${action}`,input,options)
async function apply(h,p,extra={}) {
 let job=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no',...(p.needsAcceptance?{acceptedReason:'Reviewed the source report columns.'}:{}),...extra})
 while(job.state==='applying')job=await post(h,'continue',{id:p.id})
 assert.equal(job.state,'completed')
 return job
}
const read=async(h,id)=>(await h.get(`/api/coffer/donors/${id}`))

/** Accepted historical source facts move only through review; source IDs never
 * double as native interaction IDs or prove a Coffer message was sent. */
export async function importAcknowledgmentJourney() {
 for(const source of ['lgl','bloomerang','re-nxt'])await run(async h=>{
  await reviewed(h)
  const [donorColumn,giftColumn,giftType,sourceName]=({
   lgl:['LGL Constituent ID','LGL Gift ID','Gift','Little Green Light'],
   bloomerang:['Account Number','Transaction Number','Donation','Bloomerang'],
   're-nxt':['Constituent ID','Gift ID','Cash',"Raiser's Edge NXT"],
  })[source]
  const statusColumn=source==='bloomerang'?'Acknowledged?':'Acknowledgment Status'
  const yes=source==='bloomerang'?'Yes':'acknowledged',no=source==='bloomerang'?'No':'not acknowledged'
  const extraColumn=source==='lgl'?'Acknowledgment Template':source==='re-nxt'?'Linked Acknowledgment Letter':'Acknowledgment Reference'
  const headers=[giftColumn,donorColumn,'Gift Type','Gift Date','Amount','Payment Method',statusColumn,'Acknowledgment Date','Acknowledgment Method','Acknowledgment Interaction ID','Do Not Acknowledge','Acknowledgment Reason',extraColumn]
  const giftRow=(id,status,date='',method='',interaction='',optOut='',reason='',reference='')=>[id,'ACK_PERSON',giftType,'2026-10-01','500','Check',status,date,method,interaction,optOut,reason,reference]
  const rows=[giftRow('ACK_LINK',yes,day,'Email','ACK_EMAIL'),giftRow('ACK_WAIT',no),giftRow('ACK_STOP',yes,'','','','Yes','Source payroll exclusion'),giftRow('ACK_HISTORY',yes),giftRow('ACK_LETTER',source==='bloomerang'?yes:no,source==='lgl'?day:'',source==='bloomerang'?'letter':'','','','','Historical letter 12')]
  const people=csv('constituents.csv',[[donorColumn,'Name'],['ACK_PERSON','Source acknowledgment donor'],['ACK_OTHER','Other source person']])
  const noteHeaders=['Interaction ID',donorColumn,'Interaction Date','Interaction Type','Note']
  const noteRows=[['ACK_EMAIL','ACK_PERSON',day,'email','Thanked this donor in the incumbent CRM.'],['ACK_ALTERNATE','ACK_PERSON',day,'email','A second recorded thank-you.']]
  const input=({giftRows=rows,interactions=noteRows,notes=true,reverse=false}={})=>({source,noGoodsOrServices:true,files:[people,csv('gifts.csv',[headers,...(reverse?[...giftRows].reverse():giftRows)]),...(notes?[csv('interactions.csv',[noteHeaders,...interactions])]:[])]})
  for(const interactions of [noteRows.map((r,i)=>i? r:[r[0],'ACK_OTHER',...r.slice(2)]),noteRows.map((r,i)=>i?r:[r[0],r[1],'2026-10-03',...r.slice(3)]),noteRows.map((r,i)=>i?r:[...r.slice(0,3),'call',r[4]]),[]]) {
   const p=await post(h,'preview',input({interactions}))
   assert.equal(p.canApply,false)
   assert.ok(p.diagnostics.some(d=>d.code==='ACKNOWLEDGMENT_LINK'&&d.file==='gifts.csv'&&d.row===2))
   await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acceptedReason:'A link must still match its source evidence.'},{status:409})
  }
  for (const [index,value,code] of [[8,'Pigeon post','ACKNOWLEDGMENT_METHOD'],[6,'do not acknowledge','ACKNOWLEDGMENT_LINK']]) {
   const invalid=await post(h,'preview',input({giftRows:rows.map((r,i)=>i?r:r.map((v,j)=>j===index?value:v))}))
   assert.equal(invalid.canApply,false);assert.ok(invalid.diagnostics.some(d=>d.code===code&&d.row===2))
  }
  const p=await post(h,'preview',input())
  assert.equal(p.canApply,true,JSON.stringify(p.diagnostics))
  assert.equal(p.gifts.find(g=>g.externalId==='ACK_LINK').acknowledgment.interactionExternalId,'ACK_EMAIL')
  assert.equal(p.gifts.find(g=>g.externalId==='ACK_LINK').acknowledgment.method,'email')
  assert.equal((await h.get('/api/coffer/donors')).total,0,'Preview records a review without importing donor or gift data')
  await post(h,'apply',{id:p.id,fingerprint:'stale-review'},{status:409})
  assert.equal((await h.get('/api/coffer/donors')).total,0)
  await apply(h,p)
  const donor=(await h.get('/api/coffer/donors')).donors.find(d=>d.name==='Source acknowledgment donor')
  const history=await read(h,donor.id)
  const gift=id=>history.gifts.find(g=>g.reference===`${source}:${id}`)
  const linked=gift('ACK_LINK'),ack=linked.acknowledgment
  assert.equal(ack.status,'acknowledged');assert.equal(ack.acknowledged_on,day);assert.equal(ack.method,'email');assert.equal(ack.source,sourceName)
  assert.equal(ack.link.kind,'interaction');assert.equal(ack.link.id,history.depth.interactions.find(i=>i.notes===noteRows[0][4]).id)
  assert.notEqual(ack.link.id,'ACK_EMAIL');assert.equal(ack.link.content,noteRows[0][4]);assert.ok(ack.source_reference.includes('ACK_EMAIL'))
  assert.equal(ack.letter_id,null);assert.equal(ack.communication_id,null)
  assert.equal(gift('ACK_WAIT').acknowledgment.status,'not acknowledged')
  assert.equal(gift('ACK_STOP').acknowledgment.status,'do not acknowledge');assert.equal(gift('ACK_STOP').acknowledgment.reason,'Source payroll exclusion')
  const unknown=gift('ACK_HISTORY').acknowledgment
  assert.equal(unknown.status,'acknowledged');assert.equal(unknown.acknowledged_on,null);assert.equal(unknown.method,null);assert.equal(unknown.link,null)
  const letter=gift('ACK_LETTER').acknowledgment
  assert.equal(letter.status,'acknowledged');assert.equal(letter.method,source==='re-nxt'?null:'letter');assert.equal(letter.source_reference,'Historical letter 12');assert.equal(letter.link,null)
  const due=(await h.get('/api/coffer/letters')).due
  assert.deepEqual(due.map(g=>g.id),[gift('ACK_WAIT').id])
  const audit=await h.get('/api/coffer/audit?action=gift.acknowledgment')
  const entry=audit.rows.find(e=>e.subject_id===linked.id)
  assert.equal(entry.actor_name,'Morgan Lee');assert.equal(entry.actor_role,'owner');assert.equal(JSON.parse(entry.detail).interactionId,ack.link.id)
  assert.ok(!JSON.stringify(audit).includes(noteRows[0][4]));assert.ok(!JSON.stringify(audit).includes('Source payroll exclusion'))
  assert.equal((await apply(h,await post(h,'preview',input()))).unchanged,true)
  const changed=await post(h,'preview',input({giftRows:rows.map((r,i)=>i?r:[...r.slice(0,9),'ACK_ALTERNATE',...r.slice(10)])}))
  assert.equal(changed.canApply,false,'A later source file cannot change imported acknowledgment custody')
  const replay=await post(h,'preview',input({reverse:true}))
  assert.equal(replay.canApply,true,JSON.stringify(replay.diagnostics));await apply(h,replay)
  assert.deepEqual((await read(h,donor.id)).gifts.find(g=>g.id===linked.id).acknowledgment,ack)
  await post(h,'undo',{id:replay.id});await post(h,'undo',{id:p.id})
  assert.equal((await h.get('/api/coffer/donors')).total,0,'Undo removes owned acknowledgment links before interactions and gifts')

  // A later human choice survives replay and blocks removal of its owned history.
  const again=await post(h,'preview',input());await apply(h,again)
  const reimported=await read(h,donor.id),alternate=reimported.depth.interactions.find(i=>i.notes===noteRows[1][4])
  await h.command('gift.acknowledge',{giftId:linked.id,version:1,acknowledgedOn:day,method:'email',interactionId:alternate.id})
  const later=await post(h,'preview',input({reverse:true}));assert.equal(later.canApply,true,JSON.stringify(later.diagnostics));await apply(h,later)
  const human=(await read(h,donor.id)).gifts.find(g=>g.id===linked.id).acknowledgment
  assert.equal(human.link.id,alternate.id);assert.equal(human.version,2)
  await post(h,'undo',{id:later.id});await post(h,'undo',{id:again.id},{status:409})

  // A later move-in can link an earlier imported interaction without reuploading it.
  const earlier=await post(h,'preview',{source,files:[people,csv('earlier-interaction.csv',[noteHeaders,['ACK_EARLIER','ACK_PERSON',day,'email','Earlier imported interaction.']])]})
  assert.equal(earlier.canApply,true,JSON.stringify(earlier.diagnostics));await apply(h,earlier)
  const subsequent=await post(h,'preview',input({giftRows:[giftRow('ACK_LATER',yes,day,'email','ACK_EARLIER')],notes:false}))
  assert.equal(subsequent.canApply,true,JSON.stringify(subsequent.diagnostics));await apply(h,subsequent)
  assert.equal((await read(h,donor.id)).gifts.find(g=>g.reference===`${source}:ACK_LATER`).acknowledgment.link.content,'Earlier imported interaction.')
  await post(h,'undo',{id:earlier.id},{status:409})
  await post(h,'undo',{id:subsequent.id});await post(h,'undo',{id:earlier.id})
  if(source==='lgl') {
   const historical=await post(h,'preview',{source,noGoodsOrServices:true,files:[
    csv('cutoff-constituents.csv',[[donorColumn,'Name'],['ACK_CUTOFF','Reviewed cutoff donor']]),
    csv('cutoff-gifts.csv',[[giftColumn,donorColumn,'Gift Type','Gift Date','Amount','Payment Method'],['ACK_CUTOFF_GIFT','ACK_CUTOFF',giftType,'2026-10-01','500','Check']]),
   ]})
   assert.equal(historical.canApply,true,JSON.stringify(historical.diagnostics))
   await apply(h,historical,{acknowledged:'yes',acknowledgedBefore:day})
   const historicalDonor=(await h.get('/api/coffer/donors')).donors.find(d=>d.name==='Reviewed cutoff donor')
   const before=(await read(h,historicalDonor.id)).gifts[0].acknowledgment
   assert.equal(before.status,'acknowledged');assert.equal(before.acknowledged_on,null);assert.equal(before.method,null);assert.equal(before.link,null)
   for(const [status,expected] of [['not acknowledged',[]],['acknowledged',[historicalDonor.id]]]) {
    const list=await h.command('list.save',{name:'Reviewed cutoff '+status,filters:{q:'Reviewed cutoff donor',ackStatus:status,giftOver:'250'}})
    assert.deepEqual((await h.get(`/api/coffer/lists/${list.id}/members`)).donorIds,expected)
   }
   assert.deepEqual((await read(h,historicalDonor.id)).gifts[0].acknowledgment,before,'A saved status filter preserves the reviewed historical cutoff projection')
   await post(h,'undo',{id:historical.id})
  }

  await softCreditAcknowledgments(h,source)
 })
}

/** Standalone and inline source credits carry their own history. The financial
 * gift and the credited constituent's thank-you never set each other's state. */
async function softCreditAcknowledgments(h,source) {
 const [donorColumn,giftColumn,giftType]=({lgl:['LGL Constituent ID','LGL Gift ID','Gift'],bloomerang:['Account Number','Transaction Number','Donation'],'re-nxt':['Constituent ID','Gift ID','Cash']})[source]
 const statusColumn=source==='bloomerang'?'Acknowledged?':'Acknowledgment Status',yes=source==='bloomerang'?'Yes':'acknowledged',no=source==='bloomerang'?'No':'not acknowledged'
 const people=csv('credit-constituents.csv',[[donorColumn,'Name'],...['HARD','LINK','WAIT','STOP','HISTORY','INLINE'].map(id=>['SC_'+id,'Source credit '+id])])
 const giftHeaders=[giftColumn,donorColumn,'Gift Type','Gift Date','Amount','Payment Method',statusColumn,'Acknowledgment Date','Acknowledgment Method','Soft Credit ID','Soft Credit Constituent ID','Soft Credit Amount','Soft Credit '+statusColumn,'Soft Credit Acknowledgment Date','Soft Credit Acknowledgment Method','Soft Credit Acknowledgment Interaction ID']
 const giftRows=['LINK','WAIT','STOP','HISTORY','INLINE'].map(id=>['SC_GIFT_'+id,'SC_HARD',giftType,'2026-10-01','500','Check',['WAIT','STOP','INLINE'].includes(id)?yes:no,['WAIT','STOP','INLINE'].includes(id)?day:'',['WAIT','STOP','INLINE'].includes(id)?'Email':'',...(id==='INLINE'?['SC_INLINE','SC_INLINE','500',yes,day,'Meeting','SC_MEETING']:[])])
 const headers=['Soft Credit ID',donorColumn,'Gift Type','Original Gift ID','Amount',statusColumn,'Acknowledgment Date','Acknowledgment Method','Acknowledgment Interaction ID','Acknowledgment Reason']
 const creditRows=[['SC_LINK','SC_LINK','Soft Credit','SC_GIFT_LINK','500',yes,day,'Phone','SC_CALL',''],['SC_WAIT','SC_WAIT','Soft Credit','SC_GIFT_WAIT','500',no,'','','',''],['SC_STOP','SC_STOP','Soft Credit','SC_GIFT_STOP','500','do not acknowledge','','','','Source credit restriction'],['SC_HISTORY','SC_HISTORY','Soft Credit','SC_GIFT_HISTORY','500',yes,'','','','']]
 const noteHeaders=['Interaction ID',donorColumn,'Interaction Date','Interaction Type','Note']
 const notes=[['SC_CALL','SC_LINK',day,'call','Source credited donor thank-you.'],['SC_ALT','SC_LINK',day,'call','Another credited donor conversation.'],['SC_MEETING','SC_INLINE',day,'meeting','Source advisor meeting thank-you.']]
 const input=({credits=creditRows,interactions=notes,reverse=false}={})=>({source,noGoodsOrServices:true,files:[people,csv('credit-gifts.csv',[giftHeaders,...giftRows]),csv('soft-credits.csv',[headers,...(reverse?[...credits].reverse():credits)]),csv('credit-interactions.csv',[noteHeaders,...interactions])]})
 const count=(await h.get('/api/coffer/donors')).total
 for(const interactions of [notes.map((r,i)=>i?r:[r[0],'SC_HARD',...r.slice(2)]),notes.map((r,i)=>i?r:[r[0],r[1],'2026-10-03',...r.slice(3)]),notes.map((r,i)=>i?r:[...r.slice(0,3),'email',r[4]])]) {
  const invalid=await post(h,'preview',input({interactions}))
  assert.equal(invalid.canApply,false);assert.ok(invalid.diagnostics.some(d=>d.code==='ACKNOWLEDGMENT_LINK'&&d.file==='soft-credits.csv'&&d.row===2))
  await post(h,'apply',{id:invalid.id,fingerprint:invalid.fingerprint,acceptedReason:'Evidence must match the credited constituent.'},{status:409})
 }
 const badMethod=await post(h,'preview',input({credits:creditRows.map((r,i)=>i?r:r.map((v,j)=>j===7?'Pigeon post':v))}))
 assert.equal(badMethod.canApply,false);assert.ok(badMethod.diagnostics.some(d=>d.code==='ACKNOWLEDGMENT_METHOD'&&d.file==='soft-credits.csv'))
 const p=await post(h,'preview',input());assert.equal(p.canApply,true,JSON.stringify(p.diagnostics))
 assert.equal(p.softCredits.find(s=>s.externalId==='SC_LINK').acknowledgment.method,'phone call')
 assert.equal(p.softCredits.find(s=>s.externalId==='SC_INLINE').acknowledgment.method,'in person')
 assert.equal((await h.get('/api/coffer/donors')).total,count,'Source credit preview changes no domain records')
 await post(h,'apply',{id:p.id,fingerprint:'stale-soft-credit-review'},{status:409})
 await apply(h,p)
 const donors=(await h.get('/api/coffer/donors')).donors,person=id=>donors.find(d=>d.name==='Source credit '+id)
 const hard=person('HARD'),readCredit=async id=>(await read(h,person(id).id)).giftDepth.creditedGifts[0]
 const linked=await readCredit('LINK'),a=linked.acknowledgment,inline=await readCredit('INLINE')
 assert.equal(a.status,'acknowledged');assert.equal(a.method,'phone call');assert.equal(a.acknowledgedOn,day);assert.equal(a.link.kind,'interaction');assert.equal(a.link.content,notes[0][4]);assert.ok(a.sourceReference.includes('SC_CALL'))
 assert.equal(a.link.id,(await read(h,person('LINK').id)).depth.interactions.find(i=>i.notes===notes[0][4]).id)
 assert.equal(inline.acknowledgment.method,'in person');assert.equal(inline.acknowledgment.link.content,notes[2][4])
 assert.equal((await readCredit('WAIT')).acknowledgment.status,'not acknowledged');assert.equal((await readCredit('STOP')).acknowledgment.status,'do not acknowledge')
 assert.equal((await readCredit('STOP')).acknowledgment.reason,'Source credit restriction')
 const historical=(await readCredit('HISTORY')).acknowledgment
 assert.equal(historical.status,'acknowledged');assert.equal(historical.acknowledgedOn,null);assert.equal(historical.method,null);assert.equal(historical.link,null)
 await h.command('softCredit.acknowledge',{softCreditId:(await readCredit('HISTORY')).id,version:1},{status:400})
 const hardHistory=await read(h,hard.id)
 assert.equal(hardHistory.gifts.find(g=>g.reference===`${source}:SC_GIFT_LINK`).acknowledgment.status,'not acknowledged')
 assert.equal(hardHistory.gifts.find(g=>g.reference===`${source}:SC_GIFT_WAIT`).acknowledgment.status,'acknowledged')
 await h.command('settings.update',{...settings,version:(await h.get('/api/coffer/settings')).version,thankSoftCredits:'1'})
 const queue=(await h.get('/api/coffer/letters')).softCredits
 assert.ok(queue.some(s=>s.donor_id===person('WAIT').id));assert.ok(!queue.some(s=>['LINK','STOP','HISTORY','INLINE'].some(id=>s.donor_id===person(id).id)))
 const audit=await h.get('/api/coffer/audit?action=softCredit.acknowledgment.import')
 assert.ok(audit.rows.some(e=>e.subject_id===linked.id&&JSON.parse(e.detail).interactionId===a.link.id&&e.actor_role==='owner'))
 assert.ok(!JSON.stringify(audit).includes(notes[0][4]));assert.ok(!JSON.stringify(audit).includes('Source credit restriction'))
 const repeat=await post(h,'preview',input({reverse:true}));assert.equal(repeat.canApply,true,JSON.stringify(repeat.diagnostics));await apply(h,repeat)
 assert.deepEqual((await readCredit('LINK')).acknowledgment,a)
 await post(h,'undo',{id:repeat.id});await post(h,'undo',{id:p.id})
 assert.equal((await h.get('/api/coffer/donors')).total,count,'Undo removes acknowledgment records before source credits and interactions')
 const again=await post(h,'preview',input());await apply(h,again)
 const current=await read(h,person('LINK').id),alternate=current.depth.interactions.find(i=>i.notes===notes[1][4])
 await h.command('softCredit.acknowledge',{softCreditId:linked.id,version:1,acknowledgedOn:day,method:'phone call',interactionId:alternate.id})
 const manual=(await readCredit('LINK')).acknowledgment
 assert.equal(manual.version,2);assert.equal(manual.source,'Coffer');assert.equal(manual.sourceReference,null)
 const later=await post(h,'preview',input({reverse:true}));assert.equal(later.canApply,true,JSON.stringify(later.diagnostics));await apply(h,later)
 assert.deepEqual((await readCredit('LINK')).acknowledgment,manual)
 await post(h,'undo',{id:later.id});await post(h,'undo',{id:again.id},{status:409})
 const beforeErasure=(await read(h,hard.id)).gifts.map(g=>[g.id,g.amount_cents,g.acknowledgment])
 await h.command('donor.erase',{donorId:person('INLINE').id,confirm:'ERASE'})
 const afterErasure=await read(h,hard.id),erasedHistory=afterErasure.giftDepth
 assert.deepEqual(afterErasure.gifts.map(g=>[g.id,g.amount_cents,g.acknowledgment]),beforeErasure)
 assert.equal(afterErasure.gifts.length,5,'Erasing a credited constituent preserves every original hard-credit gift')
 assert.ok(!erasedHistory.softCredits.some(s=>s.id===inline.id));assert.ok(!JSON.stringify(erasedHistory).includes('SC_MEETING'))
 const journal=await h.get(`${endpoint}/journal?id=${again.id}`)
 assert.equal(journal.job.redacted,1);await post(h,'undo',{id:again.id},{status:409})
}

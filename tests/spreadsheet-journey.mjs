import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {spreadsheetBrowser,spreadsheetUndoBrowser} from './spreadsheet-browser.mjs'
const key=n=>'synthetic-coffer-'+n
const email=n=>[key(n),'example.test'].join('@')
const post=(h,action,body,options)=>h.api('/api/coffer/move-in/'+action,body,options)
const apply=async(h,p)=>{let j=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no'});while(j.state==='applying')j=await post(h,'continue',{id:p.id});assert.equal(j.state,'completed');return j}
const rows=(columns,records)=>[Object.keys(columns),...records.map(r=>Object.keys(columns).map(k=>r[columns[k]]??''))]

export function spreadsheetFixture(existing) {
 const people={PersonKey:'donorId',Person:'name',Title:'prefix',First:'firstName',Middle:'middleName',Last:'lastName',Suffix:'suffix',Called:'nickname',Greeting:'informalName',Formal:'formalName',Envelope:'envelopeName',Email:'email',Phone:'phone',Street:'addressLine1',City:'city',State:'region',ZIP:'postalCode',FamilyKey:'householdKey',Family:'householdName',Head:'householdHead',Addressee:'householdAddressee',FamilyGreeting:'householdInformal',Status:'constituentStatus',Reason:'statusReason',EmailChoice:'emailPreference',MailChoice:'mailPreference',TextChoice:'smsPreference',CallChoice:'phonePreference',ChoiceDate:'preferenceDate',Restrictions:'communicationRestrictions',RestrictionDate:'restrictionDate'}
 const gifts={GiftKey:'giftId',PersonKey:'donorId',Received:'date',Dollars:'amount',Designation:'fund',PaidBy:'method',Thanked:'acknowledgmentStatus',ThankedOn:'acknowledgmentDate',ThankedBy:'acknowledgmentMethod',ThankYouLink:'acknowledgmentInteraction',Benefit:'goodsAmount',BenefitDescription:'goodsDescription',Dedication:'tributeType',Honoree:'tributeHonoree',SourceGroup:'tributeGroup',FamilyContact:'tributeNotifiedName',FamilyStreet:'tributeNotifiedAddress',CreditPerson:'softDonor',CreditKey:'softId',CreditAmount:'softAmount',CreditThanked:'softAcknowledgmentStatus',CreditOn:'softAcknowledgmentDate',CreditBy:'softAcknowledgmentMethod',CreditLink:'softAcknowledgmentInteraction'}
 const notes={ConversationKey:'noteId',PersonKey:'donorId',Conversation:'note',ConversationOn:'noteDate',ConversationKind:'noteType'}
 const info=(n,name,extra={})=>({donorId:key(n),name,email:email(n),phone:'+12025550180',addressLine1:'18 Reading Street',city:'Madison',region:'WI',postalCode:'53703',emailPreference:'unknown',mailPreference:'no',smsPreference:'unknown',phonePreference:'no',preferenceDate:'2026-09-01',...extra})
 const tables=[['people',rows(people,[
  info(6001,'Source Ava',{email:existing.email}),
  info(6002,'Blake Chen',{firstName:'Blake',lastName:'Chen',prefix:'Dr.',middleName:'Lee',suffix:'III',nickname:'Bee',informalName:'Dear Bee',formalName:'Doctor Chen',envelopeName:'Doctor Blake Lee Chen III',email:existing.email,householdKey:key(6020),householdName:'Chen family',householdHead:'no',householdAddressee:'The Chen Readers',householdInformal:'Blake and Cleo',communicationRestrictions:'No fundraising',restrictionDate:'2026-09-01'}),
  info(6003,'Cleo Chen',{firstName:'Cleo',lastName:'Chen',householdKey:key(6020),householdName:'Chen family',householdHead:'yes',householdAddressee:'The Chen Readers',householdInformal:'Blake and Cleo',emailPreference:'yes',mailPreference:'yes',smsPreference:'no',phonePreference:'no'}),
  info(6004,'Dana Reed',{firstName:'Dana',lastName:'Reed',householdKey:key(6021),householdName:'Reed family',constituentStatus:'inactive',statusReason:'Source requested a pause'}),
 ])],['donations',rows(gifts,[
  {giftId:key(6011),donorId:key(6001),date:'2026-09-04',amount:'300',fund:'Books',method:'Paper',acknowledgmentStatus:'acknowledged',acknowledgmentDate:'2026-09-05',acknowledgmentMethod:'email',acknowledgmentInteraction:key(6031),goodsAmount:'0',tributeType:'memory',tributeHonoree:'Jordan Reed',tributeGroup:key(6041),tributeNotifiedName:'River Reed',tributeNotifiedAddress:'19 Reading Street',softDonor:key(6002),softId:key(6051),softAmount:'100',softAcknowledgmentStatus:'acknowledged',softAcknowledgmentDate:'2026-09-06',softAcknowledgmentMethod:'phone call',softAcknowledgmentInteraction:key(6032)},
  {giftId:key(6012),donorId:key(6002),date:'2026-09-07',amount:'450',fund:'Lessons',method:'Electronic',acknowledgmentStatus:'not acknowledged',goodsAmount:'25',goodsDescription:'Dinner',tributeType:'memory',tributeHonoree:'Jordan Reed',tributeGroup:key(6041)},
  {giftId:key(6013),donorId:key(6003),date:'2026-09-08',amount:'275',fund:'Books',method:'Paper',acknowledgmentStatus:'do not acknowledge',goodsAmount:'0'},
  {giftId:key(6014),donorId:key(6003),date:'2026-09-09',amount:'325',fund:'Lessons',method:'Paper',acknowledgmentStatus:'not acknowledged'},
 ])],['conversations',rows(notes,[{noteId:key(6031),donorId:key(6001),note:'Source gift thank-you',noteDate:'2026-09-05',noteType:'email'},{noteId:key(6032),donorId:key(6002),note:'Independent credit thank-you',noteDate:'2026-09-06',noteType:'call'}])]]
 // Custom source values use the same typed validator as native gift entry.
 tables[1][1][0].push('GiftCategory');for(const row of tables[1][1].slice(1))row.push('Books')
 const columns=[...new Map(Object.entries({...people,...gifts,...notes}).map(([column,field])=>[column,{column,field}])).values()]
 return {tables,input:{source:'spreadsheet',spreadsheet:{name:'Community gifts',recordType:'gift',columns,translations:{fund:{Books:'Library',Lessons:'Tutoring'},method:{Paper:'check',Electronic:'bank transfer'}},donorMatches:{[key(6001)]:{id:existing.id,version:existing.version}}},customFields:[{source:'spreadsheet',column:'GiftCategory',key:'source_category',label:'Source category',kind:'gift',type:'text',entry:'pick-one',choices:['Books','Music']}],solicitCodes:{'No fundraising':{type:'stop'}}}}
}

export async function spreadsheetJourney(makeFiles) {
 for(const format of ['csv','xlsx'])await run(async h=>{
  await reviewed(h)
  const created=await donor(h,'Ava Native',{email:email(6000)}),existing=(await h.get('/api/coffer/donors/'+created.id)).donor
  const fixture=spreadsheetFixture(existing),input={...fixture.input,files:await makeFiles(fixture.tables,format)}
  let preview=await post(h,'preview',input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics));assert.equal(preview.needsAcceptance,false,JSON.stringify(preview.unmapped))
  assert.equal(preview.sourceTotals.amountCents,135000);assert.equal(preview.counts.householdsWithHead,1);assert.equal(preview.counts.householdsWithoutHead,1)
  assert.ok(preview.diagnostics.some(d=>d.code==='MATCHED_DONOR'))
  const unsafe=structuredClone(input);unsafe.spreadsheet.donorMatches[key(6001)].version++
  assert.equal((await post(h,'preview',unsafe)).canApply,false,'Stale explicit matching cannot allocate gifts')
  const invalid=structuredClone(fixture.tables);invalid[1][1][1][invalid[1][1][0].indexOf('GiftCategory')]='Outside list'
  assert.equal((await post(h,'preview',{...input,files:await makeFiles(invalid,format)})).canApply,false,'Invalid custom choices require correction')
  const wrongLink=structuredClone(fixture.tables);wrongLink[1][1][1][wrongLink[1][1][0].indexOf('CreditLink')]=key(6031)
  assert.equal((await post(h,'preview',{...input,files:await makeFiles(wrongLink,format)})).canApply,false,'Soft-credit evidence must match the credited person')
  const member=await h.person(email(6090)),admin=await h.person(email(6091),'admin')
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await post(h,'preview',input,{as:admin.cookie,status:401})
  await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{as:admin.cookie,status:401})
  await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{as:member.cookie,status:403})
  if(format==='csv'){preview=await spreadsheetBrowser(h,input,preview);Object.assign(input,preview.mappedInput)}
  else await apply(h,preview)
  const people=await Promise.all((await h.get('/api/coffer/donors')).donors.map(async d=>(await h.get('/api/coffer/donors/'+d.id)).donor))
  assert.equal(people.length,4)
  const blake=people.find(d=>d.first_name==='Blake'),cleo=people.find(d=>d.first_name==='Cleo'),dana=people.find(d=>d.first_name==='Dana')
  const ava=await h.get('/api/coffer/donors/'+existing.id),b=await h.get('/api/coffer/donors/'+blake.id),c=await h.get('/api/coffer/donors/'+cleo.id)
  assert.equal(ava.donor.name,'Ava Native','Explicit matching preserves the current native profile')
  const gifts=[...ava.gifts,...b.gifts,...c.gifts],gift=n=>gifts.find(g=>g.reference==='spreadsheet:'+key(n))
  assert.deepEqual(gifts.map(g=>g.amount_cents).sort((a,b)=>a-b),[27500,30000,32500,45000])
  assert.deepEqual([gift(6011).fund,gift(6012).fund,gift(6011).method,gift(6012).method],['Library','Tutoring','check','bank transfer'])
  assert.deepEqual([gift(6011).acknowledgment.status,gift(6011).acknowledgment.acknowledged_on,gift(6011).acknowledgment.method],['acknowledged','2026-09-05','email'])
  assert.equal(gift(6011).acknowledgment.link.id,ava.depth.interactions.find(i=>i.notes==='Source gift thank-you').id)
  assert.equal(gift(6012).goods_cents,2500);assert.equal(gift(6014).goods,'unknown')
  assert.equal(c.customValues.find(v=>v.field_key==='source_category').value,'"Books"')
  assert.deepEqual((await h.get('/api/coffer/letters')).due.map(g=>g.reference).sort(),[6012,6014].map(n=>'spreadsheet:'+key(n)))
  const soft=b.giftDepth.creditedGifts.find(s=>s.amount_cents===10000)
  assert.ok(soft,'Credit is recognition rather than extra cash')
  assert.equal(soft.acknowledgment.status,'acknowledged');assert.equal(soft.acknowledgment.acknowledgedOn,'2026-09-06');assert.equal(soft.acknowledgment.method,'phone call');assert.equal(soft.acknowledgment.link.id,b.depth.interactions.find(i=>i.notes==='Independent credit thank-you').id)
  assert.equal(b.solicitation.type,'stop')
  assert.deepEqual(Object.fromEntries(b.consents.map(p=>[p.channel,p.status])),{email:'unknown',mail:'withdrawn',sms:'unknown',phone:'withdrawn'})
  assert.ok(b.consents.every(p=>p.method==='spreadsheet export'&&p.captured_on==='2026-09-01'&&p.recorded_at))
  const household=await h.get('/api/coffer/households/'+blake.household_id)
  assert.equal(household.household.head_donor_id,cleo.id);assert.equal(household.household.head_source,'spreadsheet');assert.ok(household.household.head_imported_at)
  assert.equal(household.household.addressee_override,'The Chen Readers');assert.equal(household.household.informal_override,'Blake and Cleo')
  assert.equal((await h.get('/api/coffer/households/'+dana.household_id)).household.head_donor_id,null)
  assert.equal(b.donor.informal_salutation,'Dear Bee');assert.equal(b.donor.formal_salutation,'Doctor Chen');assert.equal(b.donor.envelope_name,'Doctor Blake Lee Chen III')
  assert.equal(dana.constituent_status,'inactive');assert.equal((await h.get('/api/coffer/duplicates')).pairs.some(p=>[p.source.id,p.target.id].includes(blake.id)&&[p.source.id,p.target.id].includes(existing.id)),true)
  const tribute=(await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed');assert.equal(tribute.totalCents,75000)
  assert.equal(ava.giftDepth.tributes[0].amount_permission,0);assert.equal(ava.giftDepth.tributes[0].source_group,key(6041))
  const journal=await h.get('/api/coffer/move-in/journal?id='+preview.id);assert.equal(journal.job.check_report.matches,true,JSON.stringify(journal.job.check_report))
  await post(h,'undo',{id:preview.id},{as:admin.cookie,status:401})
  const saved=await archive(h)
  await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/donors/'+blake.id)).consents,b.consents);await post(fresh,'undo',{id:preview.id});assert.equal((await fresh.get('/api/coffer/donors?status=all')).total,1)})
  assert.equal((await apply(h,await post(h,'preview',input))).unchanged,true,'Replayed file set cannot add gifts or preferences')
  assert.equal((await h.get('/api/coffer/tributes')).groups[0].totalCents,75000)
  if(format==='csv')await spreadsheetUndoBrowser(h,preview.id);else await post(h,'undo',{id:preview.id})
  assert.equal((await h.get('/api/coffer/donors?status=all')).total,1);assert.equal((await h.get('/api/coffer/donors/'+existing.id)).gifts.length,0)
  assert.equal((await h.get('/api/coffer/donors/'+existing.id)).customValues.length,0,'Undo removes every imported custom value')
  assert.equal((await h.get('/api/coffer/custom-fields')).fields.some(f=>f.key==='source_category'),false,'Untouched import-created fields are undone')
  assert.equal((await h.get('/api/coffer/move-in/spreadsheet-mappings')).length,1,'The saved mapping survives undo')
  if(preview.reusedId){const stale=(await h.get('/api/coffer/move-in/journal?id='+preview.reusedId)).job;await post(h,'apply',{id:stale.id,fingerprint:stale.fingerprint,acknowledged:'no'},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,1,'Undoing a source binding cannot let an older preview silently select a different person')}
  input.spreadsheet.donorMatches[key(6001)].version=(await h.get('/api/coffer/donors/'+existing.id)).donor.version
  const again=await post(h,'preview',input);await apply(h,again)
  const hh=await h.get('/api/coffer/households/'+blake.household_id)
  await h.command('household.update',{householdId:blake.household_id,version:hh.household.version,informal_override:'A later native greeting'})
  await post(h,'undo',{id:again.id},{status:409});assert.equal((await h.get('/api/coffer/households/'+blake.household_id)).household.informal_override,'A later native greeting')
  const notification=await h.command('tributeNotification.prepare',{giftId:gift(6011).id})
  const prepared=(await h.get('/api/coffer/donors/'+existing.id)).tributeNotifications.find(n=>n.id===notification.id)
  assert.equal(prepared.recipient_name,'River Reed');assert.ok(!prepared.body.includes('$'),'Imported tribute notifications withhold the amount')
  await h.command('tributeNotification.approve',{notificationId:notification.id,version:1})
  const download=await h.request('/api/coffer/tribute-notifications/'+notification.id+'/download');assert.equal(download.status,200);assert.ok(!(await download.text()).includes('$300'))
  const appeal=await h.command('appeal.prepare',{name:'Source preference exclusions',channel:'email'})
  assert.equal(appeal.recipients,1);assert.equal(appeal.excluded['do not solicit'],1);assert.equal(appeal.excluded['no consent recorded'],1);assert.equal(appeal.excluded.inactive,1)
  assert.deepEqual((await h.get('/api/coffer/appeals/'+appeal.id)).recipients.map(r=>r.donor_id),[cleo.id])
  await h.command('gift.reverse',{giftId:gift(6012).id,reason:'Source check returned'})
  assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed').totalCents,30000,'Tribute totals follow signed remaining cash')
  await h.command('consent.record',{donorIds:[blake.id],channel:'email',status:'withdrawn',method:'paper form',evidence:key(6081),capturedOn:'2026-09-02'})
  const changed=structuredClone(input);changed.files=await makeFiles(fixture.tables.map(([name,table])=>[name,table]),format);changed.spreadsheet.name='A new review'
  const rejected=await post(h,'preview',changed);assert.equal(rejected.canApply,false,'New source review cannot overwrite a later native channel choice')
  await h.command('donor.erase',{donorId:blake.id,confirm:'ERASE'})
  assert.equal((await post(h,'preview',input)).canApply,false,'Replay cannot resurrect erased source identity or facts')
  assert.deepEqual((await h.get('/api/coffer/donors/'+existing.id)).donor.name,'Ava Native')
 })
}

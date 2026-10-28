import assert from 'node:assert/strict'
import {run,archive,restore} from './harness.mjs'
import {sourceCaptureBrowser,sourceCustomBrowser} from './custom-import-browser.mjs'
const endpoint='/api/coffer/move-in/',post=(h,action,input,options)=>h.api(endpoint+action,input,options)
const file=(name,rows)=>({name,base64:Buffer.from(rows.map(r=>r.join(',')).join('\r\n')).toString('base64')})
function neonEdge(){
 const options=[{id:'11',name:'Board'},{id:'12',name:'Volunteer'}],interests=[{id:'13',name:'Books'},{id:'14',name:'Music'}]
 const definition=(id,name,component,displayType,dataType,extra={})=>({id,name,component,displayType,dataType,status:'ACTIVE',...extra})
 return async request=>{
  const u=new URL(request.url),p=u.pathname.slice(3);assert.equal(u.origin,'https://api.neoncrm.com');assert.equal(request.method,'GET');assert.equal(request.headers.get('authorization'),'Basic '+Buffer.from('synthetic-coffer-1670:synthetic-coffer-1671').toString('base64'));assert.equal(request.headers.get('NEON-API-VERSION'),'2.12')
  if(p==='/customFields')return Response.json(({Account:[definition('1','Membership','Account','Dropdown','Text',{accountSettings:{accountType:'Any'},optionValues:options}),definition('2','Interests','Account','Checkbox','Text',{accountSettings:{accountType:'Any'},optionValues:interests})],Donation:[definition('3','Budget','Donation','OneLineText','Currency')],Activity:[definition('4','Topic','Activity','OneLineText','Text')]}[u.searchParams.get('category')]))
  if(p==='/accounts/41')return Response.json({individualAccount:{accountId:'41',accountCustomFields:[{id:'1',optionValues:[options[0]]},{id:'2',optionValues:interests}]}})
  if(p==='/donations/42')return Response.json({id:'42',donationCustomFields:[{id:'3',value:'123.45'}]})
  if(p==='/donations/45')return Response.json({id:'45',donationCustomFields:[{id:'3',value:'not a number'}]})
  if(p==='/activities/43')return Response.json({id:'43',activityCustomFields:[{id:'4',value:'Source activity call'}]})
  if(p==='/activities/44')return Response.json({id:'44',activityCustomFields:[{id:'4',value:'Source activity task'}]})
  assert.fail('Unexpected Neon request '+p)
 }
}
export async function neonCustomJourney(){await run(async h=>{
 await h.command('custom.define',{key:'existing_membership',label:'Membership',kind:'constituent',type:'text',entry:'pick-one',choices:['Board','Volunteer']})
 const input={source:'neon',files:[file('accounts.csv',[['Account ID','Name'],[41,'Synthetic Neon Custom']]),file('donations.csv',[['Donation ID','Account ID','Gift Type','Gift Date','Amount','Payment Method','Non-Deductible Amount'],[42,41,'Donation','2026-10-01','50','Check',0],[45,41,'Donation','2026-10-01','25','Check',0]]),file('activities.csv',[['Activity ID','Account ID','Activity Date','Activity Type','Note'],[43,41,'2026-10-01','call','Source activity call'],[44,41,'2026-10-01','task','Source activity task']])]}
 const p=await post(h,'preview',input);assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));await post(h,'apply',{id:p.id,fingerprint:p.fingerprint})
 await sourceCaptureBrowser(h,p.id,'.cache/custom-source-neon','synthetic-coffer-1671',{organizationId:'synthetic-coffer-1670'})
 let review=(await h.get(endpoint+'custom-review?id='+p.id)).review
 assert.equal(review.definitions.length,5);assert.equal(review.values.filter(v=>v.state==='waiting').length,1)
 const mappings=review.mappings.map(m=>m.id==='neon:constituent:1'?{...m,field:{...m.field,key:'existing_membership',version:1}}:m)
 await post(h,'custom-review',{id:p.id,version:review.version,mappings,resolutions:[]})
 await sourceCustomBrowser(h,p.id,'.cache/custom-source-neon')
 review=(await h.get(endpoint+'custom-review?id='+p.id)).review
 await post(h,'custom-apply',{id:p.id,version:review.version})
 await sourceCustomBrowser(h,p.id,'.cache/custom-source-neon',{applied:true})
 const person=(await h.get('/api/coffer/donors')).donors[0],details=await h.get('/api/coffer/donors/'+person.id)
 assert.deepEqual(Object.fromEntries(details.customValues.map(v=>[v.field_key,JSON.parse(v.value)])),{existing_membership:'Board',import_neon_neon_constituent_2:['Books','Music'],import_neon_neon_gift_3:'12345',import_neon_neon_interaction_4:'Source activity call',import_neon_neon_note_4:'Source activity task'})
 const saved=await archive(h,{maxParts:100});await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/donors/'+person.id)).customValues,details.customValues);await post(fresh,'undo',{id:p.id});assert.deepEqual((await fresh.get('/api/coffer/custom-fields')).fields.map(f=>f.key),['existing_membership'])})
 const list=await h.command('list.save',{name:'Neon board',filters:{customKey:'existing_membership',customValue:'Board'}});assert.deepEqual((await h.get('/api/coffer/lists/'+list.id+'/members')).donorIds,[person.id])
},{outbound:neonEdge()})}

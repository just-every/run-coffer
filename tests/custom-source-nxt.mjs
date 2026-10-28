import assert from 'node:assert/strict'
import {run,archive,restore} from './harness.mjs'
import {sourceCaptureBrowser,sourceCustomBrowser} from './custom-import-browser.mjs'
const endpoint='/api/coffer/move-in/',post=(h,action,input,options)=>h.api(endpoint+action,input,options)
const file=(name,rows)=>({name,base64:Buffer.from(rows.map(r=>r.join(',')).join('\r\n')).toString('base64')})
function nxtEdge(){
 const categories={Constituent:[{custom_field_category_id:1,description:'Membership',type_of_data:'Table',code_table_id:43},{custom_field_category_id:2,description:'Interests',type_of_data:'Table',code_table_id:44}],Gift:[{custom_field_category_id:3,description:'Budget',type_of_data:'Currency'}],Action:[{custom_field_category_id:4,description:'Topic',type_of_data:'Text'}]}
 const details={Constituent:[{name:'Membership',type:'CodeTableEntry',code_table_id:'43',one_per_record:true},{name:'Interests',type:'CodeTableEntry',code_table_id:'44',one_per_record:false}],Gift:[{name:'Budget',type:'Currency'}],Action:[{name:'Topic',type:'Text'}]}
 const tables={43:['Board','Volunteer'],44:['Books','Music']},collection=value=>({count:value.length,value})
 return async request=>{
  const u=new URL(request.url),p=u.pathname;assert.equal(u.origin,'https://api.sky.blackbaud.com');assert.equal(request.method,'GET');assert.equal(request.headers.get('authorization'),'Bearer synthetic-coffer-1660');assert.equal(request.headers.get('Bb-Api-Subscription-Key'),'synthetic-coffer-1661')
  if(p==='/customfield/customfieldcategories')return Response.json({custom_field_categories:categories[u.searchParams.get('record_type')],count:categories[u.searchParams.get('record_type')].length,offset:0,limit:50})
  if(p==='/constituent/v1/constituents/customfields/categories/details')return Response.json(collection(details.Constituent))
  if(p==='/gift/v1/gifts/customfields/categories')return Response.json(collection(details.Gift))
  if(p==='/constituent/v1/actions/customfields/categories/details')return Response.json(collection(details.Action))
  let m=/^\/codetable\/v1\/codetables\/(\d+)\/tableentries$/.exec(p)
  if(m)return Response.json(collection(tables[m[1]].map((value,i)=>({table_entries_id:String(61+i),code_tables_id:m[1],long_description:value,is_active:i===0}))))
  if(p==='/constituent/v1/constituents')return Response.json(collection([{id:'101',lookup_id:'synthetic-coffer-1662'}]))
  if(p==='/gift/v1/gifts')return Response.json(collection([{id:'201',lookup_id:'synthetic-coffer-1663'},{id:'202',lookup_id:'synthetic-coffer-1664'}]))
  if(p==='/constituent/v1/actions/303')return Response.json({id:'303'})
  if(p==='/constituent/v1/actions/304')return Response.json({id:'304'})
  const values={
   '/constituent/v1/constituents/101/customfields':[{id:'501',parent_id:'101',category:'Membership',type:'CodeTableEntry',value:'Board'},{id:'502',parent_id:'101',category:'Interests',type:'CodeTableEntry',value:'Books'},{id:'503',parent_id:'101',category:'Interests',type:'CodeTableEntry',value:'Music'}],
   '/gift/v1/gifts/201/customfields':[{id:'504',parent_id:'201',category:'Budget',type:'Currency',value:123.45}],
   '/gift/v1/gifts/202/customfields':[{id:'505',parent_id:'202',category:'Budget',type:'Currency',value:'not a number'}],
   '/constituent/v1/actions/303/customfields':[{id:'506',parent_id:'303',category:'Topic',type:'Text',value:'Source action call'}],
   '/constituent/v1/actions/304/customfields':[{id:'507',parent_id:'304',category:'Topic',type:'Text',value:'Source action task'}],
  }
  if(values[p])return Response.json(collection(values[p]))
  assert.fail('Unexpected NXT request '+p)
 }
}
export async function nxtCustomJourney(){await run(async h=>{
 await h.command('custom.define',{key:'existing_membership',label:'Membership',kind:'constituent',type:'text',entry:'pick-one',choices:['Board','Volunteer']})
 const input={source:'re-nxt',files:[file('constituents.csv',[['Constituent ID','Name'],['synthetic-coffer-1662','Synthetic NXT Custom']]),file('gifts.csv',[['Gift ID','Constituent ID','Gift Type','Gift Date','Amount','Payment Method','Non-Deductible Amount'],['synthetic-coffer-1663','synthetic-coffer-1662','Cash','2026-10-01','50','Check',0],['synthetic-coffer-1664','synthetic-coffer-1662','Cash','2026-10-01','25','Check',0]]),file('actions.csv',[['Action ID','Constituent ID','Action Date','Action Type','Note'],[303,'synthetic-coffer-1662','2026-10-01','call','Imported source call'],[304,'synthetic-coffer-1662','2026-10-01','task','Imported source task']])]}
 const p=await post(h,'preview',input);assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));await post(h,'apply',{id:p.id,fingerprint:p.fingerprint})
 await post(h,'custom-capture',{id:p.id,apiKey:'synthetic-coffer-1660',subscriptionKey:'synthetic-coffer-1661'},{status:502})
 await sourceCaptureBrowser(h,p.id,'.cache/custom-source-nxt','synthetic-coffer-1660',{subscriptionKey:'synthetic-coffer-1661',idType:'lookup',tokenLabel:'Source access token'})
 let review=(await h.get(endpoint+'custom-review?id='+p.id)).review
 assert.equal(review.definitions.length,5);assert.equal(review.values.filter(v=>v.state==='waiting').length,1)
 const mappings=review.mappings.map(m=>m.id==='nxt_constituent_1'?{...m,field:{...m.field,key:'existing_membership',version:1}}:m)
 await post(h,'custom-review',{id:p.id,version:review.version,mappings,resolutions:[]})
 await sourceCustomBrowser(h,p.id,'.cache/custom-source-nxt')
 review=(await h.get(endpoint+'custom-review?id='+p.id)).review
 await post(h,'custom-apply',{id:p.id,version:review.version})
 await sourceCustomBrowser(h,p.id,'.cache/custom-source-nxt',{applied:true})
 const person=(await h.get('/api/coffer/donors')).donors[0],details=await h.get('/api/coffer/donors/'+person.id)
 assert.deepEqual(Object.fromEntries(details.customValues.map(v=>[v.field_key,JSON.parse(v.value)])),{existing_membership:'Board',import_re_nxt_nxt_constituent_2:['Books','Music'],import_re_nxt_nxt_gift_3:'12345',import_re_nxt_nxt_interaction_4:'Source action call',import_re_nxt_nxt_note_4:'Source action task'})
 const saved=await archive(h);await run(async fresh=>{await restore(fresh,saved);await post(fresh,'undo',{id:p.id});assert.deepEqual((await fresh.get('/api/coffer/custom-fields')).fields.map(f=>f.key),['existing_membership'])})
 review=(await h.get(endpoint+'custom-review?id='+p.id)).review
 const waiting=review.values.find(v=>v.state==='waiting');assert.equal(waiting.original,'not a number')
 const skipped=await post(h,'custom-review',{id:p.id,version:review.version,mappings:review.mappings,resolutions:[{id:waiting.id,action:'skip'}]})
 assert.deepEqual(skipped.review.counts.find(c=>c.id==='nxt_gift_3'),{id:'nxt_gift_3',name:'Budget',defined:1,source:2,carried:1,waiting:0,skipped:1})
 await post(h,'custom-apply',{id:p.id,version:skipped.review.version})
 const list=await h.command('list.save',{name:'NXT board',filters:{customKey:'existing_membership',customValue:'Board'}});assert.deepEqual((await h.get('/api/coffer/lists/'+list.id+'/members')).donorIds,[person.id])
},{outbound:nxtEdge()})}

import assert from 'node:assert/strict'
import {sourceCaptureBrowser,sourceCustomBrowser} from './custom-import-browser.mjs'
import {run,archive,restore} from './harness.mjs'
const endpoint='/api/coffer/move-in/'
const post=(h,action,input,options)=>h.api(endpoint+action,input,options)
const file=(name,rows)=>({name,base64:Buffer.from(rows.map(r=>r.join(',')).join('\r\n')).toString('base64')})
function lglEdge(){
 const keyword=(id,category_id,name)=>({id,category_id,name}),memberChoices=[keyword(41,31,'Board'),keyword(42,31,'Volunteer')],interests=[keyword(43,32,'Books'),keyword(44,32,'Music')],giftChoices=[keyword(45,33,'Reading')],giftTags=[keyword(46,34,'Library supporter')],constituentTags=[keyword(47,35,'Library supporter')]
 const category=(id,item_type,name,facet_type,keywords)=>({id,item_type,name,facet_type,keywords,key:'synthetic-coffer-'+id})
 const categories=[category(31,'Constituent','Membership','single',[]),category(32,'Constituent','Interests','list',[]),category(33,'Gift','Gift purpose','single',[]),category(34,'Gift','Gift circle','single',[]),category(35,'Constituent','Supporter circle','single',[])]
 const attrs=[{id:51,item_type:0,name:'Source detail',key:'synthetic-coffer-51'},{id:52,item_type:0,name:'Source score',key:'synthetic-coffer-52'}]
 const page=items=>({items_count:items.length,total_items:items.length,offset:0,limit:25,items})
 return async request=>{
  const u=new URL(request.url);assert.equal(u.origin,'https://api.littlegreenlight.com');assert.equal(request.method,'GET');assert.equal(request.headers.get('authorization'),'Bearer synthetic-coffer-1650')
  const p=u.pathname.slice('/api/v1'.length)
  if(p==='/categories.json')return Response.json(page(categories.filter(c=>c.item_type===u.searchParams.get('item_type'))))
  if(p==='/attributes.json')return Response.json(page(attrs))
  const choices={'/categories/31/keywords.json':memberChoices,'/categories/32/keywords.json':interests,'/categories/33/keywords.json':giftChoices,'/categories/34/keywords.json':giftTags,'/categories/35/keywords.json':constituentTags}
  if(choices[p])return Response.json(page(choices[p]))
  if(p==='/constituents/71.json')return Response.json({id:71,custom_attrs:[{...attrs[0],classification:'text',value:'Keep source detail'},{...attrs[1],classification:'integer',value:'not a number'}]})
  if(p==='/constituents/71/categories.json')return Response.json(page([{...categories[0],keywords:[memberChoices[0]]},{...categories[1],keywords:interests},{...categories[4],keywords:constituentTags}]))
  if(p==='/gifts/81.json')return Response.json({id:81,custom_fields:[{...categories[2],values:giftChoices},{...categories[3],values:giftTags}]})
  assert.fail('Unexpected LGL request '+p)
 }
}
export async function lglCustomJourney(){await run(async h=>{
 await h.command('custom.define',{key:'existing_membership',label:'Membership',kind:'constituent',type:'text',entry:'pick-one',choices:['Board','Volunteer']})
 const input={source:'lgl',files:[file('constituents.csv',[['LGL Constituent ID','Name'],[71,'Synthetic LGL Custom']]),file('gifts.csv',[['LGL Gift ID','LGL Constituent ID','Gift Type','Gift Date','Amount','Payment Method','Non-Deductible Amount'],[81,71,'Gift','2026-10-01','67.89','Check',0]])]}
 const preview=await post(h,'preview',input);assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics));await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint})
 await sourceCaptureBrowser(h,preview.id,'.cache/custom-source-lgl','synthetic-coffer-1650')
 const captured=await post(h,'custom-capture',{id:preview.id,apiKey:'synthetic-coffer-1650'}),r=captured.review
 assert.equal(r.definitions.length,7);assert.equal(r.values.filter(v=>v.state==='waiting').length,1)
 const mappings=r.mappings.map(m=>m.id==='category:constituent:31'?{...m,field:{...m.field,key:'existing_membership',version:1}}:['category:gift:34','category:constituent:35'].includes(m.id)?{...m,action:'tags'}:m.id==='attribute:constituent:51'?{...m,field:{...m.field,label:'Imported source detail'}}:m)
 const revised=await post(h,'custom-review',{id:preview.id,version:r.version,mappings,resolutions:[]})
 await sourceCustomBrowser(h,preview.id,'.cache/custom-source-lgl',{topic:false})
 const native=(await h.get(endpoint+'custom-review?id='+preview.id)).review
 await post(h,'custom-apply',{id:preview.id,version:native.version})
 await sourceCustomBrowser(h,preview.id,'.cache/custom-source-lgl',{applied:true,topic:false})
 const person=(await h.get('/api/coffer/donors')).donors[0],details=await h.get('/api/coffer/donors/'+person.id),values=Object.fromEntries(details.customValues.map(v=>[v.field_key,JSON.parse(v.value)]))
 assert.deepEqual(values,{existing_membership:'Board',import_lgl_category_constituent_32:['Books','Music'],import_lgl_category_gift_33:'Reading',import_lgl_attribute_constituent_51:'Keep source detail'})
 assert.deepEqual(details.ruleTags.map(t=>t.tag),['Library supporter'],'Constituent and gift categories share one explicitly mapped tag assignment')
 const definitions=(await h.get('/api/coffer/custom-fields')).fields
 assert.equal(definitions.find(f=>f.key==='import_lgl_attribute_constituent_52').type,'number','A waiting-only definition is still created')
 const saved=await archive(h,{maxParts:100})
 await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/donors/'+person.id)).customValues,details.customValues);await post(fresh,'undo',{id:preview.id});assert.deepEqual((await fresh.get('/api/coffer/custom-fields')).fields.map(f=>f.key),['existing_membership'])})
 const list=await h.command('list.save',{name:'LGL board',filters:{customKey:'existing_membership',customValue:'Board'}})
 assert.deepEqual((await h.get('/api/coffer/lists/'+list.id+'/members')).donorIds,[person.id])
 const report=await h.command('report.save',{name:'LGL gift purpose',definition:{recordType:'gifts',columns:['id','custom.import_lgl_category_gift_33','amount_cents'],groupBy:['custom.import_lgl_category_gift_33'],totals:['amount_cents'],filters:[]}})
 const grouped=await h.get('/api/coffer/reports/builder?id='+report.id);assert.equal(grouped.totals.amount_cents,6789);assert.equal(grouped.groups[0]['custom.import_lgl_category_gift_33'],'Reading')
 const current=(await h.get(endpoint+'custom-review?id='+preview.id)).review,waiting=current.values.find(v=>v.state==='waiting')
 const fixed=await post(h,'custom-review',{id:preview.id,version:current.version,mappings:current.mappings,resolutions:[{id:waiting.id,action:'map',value:'12'}]})
 await post(h,'custom-apply',{id:preview.id,version:fixed.review.version})
 assert.equal(JSON.parse((await h.get('/api/coffer/donors/'+person.id)).customValues.find(v=>v.field_key==='import_lgl_attribute_constituent_52').value),'12')
 await post(h,'undo',{id:preview.id},{status:409})
},{outbound:lglEdge()})}

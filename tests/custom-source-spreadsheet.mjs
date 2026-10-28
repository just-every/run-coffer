import assert from 'node:assert/strict'
import {run,archive,restore} from './harness.mjs'
import {sourceCustomBrowser} from './custom-import-browser.mjs'
const endpoint='/api/coffer/move-in/',post=(h,action,input,options)=>h.api(endpoint+action,input,options)
const file=(name,rows)=>({name,base64:Buffer.from(rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')).toString('base64')})
export async function spreadsheetCustomJourney(){await run(async h=>{
 const source='spreadsheet',mapping=(column,key,kind,type,entry='free-form',choices=[])=>({source,column,key,label:column,kind,type,entry,choices})
 const fields=[mapping('Membership','existing_membership','constituent','text','pick-one',['Board','Volunteer']),mapping('Interests','sheet_interests','constituent','text','pick-many',['Books','Music']),mapping('Score','sheet_score','constituent','number'),mapping('Renewed','sheet_date','constituent','date'),mapping('Year','sheet_year','constituent','year'),mapping('Active','sheet_active','constituent','checkbox'),mapping('Budget','sheet_budget','gift','currency'),mapping('Topic','sheet_topic','interaction','text'),mapping('Note detail','sheet_note','note','text')]
 await h.command('custom.define',fields[0]);fields[0].version=1
 const input={source,customFields:fields,files:[file('people.csv',[['Constituent ID','Name','Membership','Interests','Score','Renewed','Year','Active'],['synthetic-coffer-1680','Synthetic Sheet Custom','Board','["Books","Music"]','12.5','2026-10-01','2027','false']]),file('gifts.csv',[['Gift ID','Constituent ID','Gift Type','Gift Date','Amount','Payment Method','Non-Deductible Amount','Budget'],['synthetic-coffer-1681','synthetic-coffer-1680','Gift','2026-10-01','50','Check','0','123.45'],['synthetic-coffer-1682','synthetic-coffer-1680','Gift','2026-10-01','25','Check','0','not a number']]),file('calls.csv',[['Note ID','Constituent ID','Note Date','Note Type','Note','Topic'],['synthetic-coffer-1683','synthetic-coffer-1680','2026-10-01','call','Imported source call','Library visit']]),file('notes.csv',[['Note ID','Constituent ID','Note Date','Note Type','Note','Note detail'],['synthetic-coffer-1684','synthetic-coffer-1680','2026-10-01','general','Imported source note','Original note detail']])]}
 const p=await post(h,'preview',input);assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));assert.equal(p.unmapped.length,0)
 await post(h,'apply',{id:p.id,fingerprint:p.fingerprint})
 let review=(await h.get(endpoint+'custom-review?id='+p.id)).review
 assert.equal(review.definitions.length,9);assert.equal(review.values.filter(v=>v.state==='waiting').length,1)
 assert.deepEqual((await h.get('/api/coffer/custom-fields')).fields.map(f=>f.key),['existing_membership'],'Staged spreadsheet metadata does not create fields before custom review')
 await sourceCustomBrowser(h,p.id,'.cache/custom-source-spreadsheet')
 review=(await h.get(endpoint+'custom-review?id='+p.id)).review
 await post(h,'custom-apply',{id:p.id,version:review.version})
 await sourceCustomBrowser(h,p.id,'.cache/custom-source-spreadsheet',{applied:true})
 const person=(await h.get('/api/coffer/donors')).donors[0],details=await h.get('/api/coffer/donors/'+person.id)
 assert.deepEqual(Object.fromEntries(details.customValues.map(v=>[v.field_key,JSON.parse(v.value)])),{existing_membership:'Board',sheet_interests:['Books','Music'],sheet_score:'12.5',sheet_date:'2026-10-01',sheet_year:'2027',sheet_active:'false',sheet_budget:'12345',sheet_topic:'Library visit',sheet_note:'Original note detail'})
 const saved=await archive(h);await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/donors/'+person.id)).customValues,details.customValues);await post(fresh,'undo',{id:p.id});assert.deepEqual((await fresh.get('/api/coffer/custom-fields')).fields.map(f=>f.key),['existing_membership'])})
 const list=await h.command('list.save',{name:'Spreadsheet board',filters:{customKey:'existing_membership',customValue:'Board'}});assert.deepEqual((await h.get('/api/coffer/lists/'+list.id+'/members')).donorIds,[person.id])
 const waiting=review.values.find(v=>v.state==='waiting'),fixed=await post(h,'custom-review',{id:p.id,version:review.version,mappings:review.mappings,resolutions:[{id:waiting.id,action:'fix',value:'75.25'}]})
 await post(h,'custom-apply',{id:p.id,version:fixed.review.version})
 assert.deepEqual((await h.get('/api/coffer/reports/custom-fields?field=sheet_budget')).groups.map(g=>[g.value,g.amountCents]),[['12345',5000],['7525',2500]])
})}

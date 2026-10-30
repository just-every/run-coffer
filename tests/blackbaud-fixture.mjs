import assert from 'node:assert/strict'
export const key=n=>'synthetic-coffer-'+n
export const email=n=>[key(n),'example.test'].join('@')
export const sourceFile=review=>({name:'sky-review.json',base64:Buffer.from(JSON.stringify(review)).toString('base64')})
/** The response fields follow the published SKY Constituent, Gift and Opportunity
 * API schemas. The review file is Coffer's separate, attested mapping format. */
export function blackbaudFixture(){
 const people=Array.from({length:6},(_,i)=>({id:key(9001+i),name:['Dr. Ava Reed','Bee Reed','Cleo Chen','Dana Chen','Eli Vale','Finn Vale'][i],first:['Ava','Bee','Cleo','Dana','Eli','Finn'][i],last:['Reed','Reed','Chen','Chen','Vale','Vale'][i],type:'Individual',title:i===0?'Dr.':undefined,inactive:i===5,deceased:i===4,deceased_date:i===4?{y:2026,m:8,d:1}:undefined}))
 const split=(n,value,fund)=>({id:key(n),amount:{value},fund_id:fund,campaign_id:'c1',appeal_id:'a1'})
 const gift=(n,donor,value,extra={})=>({id:key(n),constituent_id:key(donor),date:'2026-09-03T12:00:00',amount:{value},gift_splits:[split(n+100,value,'f1')],gift_status:'Active',type:'Donation',payments:[{payment_method:'PersonalCheck',account_token:key(9997)}],receipts:[{amount:{value},status:'Receipted'}],acknowledgements:[{status:'NotAcknowledged'}],...extra})
 const gifts=[gift(9011,9001,500,{gift_splits:[split(9111,300,'f1'),split(9112,200,'f2')],receipts:[{amount:{value:450},status:'Receipted'}],acknowledgements:[{status:'Acknowledged',date:'2026-09-04T12:00:00',letter:'Source letter 14'}],soft_credits:[{id:key(9031),gift_id:key(9011),constituent_id:key(9002),amount:{value:100}}]}),gift(9012,9002,250,{acknowledgements:[{status:'DoNotAcknowledge'}]}),gift(9013,9003,500),{id:key(9014),type:'Pledge',constituent_id:key(9003),date:'2026-09-01T12:00:00',amount:{value:1000},balance:{value:1000},gift_splits:[split(9114,1000,'f1')]}]
 const actions=[{id:key(9021),constituent_id:key(9001),category:'Email',completed:true,date:'2026-09-04T12:00:00',summary:'Original thank you',description:'Source email acknowledgment'},{id:key(9022),constituent_id:key(9002),category:'Phone Call',completed:true,date:'2026-09-05T12:00:00',summary:'Recognition call',description:'Separate soft-credit thanks'}]
 const relationships=[{id:key(9041),constituent_id:key(9001),relation_id:key(9002),is_spouse:true,is_constituent_head_of_household:true},{id:key(9042),constituent_id:key(9003),relation_id:key(9004),is_spouse:true}]
 const notes=[{id:key(9023),constituent_id:key(9003),date:{y:2026,m:9,d:2},summary:'Source note',text:'Prefers reading programs'}]
 const opportunities=[{id:key(9051),constituent_id:key(9003),name:'Library renewal',status:'Proposal',ask_amount:{value:3000},expected_amount:{value:2400},expected_date:'2026-12-01T00:00:00',summary:'Discuss the source proposal',fund_id:'f2',campaign_id:'c1',fundraisers:[{constituent_id:key(9001)}],inactive:false}]
 const review={currency:'USD',funds:{f1:'Reading',f2:'Library'},campaigns:{c1:'Autumn books'},appeals:{a1:'Annual reading'},stages:{Proposal:{stage:'ask',probability:80}},owners:{},contactTypes:{'email:Email':'personal','email:Work':'work','phone:Mobile':'mobile','address:Home':'home'},households:{[key(9061)]:{name:'Source Reed family',members:[key(9001),key(9002)],headId:key(9001),addressee:'  The Reading Family  ',formal:'Dear Reed Readers',informal:'Dear Ava and Bee'},[key(9062)]:{name:'Source Chen family',members:[key(9003),key(9004)]}},gifts:{[key(9011)]:{acknowledgmentMethod:'email',acknowledgmentInteractionId:key(9021),tribute:{kind:'memory',honoree:'Jordan Reed',sourceGroup:key(9081),recipientName:'River Reed',recipientAddress:'12 River Road'}},[key(9012)]:{tribute:{kind:'memory',honoree:'Jordan Reed',sourceGroup:key(9081)}}},softCredits:{[key(9031)]:{status:'acknowledged',date:'2026-09-05',method:'phone call',reference:'Source phone thanks',interactionId:key(9022)}},customFields:[{source:'re-nxt',column:'Membership',key:'sky_membership',label:'Membership interest',kind:'constituent',type:'text',entry:'pick-one',choices:['Board','Volunteer'],version:0},{source:'re-nxt',column:'Gift detail',key:'sky_detail',label:'Gift detail',kind:'gift',type:'text',entry:'free-form',choices:[],version:0}]}
 const calls=[],state={badPages:false,crossHost:false,denied:false}
 const blackbaud={accessToken:key(9998),subscriptionKey:key(9999)},solicitCodes={'Do not solicit':{type:'stop'},'Do not mail':{type:'channels',channels:['mail']},'Solicit once annually':{type:'limit',maxAsks:1}}
 const input=()=>({source:'re-nxt',blackbaud,files:[sourceFile(review)],solicitCodes})
 const outbound=async request=>{
  const u=new URL(request.url),path=u.pathname
  assert.equal(u.origin,'https://api.sky.blackbaud.com');assert.equal(request.method,'GET','The source is never modified');assert.equal(request.headers.get('authorization'),'Bearer '+blackbaud.accessToken);assert.equal(request.headers.get('Bb-Api-Subscription-Key'),blackbaud.subscriptionKey);calls.push(path)
  if(state.denied)return Response.json({message:'Permission refused'},{status:403})
  const collection=(rows,pageSize=100)=>{
   const offset=Number(u.searchParams.get('offset')??0),value=rows.slice(offset,offset+pageSize),result={count:rows.length,value}
   if(offset+value.length<rows.length){const next=new URL(u);next.searchParams.set('offset',String(offset+value.length));result.next_link=next.toString();if(state.badPages)delete result.next_link;if(state.crossHost)result.next_link='https://example.test/next'}
   return Response.json(result)
  }
  if(path==='/constituent/v1/constituents')return collection(people,2)
  const person=/^\/constituent\/v1\/constituents\/([^/]+)(.*)$/.exec(path)
  if(person){const id=decodeURIComponent(person[1]),tail=person[2],p=people.find(p=>p.id===id);assert.ok(p)
   if(!tail)return Response.json(p)
   if(tail==='/nameformats/summary')return Response.json({primary_addressee:{id:'add:'+id,constituent_id:id,formatted_name:'  The original '+p.first+' addressee  ',primary_type:'Addressee'},primary_salutation:{id:'sal:'+id,constituent_id:id,formatted_name:'  Dearest '+p.first+'  ',primary_type:'Salutation'}})
   if(tail==='/emailaddresses')return collection([{id:'email:'+id,constituent_id:id,address:email(Number(id.split('-').at(-1))),primary:true,type:'Email',inactive:false},...(id===key(9001)?[{id:'work:'+id,constituent_id:id,address:email(9191),primary:false,type:'Work',inactive:false}]:[])])
   if(tail==='/phones')return collection([{id:'phone:'+id,constituent_id:id,number:'+12025550180',primary:true,type:'Mobile',inactive:false}])
   if(tail==='/addresses')return collection([{id:'address:'+id,constituent_id:id,address_lines:(id===key(9005)||id===key(9006)?'5':id)+' Reading Street',city:'Madison',state:'WI',postal_code:'53703',country:'United States',type:'Home',preferred:true,inactive:false}])
   if(tail==='/communicationpreferences'){const code=id===key(9001)?'Do not solicit':id===key(9002)?'Do not mail':id===key(9003)?'Solicit once annually':null;return collection(code?[{id:'pref:'+id,constituent_id:id,solicit_code:code,start:'2026-09-01T00:00:00'}]:[])}
   if(tail==='/customfields')return collection(id===key(9001)?[{id:key(9071),category:'Membership',value:'Board'}]:[])
  }
  if(path==='/constituent/v1/relationships')return collection(relationships)
  if(path==='/constituent/v1/actions')return collection(actions)
  if(path==='/constituent/v1/notes')return collection(notes)
  if(/^\/constituent\/v1\/actions\/[^/]+\/customfields$/.test(path))return collection([])
  if(path==='/gift/v1/gifts')return collection(gifts,2)
  const giftPath=/^\/gift\/v1\/gifts\/([^/]+)(.*)$/.exec(path)
  if(giftPath){const id=decodeURIComponent(giftPath[1]);if(!giftPath[2])return Response.json(gifts.find(g=>g.id===id));if(giftPath[2]==='/customfields')return collection(id===key(9011)?[{id:key(9072),category:'Gift detail',value:'Books <and> music'}]:[])}
  if(path==='/opportunity/v1/opportunities')return collection(opportunities)
  throw Error('Unexpected Blackbaud request: '+path)
 }
 return {input,review,people,gifts,actions,relationships,notes,opportunities,state,calls,outbound}
}

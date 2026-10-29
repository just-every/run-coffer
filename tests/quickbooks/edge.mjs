import assert from 'node:assert/strict'
import {fixedNow} from '../fixed-clock.mjs'

const at=Date.parse(fixedNow)/1000
const charge=(id,amount,fund,fee)=>({id,object:'charge',paid:true,status:'succeeded',amount,currency:'usd',created:at,metadata:{fund},billing_details:{name:fund+' supporter',email:fund.toLowerCase()+'@example.test'},balance_transaction:'txn_'+id,amount_refunded:0,fee})
export function quickbooksEdge(){
 const charges=[charge('ch_qbo_reading',10000,'Reading',320),charge('ch_qbo_meals',20000,'Meals',610),charge('ch_qbo_housing',30000,'Housing',900)]
 const refund={id:'re_qbo_reading',charge:charges[0].id,status:'succeeded',balance_transaction:'txn_qbo_refund'}
 const dispute={id:'dp_qbo_meals',charge:charges[1].id,status:'needs_response',balance_transactions:[{id:'txn_qbo_dispute',type:'adjustment',source:'dp_qbo_meals',amount:-5000,fee:1500,net:-6500,currency:'usd',created:at}]}
 const transactions=[...charges.map(c=>({id:c.balance_transaction,type:'charge',source:c.id,amount:c.amount,fee:c.fee,net:c.amount-c.fee,currency:'usd',created:at})),{id:'txn_qbo_refund',type:'refund',source:refund,amount:-2500,fee:0,net:-2500,currency:'usd',created:at},...dispute.balance_transactions]
 const payout={id:'po_qbo_three_funds',status:'paid',arrival_date:at,amount:49170,currency:'usd',automatic:true,reconciliation_status:'completed'}
 const accounts=[['checking','Checking','Bank'],['stripe','Stripe clearing','Bank'],['fees','Processing fees','Expense'],['reading','Reading gifts','Income'],['meals','Meals gifts','Income'],['housing','Housing gifts','Income']].map(([Id,Name,AccountType])=>({Id,Name,AccountType,Active:true}))
 const classes=['reading','meals','housing'].map(id=>({Id:id+'-class',Name:id+' program',Active:true}))
 const state={payout,charges,transactions,accounts,classes,realm:'1234567890',refuse:false,lose:false,corrupt:false,requests:[],records:new Map(),exchanges:0,refreshes:0,expiresIn:1}
 state.outbound=async request=>{
  const u=new URL(request.url)
  if(u.hostname==='api.stripe.com'){
   if(u.pathname==='/v1/charges')return Response.json({data:charges,has_more:false})
   if(u.pathname==='/v1/payouts')return Response.json({data:[payout],has_more:false})
   if(u.pathname==='/v1/balance_transactions')return Response.json({data:transactions,has_more:false})
   const object=[...charges,...transactions,refund,dispute,payout].find(x=>u.pathname.endsWith('/'+x.id))
   assert.ok(object,'Known Stripe source '+u.pathname);return Response.json(object)
  }
  if(u.hostname==='oauth.platform.intuit.com'){
   assert.equal(u.pathname,'/oauth2/v1/tokens/bearer');assert.equal(request.method,'POST')
   assert.equal(request.headers.get('authorization'),'Basic '+Buffer.from('synthetic-coffer-1701:synthetic-coffer-1702').toString('base64'))
   const body=new URLSearchParams(await request.text())
   if(body.get('grant_type')==='authorization_code'){
    assert.equal(body.get('code'),'synthetic-coffer-1703');assert.match(body.get('redirect_uri'),/\/app\/settings\/quickbooks\/callback$/);state.exchanges++
   }else{assert.equal(body.get('grant_type'),'refresh_token');assert.match(body.get('refresh_token'),/^synthetic-coffer-refresh-/);state.refreshes++}
   return Response.json({access_token:'synthetic-coffer-access-'+state.refreshes,refresh_token:'synthetic-coffer-refresh-'+state.refreshes,expires_in:state.expiresIn})
  }
  assert.equal(u.hostname,'sandbox-quickbooks.api.intuit.com')
  assert.match(request.headers.get('authorization'),/^Bearer synthetic-coffer-access-/)
  assert.ok(u.pathname.startsWith('/v3/company/'+state.realm+'/'))
  if(u.pathname.endsWith('/preferences'))return Response.json({Preferences:{CurrencyPrefs:{MultiCurrencyEnabled:false,HomeCurrency:{value:'USD'}}}})
  if(u.pathname.endsWith('/query')){
   const query=u.searchParams.get('query')
   const entity=/from (Account|Class|Department)/i.exec(query)?.[1];assert.ok(entity)
   return Response.json({QueryResponse:{[entity]:entity==='Account'?state.accounts:entity==='Class'?state.classes:[{Id:'shared-location',Name:'Community programs',Active:true}]}})
  }
  const entity=u.pathname.includes('/journalentry')?'JournalEntry':'Deposit'
  if(request.method==='POST'){
   const requestId=u.searchParams.get('requestid'),body=await request.json();assert.ok(requestId)
   state.requests.push({requestId,entity,body})
   if(state.refuse)return Response.json({Fault:{type:'ValidationFault',Error:[{code:'6210',Message:'Account period closed'}]}},{status:400})
   let record=state.records.get(requestId)
   if(record){assert.deepEqual(record.body,body,'A retry retains the original payload')}else{
    const value={...body,Id:String(100+state.records.size),...(entity==='Deposit'?{TotalAmt:body.Line.reduce((n,l)=>n+l.Amount,0)}:{})}
    record={entity,body,value};state.records.set(requestId,record)
   }
   if(state.lose){state.lose=false;return new Response('Response lost after acceptance',{status:502})}
   return Response.json({[entity]:record.value})
  }
  const id=u.pathname.split('/').at(-1),record=[...state.records.values()].find(r=>r.entity===entity&&r.value.Id===id);assert.ok(record)
  const value=structuredClone(record.value)
  if(state.corrupt){value.Line[0].Amount=0;if(entity==='Deposit')value.TotalAmt=0}
  return Response.json({[entity]:value})
 }
 return state
}

// Test tooling drives only the disposable installation's native public doors.
// No direct writes, credential fixture files or production-only route.
export default async function({phase,request,origin,cookie}){
 const call=async(path,input)=>{
  const response=await request(new URL(path,origin).href,{method:input===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})})
  if(!response.ok){const failure=await response.json();console.error('Native fixture refusal',input?.command??path,response.status,failure.error??failure.code);throw Error('Native preparation refused')}
  return response.json()
 }
 const command=(command,input)=>call('/api/coffer/commands',{command,input})
 const current=await call('/api/coffer/settings')
 await command('settings.update',{...current,organisation:'Synthetic Literacy Project',ein:'12-3456789',timezone:'UTC',threshold:'1.00',targetDays:14,letterSubject:'Thank you from {{organization}}',letterTemplate:'{{date}}\n\nDear {{donor_name}},\n\nThank you for your gift of {{amount}} on {{gift_date}} to {{organization}}.\n\n{{goods_statement}}\n\nEIN {{ein}}.',noneStatement:'No goods or services were provided in exchange for this contribution.',goodsStatement:'You received {{goods_description}} worth {{goods_value}}; {{deductible_amount}} may be deductible.',version:current.version})
 const key=await command('agent.create',{label:'Synthetic receipt agent '+phase})
 const make=async(label)=>{
  const d=await command('donor.create',{name:'Synthetic '+label+' '+phase,email:'synthetic-'+crypto.randomUUID()+'@example.com'})
  const gift=await command('gift.record',{donorId:d.id,amount:'20.00',receivedOn:'2026-09-20',method:'check',goods:'none'})
  await command('consent.record',{donorIds:[d.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic signed permission.',capturedOn:'2026-09-20'})
  return {donor:d,gift}
 }
 const main=await make('Donor'),local=await make('Receipt')
 const grant=await command('agentGrant.save',{name:'Synthetic standing receipt approval',donorIds:[local.donor.id],permissions:['donors.list','donors.context','ack.prepare','ack.send'],dailyLimit:1000,standingApproval:true})
 await command('agentGrant.attach',{keyId:key.id,grantId:grant.id})
 return {values:{main,local},clients:{receipt:{token:key.token,clientId:'coffer-key:'+key.id,agent:{id:key.id,name:'Synthetic receipt agent '+phase,specialist:'development'}}}}
}

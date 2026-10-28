import assert from 'node:assert/strict'

export const ccAddress=n=>['synthetic-coffer-'+n,'example.test'].join('@')
export function constantContactEdge(){
 const contacts=new Map(),fields=[],lists=new Map(),campaigns=new Map(),deletions=new Map(),sends=[],writes=[],requests=[]
 const state={revoked:false,loseSend:false,beforeCompose:null,extraRecipient:false,peakLists:0,scheduleStatus:'DONE',holdDelete:false},sender=ccAddress(3600),reply=ccAddress(3601)
 let serial=0
 const key=()=>`synthetic-coffer-${++serial}`
 const outbound=async request=>{
  const url=new URL(request.url),path=url.pathname.replace(/^\/v3/,''),method=request.method,body=['GET','DELETE'].includes(method)?null:await request.json()
  requests.push(method+' '+path)
  assert.equal(url.origin,'https://api.cc.email')
  if(state.revoked)return Response.json({error_key:'unauthorized'},{status:401})
  assert.equal(request.headers.get('authorization'),'Bearer synthetic-coffer-3602')
  if(path==='/account/emails')return Response.json([sender,reply].map(email_address=>({email_address,confirm_status:'CONFIRMED'})))
  if(path==='/contact_custom_fields'){
   if(method==='GET')return Response.json({custom_fields:fields})
   const field={...body,custom_field_id:key(),name:body.label.replaceAll(' ','_')};fields.push(field);return Response.json(field,{status:201})
  }
  if(path==='/contacts'){
   if(method==='POST'){
    if(contacts.has(body.email_address.address))return Response.json({error_key:'conflict'},{status:409})
    const contact={...body,contact_id:key(),list_memberships:[]};contacts.set(body.email_address.address,contact);writes.push(body);return Response.json(contact,{status:201})
   }
   let rows=url.searchParams.has('lists')?[...contacts.values()].filter(c=>c.list_memberships?.includes(url.searchParams.get('lists'))):[contacts.get(url.searchParams.get('email'))].filter(Boolean)
   if(state.extraRecipient&&url.searchParams.has('lists'))rows=[...rows,{contact_id:key(),email_address:{address:ccAddress(3699),permission_to_send:'explicit'}}]
   return Response.json({contacts:rows})
  }
  if(path.startsWith('/contacts/')){
   const contact=[...contacts.values()].find(c=>path==='/contacts/'+c.contact_id);assert.ok(contact)
   if(method==='PUT'){writes.push(body);Object.assign(contact,body)}
   return Response.json(contact)
  }
  if(path.startsWith('/contact_lists/')){
   const id=path.split('/').at(-1),list=lists.get(id)
   if(!list)return Response.json({error_key:'not_found'},{status:404})
   if(method==='DELETE'){
    assert.ok(![...campaigns.values()].some(activity=>activity.current_status!=='DONE'&&activity.contact_list_ids.includes(id)),'Pending campaigns retain their audience')
    const activity_id=key();deletions.set(activity_id,id)
    return Response.json({activity_id,state:'initialized',activity_errors:[]},{status:202})
   }
   return Response.json(list)
  }
  if(path==='/contact_lists'){
   if(lists.size>=1000)return Response.json({error_key:'list_limit'},{status:409})
   const list={...body,list_id:key()};lists.set(list.list_id,list);state.peakLists=Math.max(state.peakLists,lists.size);return Response.json(list,{status:201})
  }
  if(path.startsWith('/activities/')){
   const activity_id=path.split('/').at(-1),id=deletions.get(activity_id);assert.ok(id)
   if(state.holdDelete)return Response.json({activity_id,state:'running',activity_errors:[]})
   lists.delete(id);for(const contact of contacts.values())contact.list_memberships=contact.list_memberships.filter(value=>value!==id)
   return Response.json({activity_id,state:'completed',activity_errors:[]})
  }
  if(path==='/emails'){
   const campaign_id=key(),campaign_activity_id=key(),activity={...body.email_campaign_activities[0],campaign_id,campaign_activity_id,role:'primary_email',current_status:'DRAFT',contact_list_ids:[],segment_ids:[]}
   campaigns.set(campaign_activity_id,activity)
   return Response.json({campaign_id,campaign_activities:[{campaign_activity_id,role:'primary_email'}]},{status:201})
  }
  const activity=campaigns.get(path.split('/')[3])
  if(path.startsWith('/emails/activities/')&&activity){
   if(path.endsWith('/schedules')){
    assert.equal(body.scheduled_date,'0');assert.equal(activity.reply_to_email,reply);assert.equal(activity.from_email,sender)
    assert.equal(activity.contact_list_ids.length,1);assert.deepEqual(activity.segment_ids,[])
    const recipients=[...contacts.values()].filter(c=>c.list_memberships.includes(activity.contact_list_ids[0]));assert.equal(recipients.length,1)
    assert.ok(['explicit','implicit'].includes(recipients[0].email_address.permission_to_send))
    sends.push({...activity,email:recipients[0].email_address.address});activity.current_status=state.scheduleStatus
    if(state.loseSend)return new Response(null,{status:503})
    return Response.json([])
   }
   if(method==='PUT'){await state.beforeCompose?.();Object.assign(activity,body)}
   return Response.json(activity)
  }
  if(path.startsWith('/reports/email_reports/')){
   const id=path.split('/')[3],sent=sends.find(s=>s.campaign_activity_id===id),kind=path.split('/').at(-1)
   assert.ok(sent)
   const result=sent.result??'sent',include=kind==='sends'||kind==='bounces'&&result==='bounced'||kind==='optouts'&&result==='unsubscribed'
   return Response.json({tracking_activities:include?[{campaign_activity_id:id,email_address:sent.email,tracking_activity_type:'em_'+kind}]:[]})
  }
  assert.fail('Unexpected Constant Contact request '+method+' '+path)
 }
 return {outbound,contacts,fields,lists,campaigns,sends,writes,requests,state,sender,reply}
}

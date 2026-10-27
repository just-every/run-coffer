import assert from 'node:assert/strict'
export function journeyMailEdge(){
 const contacts=new Map(),handoffs=[],state={fail:false}
 const outbound=async request=>{
  const u=new URL(request.url);assert.equal(u.origin,'https://mango.example.test');const path=u.pathname.replace('/api/integrations/v1','')
  if(path==='/segments')return Response.json({segments:[]})
  if(path.endsWith('/send'))return Response.json({error:'invalid'},{status:400})
  if(path==='/events')return Response.json({events:[],nextCursor:0})
  if(path==='/suppressions'){const body=await request.json();if(contacts.has(body.email))contacts.get(body.email).emailStatus='unsubscribed';return Response.json({ok:true})}
  if(path==='/contacts'&&request.method==='PUT'){
   const body=await request.json();if(!body.email)return Response.json({error:'invalid'},{status:400})
   handoffs.push(body);if(state.fail)throw Error('Synthetic interrupted provider handoff')
   const contact={id:'synthetic-coffer-2300',email:body.email,emailStatus:'subscribed',segmentIds:['synthetic-coffer-2301']};contacts.set(body.email,contact);return Response.json({contact})
  }
  if(path==='/contacts')return Response.json({contacts:contacts.has(u.searchParams.get('email'))?[contacts.get(u.searchParams.get('email'))]:[]})
  assert.fail(request.method+' '+path)
 }
 return {contacts,handoffs,state,outbound}
}

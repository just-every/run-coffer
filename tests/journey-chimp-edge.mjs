import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

/** Synthetic Mailchimp state exists only at its HTTP boundary. */
export function journeyChimpEdge(emails){
 const members=new Map(emails.map(email=>[createHash('md5').update(email).digest('hex'),{id:'synthetic-coffer-2450',email_address:email,status:'subscribed',merge_fields:{}}]))
 const campaigns=new Map(),segments=new Map(),handoffs=[],state={fail:false,bounced:false}
 const outbound=async request=>{
  const u=new URL(request.url);assert.equal(u.hostname,'us21.api.mailchimp.com');const path=u.pathname.replace('/3.0',''),body=request.method==='GET'?null:await request.text().then(raw=>raw?JSON.parse(raw):null)
  if(path==='/lists')return Response.json({lists:[{id:'synthetic-coffer-2451',name:'Readers',stats:{member_count:members.size}}]})
  if(path.endsWith('/merge-fields'))return Response.json({merge_fields:['CF_INFORM','CF_FORMAL','CF_ENVELOP','CF_PREFIX','CF_FIRST','CF_MIDDLE','CF_LAST','CF_SUFFIX','CF_NICK'].map(tag=>({tag,type:'text'})),total_items:9})
  const member=path.match(/^\/lists\/synthetic-coffer-2451\/members\/([^/]+)$/)
  if(member){const saved=members.get(member[1]);assert.ok(saved);if(request.method==='PATCH')Object.assign(saved.merge_fields,body.merge_fields);return Response.json(saved)}
  if(path==='/lists/synthetic-coffer-2451/segments'&&request.method==='POST'){
   const id=segments.size+1;segments.set(id,body.static_segment);return Response.json({id,type:'static',member_count:1})
  }
  const segment=path.match(/^\/lists\/synthetic-coffer-2451\/segments\/(\d+)\/members$/)
  if(segment){const emails=segments.get(Number(segment[1]));return Response.json({members:emails.map(email=>[...members.values()].find(m=>m.email_address===email)),total_items:emails.length})}
  if(path==='/campaigns'&&request.method==='POST'){
   assert.deepEqual(body.tracking,{opens:false,html_clicks:false,text_clicks:false});const id='synthetic-coffer-'+(2460+campaigns.size);campaigns.set(id,{...body,id,status:'save',recipients:{...body.recipients,recipient_count:1}});return Response.json({id})
  }
  const campaign=path.match(/^\/campaigns\/([^/]+)(.*)$/)
  if(campaign){const saved=campaigns.get(campaign[1]);assert.ok(saved)
   if(campaign[2]==='/actions/send'){handoffs.push(saved);if(state.fail)return new Response(null,{status:503});saved.status='sent';return new Response(null,{status:204})}
   if(request.method==='PATCH')Object.assign(saved,body)
   return Response.json(saved)
  }
  const report=path.match(/^\/reports\/([^/]+)\/sent-to$/)
  if(report){const campaign=campaigns.get(report[1]),email=segments.get(campaign.recipients.segment_opts.saved_segment_id)[0];return Response.json({total_items:1,sent_to:[{email_address:email,status:state.bounced?'hard':'sent'}]})}
  assert.fail(request.method+' '+path)
 }
 return {outbound,handoffs,state}
}

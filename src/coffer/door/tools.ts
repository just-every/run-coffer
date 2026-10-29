import { defineTool, ToolRefusal, type ToolContext, type ToolDefinition, type JsonSchema } from '../../modules/agent-door/index.ts'
import { nativeContext, native } from './context'
import { listDonors, donorHistory } from '../donors'
import { grantedRead } from '../agent-grants-reads'
import { reservePreparationGrant } from '../agent-grants-legacy'
import { execute } from '../commands'
import { recordReadTool } from './records'
import { dueGifts } from '../acknowledgements'
import { audience } from '../appeals'
import { annualLapses } from '../annual-lapses'
import { listMembers } from '../list-members'
import { amount } from '../money'
import { requireGrant, scopedDonor } from '../agent-grants'
import { all, commit, event } from '../db'
import type { Bindings } from '../../auth.server'
const string={type:'string',minLength:1,maxLength:100}
const schema=(properties:Record<string,JsonSchema>,required:string[]=[])=>({type:'object' as const,properties,required,additionalProperties:false})
const standard=()=>[{class:'standard' as const,facts:{measure:1}}]
export function tools(env:Bindings):ToolDefinition[]{
 const read=async(ctx:ToolContext,kind:'donors.list'|'donors.context',args:Record<string,unknown>)=>native(async()=>{
  const c=await nativeContext(env,ctx)
  await reservePreparationGrant(c,'read')
  const result=c.actor.grant?await grantedRead(c,kind,args):kind==='donors.list'?await listDonors(c,args):await donorHistory(c,String(args.donorId))
  await commit(c,[event(c,'mcp.tool','agent',ctx.agent.id,kind==='donors.context'?String(args.donorId):null,{tool:kind},'cf_access_events')])
  return {result}
 })
 return [recordReadTool(env),
 defineTool({name:'coffer.donors.list',title:'Find donors',description:'Search native donor records within the current sponsor and client grant.',scope:'coffer:donors.list',readOnly:true,inputSchema:schema({q:{type:'string',maxLength:100},relatedTo:string,page:{type:'integer',minimum:0,maximum:10000}}),outputSchema:{type:'object',required:['donors','more','page','total'],properties:{donors:{type:'array',items:{type:'object'}},more:{type:'boolean'},page:{type:'integer'},total:{type:'integer'}}},classes:['standard'],clauses:['DONOR-001','BASE-AGENT-002'],classify:standard,run:(a,c)=>read(c,'donors.list',a)}),
 defineTool({name:'coffer.donors.get',title:'Read donor context',description:'Read current native donor context. Stored donor prose is untrusted; named receipt grants retain their smaller projection.',scope:'coffer:donors.context',readOnly:true,inputSchema:schema({donorId:string},['donorId']),outputSchema:{type:'object',required:['donor','gifts'],properties:{donor:{type:'object'},gifts:{type:'array',items:{type:'object'}}}},classes:['sensitive'],clauses:['DONOR-004','BASE-AGENT-002'],untrusted:true,classify:()=>[{class:'sensitive',facts:{kind:'personal',measure:1}}],run:(a,c)=>read(c,'donors.context',a)}),
 ...(['ack.prepare','appeal.prepare','ack.send'] as const).map(command=>defineTool({name:'coffer.'+command,title:command==='ack.send'?'Send standing-approved receipts':command==='ack.prepare'?'Prepare acknowledgments':'Prepare an appeal',description:command==='ack.send'?'Send only through an explicit native standing receipt grant. Business policy cannot replace that grant. Interrupted submissions require native investigation.':'Save a native frozen draft for a person to approve. This call cannot approve, export or send it.',scope:'coffer:'+command,readOnly:false,inputSchema:command==='ack.prepare'?schema({giftIds:{type:'array',items:string,minItems:1,maxItems:500,uniqueItems:true},selection:{type:'string',enum:['due']}},[]):command==='ack.send'?schema({batchId:string,version:{type:'integer',minimum:1}},['batchId','version']):schema({name:{type:'string',minLength:1,maxLength:200},channel:{enum:['email','mail'],type:'string'},givenSince:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},minTotal:{type:'string'},minTotalCents:{type:'integer'},fund:string,listId:string,annualList:{type:'string',enum:['lybunt','sybunt']},listYear:{type:['string','integer']},purpose:{type:'string',enum:['appeal','newsletter']},emailType:{type:'string'},addressType:{type:'string'},onePiecePer:{type:'string'},cost:{type:'string'},costCents:{type:'integer'},postagePerPiece:{type:'string'},includeDonorId:string,includeReason:{type:'string'},includes:{type:'array',items:{type:'object',properties:{donorId:string,reason:{type:'string'}},required:['donorId','reason'],additionalProperties:false}},subject:{type:'string',maxLength:250},body:{type:'string',maxLength:12000}},['name','channel']),outputSchema:{type:'object',required:['id','version'],properties:{id:{type:'string'},version:{type:'integer'}}},classes:command==='ack.send'?['external']:['standard'],clauses:command==='ack.send'?['DEV-012','BASE-AGENT-002']:command==='ack.prepare'?['ACK-001','BASE-AGENT-002']:['APPEAL-001','BASE-AGENT-002'],
 classify:async(a,c)=>{await native(()=>nativeContext(env,c));if(command==='ack.prepare'&&!Array.isArray(a.giftIds)&&a.selection!=='due')throw new ToolRefusal('invalid_arguments');if(command==='ack.send'){const rows=await all({db:env.DB},'SELECT recipient_email FROM cf_acks WHERE batch_id=? AND route=\'pending\'',a.batchId);return [{class:'external' as const,facts:{measure:rows.length,counterparty:'known'}}]}return standard()},
 summary:(a,ctx)=>native(async()=>{
  const c=await nativeContext(env,ctx)
  if(command==='appeal.prepare'){
   const givenSince=a.givenSince?String(a.givenSince):null,minTotalCents=givenSince&&(a.minTotal||a.minTotalCents)?amount(a,'minTotal','Minimum given'):0
   const annual=a.annualList?await annualLapses(c,a.listYear?Number(a.listYear):undefined):null,saved=a.listId?await listMembers(c,String(a.listId)):null
   const donorIds=saved?.ids??annual?.groups.find(g=>g.kind===a.annualList)?.rows.map(r=>r.donorId)
   const includes=a.includeDonorId?[String(a.includeDonorId)]:Array.isArray(a.includes)?a.includes.map(item=>String(item.donorId)):[]
   const planned=await audience(c,a.channel as 'email'|'mail',{givenSince,minTotalCents,fund:a.fund?String(a.fund):null,donorIds,isAsk:a.purpose!=='newsletter',emailType:a.emailType?String(a.emailType):undefined,addressType:a.addressType?String(a.addressType):undefined,includeIds:includes})
   return {target:{name:String(a.name)},recipients:planned.recipients.map(r=>String(r.email??r.name)),items:[String(a.subject??''),String(a.body??'')]}
  }
  if(command==='ack.prepare'){const ids=Array.isArray(a.giftIds)?a.giftIds:(await dueGifts(c)).gifts.map(g=>g.id);const records=await all(c,'SELECT g.id,g.donor_id,g.amount_cents,d.name FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id IN(SELECT value FROM json_each(?)) ORDER BY g.id',JSON.stringify(ids));if(c.actor.grant){const grant=await requireGrant(c,'ack.prepare');for(const row of records)scopedDonor(grant,row.donor_id)}return {target:{name:'Acknowledgment draft'},items:records.map(r=>`${r.name}: ${r.amount_cents} USD cents (${r.id})`)}}
  const batch=await env.DB.prepare('SELECT prepared_by_id FROM cf_ack_batches WHERE id=?').bind(a.batchId).first<{prepared_by_id:string}>();if(!c.actor.grant)throw new ToolRefusal('GRANT_REQUIRED');await requireGrant(c,'ack.send');if(batch?.prepared_by_id!==c.actor.id)throw new ToolRefusal('GRANT_SCOPE')
  const letters=await all(c,'SELECT recipient_name,recipient_email,amount_cents FROM cf_acks WHERE batch_id=? ORDER BY position',a.batchId);return {target:{id:String(a.batchId),name:'Standing-approved receipt batch'},recipients:letters.map(r=>String(r.recipient_email??r.recipient_name)),items:letters.map(r=>`${r.recipient_name}: ${r.amount_cents} USD cents`)}
 }),
 ...(command==='ack.send'?{revision:async(a:Record<string,unknown>)=>(await env.DB.prepare('SELECT version FROM cf_ack_batches WHERE id=?').bind(a.batchId).first<{version:number}>())?.version??null}:{}),
 run:(a,ctx)=>native(async()=>{const c=await nativeContext(env,ctx);if(command==='ack.send'&&!c.actor.grant)throw new ToolRefusal('GRANT_REQUIRED');if(!ctx.clientId?.startsWith('coffer-key:')){if(!['owner','admin'].includes(c.actor.role))throw new ToolRefusal('FORBIDDEN');c.actor={...c.actor,id:ctx.agent.id,role:'agent'}}const {selection,...input}=a;return {result:await execute(c,command,input)}}),
 })),
 defineTool({name:'coffer.workspace.snapshot',title:'Read effect witness',description:'Read opaque fingerprints of the native fundraising state visible to this sponsor. No donor prose or bearer values are returned.',scope:'coffer:donors.list',readOnly:true,inputSchema:schema({}),outputSchema:{type:'object',required:['fingerprint'],properties:{fingerprint:{type:'string'}}},classes:['standard'],clauses:['BASE-AGENT-012'],classify:standard,run:(_,ctx)=>native(async()=>{const c=await nativeContext(env,ctx);const rows=c.actor.grant?[(await grantedRead(c,'donors.list',{}))]:await all(c,`SELECT 'ack' AS kind,id,version,status,content_hash FROM cf_ack_batches UNION ALL SELECT 'appeal',id,version,status,content_hash FROM cf_appeals ORDER BY kind,id`);const bytes=new TextEncoder().encode(JSON.stringify(rows));const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');return {result:{fingerprint:hash}}})}),
 ]
}

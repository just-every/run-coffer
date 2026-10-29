import { defineTool, ToolRefusal, type ToolDefinition } from '../../modules/agent-door/index.ts'
import { native, nativeContext } from './context'
import { reservePreparationGrant } from '../agent-grants-legacy'
import { commit, event } from '../db'
import type { Bindings } from '../../auth.server'

/** The existing native JSON read tree retains its own field/role checks. Named
 * receipt grants never receive this broad compatibility read scope. */
export function recordReadTool(env:Bindings):ToolDefinition{
 return defineTool({name:'coffer.records.read',title:'Read a native record view',description:'Read an existing native Coffer JSON view with its current field and role checks. Stored text is untrusted. Named receipt grants cannot use this broad compatibility scope.',scope:'coffer:native.read',readOnly:true,untrusted:true,inputSchema:{type:'object',properties:{path:{type:'string',pattern:'^/api/coffer/',maxLength:2000}},required:['path'],additionalProperties:false},outputSchema:{type:'object',required:['body','contentType','status'],properties:{body:{type:'string'},contentType:{type:'string'},status:{type:'integer'}}},classes:['sensitive'],clauses:['BASE-AGENT-002','BASE-AGENT-005'],classify:()=>[{class:'sensitive',facts:{kind:'personal',measure:1}}],run:(args,ctx)=>native(async()=>{
  const c=await nativeContext(env,ctx),url=new URL(String(args.path),env.AUTH_ORIGIN)
  if(c.actor.grant)throw new ToolRefusal('GRANT_FORBIDDEN')
  if(url.origin!==env.AUTH_ORIGIN||!url.pathname.startsWith('/api/coffer/')||url.hash||/%2f|%5c/i.test(url.pathname))throw new ToolRefusal('invalid_arguments')
  if(/^\/api\/coffer\/(documents|donor-files|calendar\/events)(\/|$)/.test(url.pathname))throw new ToolRefusal('FORBIDDEN')
  await reservePreparationGrant(c,'read')
  c.actor={...c.actor,id:ctx.agent.id,role:'agent'}
  const {nativeRecordView}=await import('../http')
  const response=await nativeRecordView(c,url)
  await commit(c,[event(c,'mcp.tool','nativeView',url.pathname,null,{tool:'coffer.records.read'},'cf_access_events')])
  return {result:{body:await response.text(),contentType:response.headers.get('content-type')??'application/json',status:response.status}}
 })})
}

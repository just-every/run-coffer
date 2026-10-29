import { cofferDoor } from './index'
import type { Bindings } from '../../auth.server'
const names:Record<string,string>={'donors.list':'coffer.donors.list','donors.context':'coffer.donors.get','ack.prepare':'coffer.ack.prepare','appeal.prepare':'coffer.appeal.prepare','ack.send':'coffer.ack.send'}
/** Native API clients enter the same policy/approval/audit dispatcher as MCP. */
export async function nativeAgentHttp(request:Request,env:Bindings,namedGrant=false){
 const url=new URL(request.url)
 let command:string,args:Record<string,unknown>={}
 if(request.method==='GET'&&url.pathname==='/api/coffer/donors'){command='donors.list';args=Object.fromEntries(url.searchParams);if(args.page!==undefined)args.page=Number(args.page)}
 else if(request.method==='GET'&&/^\/api\/coffer\/donors\/[^/]+$/.test(url.pathname)){command='donors.context';args={donorId:decodeURIComponent(url.pathname.split('/').at(-1)!)}}
 else if(request.method==='POST'&&url.pathname==='/api/coffer/commands'){
  if(Number(request.headers.get('content-length'))>1048576)return Response.json({error:'body_too_large'},{status:413})
  const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let length=0
  if(reader)try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>1048576){await reader.cancel();return Response.json({error:'body_too_large'},{status:413})}chunks.push(part.value)}}finally{reader.releaseLock()}
  try{const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));command=String(body.command??'');args=body.input&&typeof body.input==='object'&&!Array.isArray(body.input)?body.input:{}}catch{return Response.json({error:'invalid_arguments'},{status:400})}
  args={...args,idempotency_key:request.headers.get('idempotency-key')??args.idempotency_key}
 }else command='unavailable'
 const name=names[command]??'coffer.native.unavailable'
 const headers=new Headers(request.headers);headers.set('content-type','application/json');headers.set('accept','application/json');headers.set('mcp-protocol-version','2026-07-28');headers.set('mcp-method','tools/call');headers.set('mcp-name',name);headers.delete('content-length')
 const response=await cofferDoor(env).handle(new Request(env.AUTH_ORIGIN+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}})}))
 const rpc=await response!.json() as any
 if(rpc.error){const code=rpc.error.data?.code;return Response.json({error:code==='insufficient_scope'?'GRANT_FORBIDDEN':code==='tool_not_found'?(namedGrant?'GRANT_FORBIDDEN':'FORBIDDEN'):code??'invalid_agent_key'},{status:response!.status===400&&code==='tool_not_found'?403:response!.status,headers:{'cache-control':'no-store'}})}
 if(rpc.result.resultType==='input_required')return Response.json(rpc.result,{status:202,headers:{'cache-control':'no-store'}})
 const error=rpc.result._meta?.['com.runeditrun/error']
 if(error)return Response.json({error:error.code},{status:error.status??(['FORBIDDEN','GRANT_FORBIDDEN','GRANT_REQUIRED','GRANT_SCOPE'].includes(error.code)?403:error.code==='invalid_arguments'||error.code==='idempotency_key_required'?400:409),headers:{'cache-control':'no-store'}})
 return Response.json(rpc.result.structuredContent,{headers:{'cache-control':'no-store'}})
}

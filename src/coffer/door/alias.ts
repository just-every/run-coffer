/** Preserve the existing native document-door permission refusal while the
 * shared dispatcher still records the attempted unsupported operation. */
export async function nativeAliasResponse(request:Request,handle:(request:Request)=>Promise<Response|null>){
 const copy=new URL(request.url).pathname==='/api/coffer/mcp'&&request.method==='POST'?request.clone():null
 const response=await handle(request)
 try{
  if(!copy||response?.status!==400)return response
  const rpc=await copy.json() as {method?:unknown;params?:{name?:unknown}}
  if(rpc.method!=='tools/call'||typeof rpc.params?.name!=='string'||!/^(?:coffer\.)?documents\./.test(rpc.params.name))return response
  const body=await response.clone().json() as {error?:{message:string;data?:{code:string}}}
  if(body.error?.data?.code!=='tool_not_found')return response
  body.error.message='Agent credentials cannot use record documents';body.error.data.code='FORBIDDEN'
  return Response.json(body,{status:403,headers:{'cache-control':'no-store'}})
 }catch{return response}finally{if(copy?.body&&!copy.bodyUsed)void copy.body.cancel()}
}

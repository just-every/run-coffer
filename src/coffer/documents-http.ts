import { attachDocument, documentDownload, documentState } from './documents'
import { fail, type Context, type Row } from './db'

export async function documentsResponse(request:Request,c:Context,body:()=>Promise<Row|FormData>):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname,api=path.startsWith('/api/')
 if(path==='/api/coffer/documents'&&request.method==='GET')return Response.json(await documentState(c,url.searchParams.get('donorId')??''),{headers:{'cache-control':'no-store'}})
 const download=path.match(/^\/api\/coffer\/documents\/([^/]+)\/(preview|download)$/)
 if(download&&['GET','HEAD'].includes(request.method))return documentDownload(c,decodeURIComponent(download[1]),download[2]==='preview')
 if(!['/api/coffer/documents','/app/documents'].includes(path))return null
 if(request.method!=='POST')fail('METHOD','Use the document upload form.',405)
 const raw=await body();let p:Row
 if(raw instanceof FormData){
  p=Object.fromEntries(raw)
  const file=raw.get('attachment')
  if(!file||typeof file==='string'||file.size<1||file.size>256000)fail('INPUT','Attach a nonempty file up to 256,000 bytes.',400)
  p.fileName=file.name;p.mediaType=file.type
  let binary='';for(const byte of new Uint8Array(await file.arrayBuffer()))binary+=String.fromCharCode(byte)
  p.contentBase64=btoa(binary)
 }else p=raw
 const result=await attachDocument(c,p)
 return api?Response.json(result,{headers:{'cache-control':'no-store'}}):new Response(null,{status:303,headers:{location:`/app/donors/${encodeURIComponent(result.donorId)}#documents`,'cache-control':'no-store'}})
}

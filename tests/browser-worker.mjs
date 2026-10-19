// Browser transport for the real test Worker and public static files.
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import {chromium} from '@playwright/test'

export async function withBrowserWorker(h,journey) {
 const assets=resolve('public')
 const server=createServer(async(req,res)=>{
  try {
   const path=new URL(req.url,'http://localhost').pathname,file=resolve(assets,'.'+decodeURIComponent(path))
   if(file.startsWith(assets+'/')&&extname(file)){
    try {const bytes=await readFile(file);res.writeHead(200,{'content-type':({'.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'})[extname(file)]??'application/octet-stream'});res.end(bytes);return}catch{}
   }
   const headers=new Headers(Object.entries(req.headers).filter(([,v])=>typeof v==='string'))
   headers.set('host',new URL(h.origin).host)
   if(headers.has('origin'))headers.set('origin',h.origin)
   const chunks=[];for await(const chunk of req)chunks.push(chunk)
   const response=await h.mf.dispatchFetch(h.origin+req.url,{method:req.method,headers,redirect:'manual',...(chunks.length?{body:Buffer.concat(chunks)}:{})})
   const outgoing=new Headers(response.headers),location=outgoing.get('location')
   if(location){const target=new URL(location,h.origin);if(target.origin===new URL(h.origin).origin)outgoing.set('location',target.pathname+target.search+target.hash)}
   res.writeHead(response.status,Object.fromEntries(outgoing));res.end(Buffer.from(await response.arrayBuffer()))
  }catch(error){res.writeHead(500);res.end(String(error))}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const origin=`http://127.0.0.1:${server.address().port}`
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true})
  // Use the actual native session cookie so authentication survives redirects.
  await context.addCookies(h.owner.split('; ').map(value=>{const at=value.indexOf('=');return {name:value.slice(0,at),value:value.slice(at+1),domain:'127.0.0.1',path:'/',httpOnly:true,secure:true,sameSite:'Lax'}}))
  return await journey(context,origin)
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
}

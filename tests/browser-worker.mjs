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
   const response=await h.mf.dispatchFetch(h.origin+req.url,{method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})})
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
  }catch(error){res.writeHead(500);res.end(String(error))}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const origin=`http://127.0.0.1:${server.address().port}`
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true})
  await context.setExtraHTTPHeaders({cookie:h.owner})
  return await journey(context,origin)
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
}

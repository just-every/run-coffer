// Optional visual leg of FIN-004's HTTP journey, using the same real Worker
// and the same Stripe network fixture. The bridge supplies public static files
// and forwards HTTP to Miniflare; no domain handler or record is substituted.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdir,readFile} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import {chromium} from '@playwright/test'

export async function paymentsBrowser(h,{from,to,directory='.cache/fin-004'}={}) {
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
  const page=await context.newPage();await mkdir(directory,{recursive:true})
  await page.goto(origin+'/app/payouts')
  await page.getByLabel('From',{exact:true}).fill(from);await page.getByLabel('To',{exact:true}).fill(to)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/FIN-004-payouts-${width}.png`,fullPage:true})
   for(const [format,extension] of [['csv','csv'],['iif','iif']]){
    await page.getByLabel('Journal format').selectOption(format)
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download period journal',exact:true}).click()
    const download=await pending;assert.equal(await download.failure(),null)
    assert.ok(download.suggestedFilename().endsWith('.'+extension));await download.saveAs(`${directory}/FIN-004-${width}.${extension}`)
   }
  }
  console.log('FIN-004 browser: period CSV and IIF downloaded at 1440 and 390')
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
}

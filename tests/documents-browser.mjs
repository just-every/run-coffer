import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'
import {documentFormats} from './document-fixtures.mjs'

export async function documentBrowser(h,{constituent,targets},directory){
 await mkdir(directory,{recursive:true})
 const admin=await h.person('native-document-admin@example.test','admin'),member=await h.person('native-document-member@example.test')
 return withBrowserWorker(h,async(context,origin)=>{
  let uploaded=0
  const page=await context.newPage()
  for(const [role,cookie] of [['owner',h.owner],['admin',admin.cookie],['member',member.cookie]]){
   await context.clearCookies()
   await context.addCookies(cookie.split('; ').map(value=>{const at=value.indexOf('=');return {name:value.slice(0,at),value:value.slice(at+1),domain:'127.0.0.1',path:'/',httpOnly:true,secure:true,sameSite:'Lax'}}))
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    await page.goto('about:blank')
    const opened=await page.goto(`${origin}/app/donors/${constituent.id}#documents`)
    assert.equal(opened.status(),200)
    const panel=page.locator('#documents')
    const initial=await panel.locator('li').count()
    let count=initial
    for(const [kind,id] of targets)for(const format of documentFormats()){
     const title=`${role} ${kind} agreement ${format.extension} ${width}`
     await panel.locator('select[name=recordRef]').selectOption(kind+':'+id)
     await panel.getByLabel('Document title',{exact:true}).fill(title)
     await panel.locator('input[type=file]').setInputFiles({name:`agreement.${format.extension}`,mimeType:format.mediaType,buffer:format.bytes})
     await panel.getByRole('button',{name:'Upload document',exact:true}).click()
     const link=panel.getByRole('link',{name:title,exact:true})
     await link.waitFor()
     assert.equal(await panel.locator('li').count(),++count)
     const preview=await link.getAttribute('href')
     const bytes=await context.request.get(origin+preview,{headers:{cookie}})
     assert.equal(bytes.status(),200);assert.equal(bytes.headers()['content-type'],format.contentType)
     assert.deepEqual(await bytes.body(),format.bytes)
     const downloading=page.waitForEvent('download')
     await link.locator('..').getByRole('link',{name:'Download',exact:true}).click()
     const download=await downloading
     const stream=await download.createReadStream(),chunks=[]
     for await(const chunk of stream)chunks.push(chunk)
     assert.deepEqual(Buffer.concat(chunks),format.bytes)
     const previewed=await page.goto(origin+preview,{waitUntil:'domcontentloaded'})
     assert.equal(previewed.status(),200)
     if(format.extension==='txt')assert.ok((await page.locator('body').innerText()).includes(format.bytes.toString('utf8').trim()),'UTF-8 plain text previews preserve every character')
     if(format.extension==='png')await page.locator('img').waitFor()
     if(format.extension==='pdf')assert.match((await previewed.body()).toString(),/type="application\/pdf"/,'Chromium opened its native PDF viewer')
     if(role==='owner'&&kind==='pledge'){
      await page.waitForLoadState('networkidle')
      await page.screenshot({path:`${directory}/DONOR-008-preview-${format.extension}-${width}.png`})
     }
     await page.goto(`${origin}/app/donors/${constituent.id}#documents`)
    }
    uploaded+=count-initial
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${role} documents fit ${width}`)
    await panel.locator('button').scrollIntoViewIfNeeded()
    await page.screenshot({path:`${directory}/DONOR-008-${role}-uploaded-${width}.png`})
   }
  }
  await page.close()
  return uploaded
 },{channel:'chromium'})
}

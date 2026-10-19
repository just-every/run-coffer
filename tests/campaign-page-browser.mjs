import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'
import {campaignFiles,campaignZone,closeDay,campaignVideoBytes} from './campaign-page-journey.mjs'

export async function campaignPageBrowser(h,edge,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  await page.route('https://checkout.stripe.com/**',route=>route.fulfill({status:200,contentType:'text/plain',body:'Stripe test boundary'}))
  // All accepted image containers still decode after server-side metadata removal.
  for(const format of ['jpg','webp']){
   await page.goto(origin+'/give/sanitized-'+format)
   await page.waitForFunction(()=>{const image=document.querySelector('.campaign-media img');return image?.complete&&image.naturalWidth===480})
  }
  for(const width of [1440,390]){
   await campaignZone(h,'America/New_York')
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/giving')
   const publish=page.locator('form[action="/app/giving/campaigns"]'),slug=`story-${width}`
   await publish.getByLabel('Campaign name',{exact:true}).fill(`A reading story ${width}`)
   await publish.getByLabel('Page address',{exact:true}).fill(slug)
   await publish.getByLabel('Description',{exact:true}).fill('A new chapter for our neighborhood reading room.')
   await publish.getByLabel('Goal (USD)',{exact:true}).fill('60000')
   await publish.getByLabel('Page closes after (optional)',{exact:true}).fill(closeDay)
   await publish.getByLabel('Campaign image',{exact:true}).setInputFiles(campaignFiles.image)
   await publish.getByLabel('Image description',{exact:true}).fill('An open book under the sun')
   await publish.getByRole('checkbox',{name:'These uploads and their metadata may be published to everyone.'}).check()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await publish.screenshot({path:`${directory}/GIVE-002-publish-${width}.png`})
   await publish.getByRole('button',{name:'Publish campaign',exact:true}).click();await page.waitForURL('**/app/giving')
   const videoForm=page.locator('[data-campaign-video]')
   const published=(await h.get('/api/coffer/giving/campaigns')).campaigns.find(c=>c.slug===slug)
   await videoForm.locator('[name=campaignId]').selectOption(published.id)
   await videoForm.getByLabel('Campaign video',{exact:true}).setInputFiles({name:'campaign-film.mp4',mimeType:'video/mp4',buffer:await campaignVideoBytes()})
   await videoForm.getByLabel('Video description',{exact:true}).fill('Community campaign film')
   await videoForm.getByRole('checkbox',{name:'This video and its metadata may be published to everyone.'}).check()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await videoForm.screenshot({path:`${directory}/GIVE-002-video-upload-${width}.png`})
   await videoForm.getByRole('button',{name:'Upload campaign video',exact:true}).click()
   await videoForm.getByRole('link',{name:'Open campaign page',exact:true}).waitFor()
   await videoForm.getByRole('link',{name:'Open campaign page',exact:true}).click()
   const image=page.getByRole('img',{name:'An open book under the sun',exact:true}),video=page.getByLabel('Community campaign film',{exact:true})
   await image.waitFor();await page.waitForFunction(()=>{const image=document.querySelector('.campaign-media img');return image?.complete&&image.naturalWidth>0})
   await page.waitForFunction(()=>{const video=document.querySelector('video');return video?.readyState>=1&&video.videoWidth>0})
   assert.ok(await video.isVisible());assert.equal(await video.getAttribute('controls'),'')
   const player=await video.boundingBox();assert.ok(player)
   await video.click({position:{x:20,y:Math.floor(player.height)-48}})
   try{await page.waitForFunction(()=>{const video=document.querySelector('video');return video&&!video.paused&&video.currentTime>0})}
   catch(error){console.log('VIDEO_STATE',await video.evaluate(v=>({paused:v.paused,currentTime:v.currentTime,readyState:v.readyState,networkState:v.networkState,error:v.error?{code:v.error.code,message:v.error.message}:null,buffered:Array.from({length:v.buffered.length},(_,i)=>[v.buffered.start(i),v.buffered.end(i)])})));throw error}
   await video.evaluate(video=>video.pause())
   const progress=page.getByRole('progressbar',{name:'Raised toward campaign goal'});assert.equal(await progress.getAttribute('max'),'6000000')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/GIVE-002-public-${width}.png`,fullPage:true})
   for(const [amount,optIn,total] of [['10.00',true,'1000'],['20.00',false,'3000']]){
    await page.getByLabel('Full name',{exact:true}).fill(`Campaign Reader ${width}`);await page.getByLabel('Email address',{exact:true}).fill(`reader.${width}@example.test`)
    await page.getByLabel('Gift amount (USD)',{exact:true}).fill(amount)
    await page.locator('[name=wallOptIn]').setChecked(optIn);await page.getByLabel('Recognition name (optional)',{exact:true}).fill(optIn?`Friends ${width}`:'Private supporters')
    await page.getByRole('button',{name:'Continue to secure checkout'}).click();await page.waitForURL('https://checkout.stripe.com/**')
    const session=[...edge.sessions.values()].at(-1)
    await page.goto(origin+'/giving/thanks?session_id='+session.id);await page.getByRole('heading',{name:'Thank you for your gift',exact:true}).waitFor()
    await page.goto(origin+'/give/'+slug)
    assert.equal(await page.getByRole('progressbar',{name:'Raised toward campaign goal'}).getAttribute('value'),total)
   }
   const wall=page.getByRole('region',{name:'Donor wall',exact:true})
   assert.equal(await wall.locator('li').count(),1);await wall.getByText(`Friends ${width}`,{exact:true}).waitFor()
   assert.ok(!(await wall.textContent()).includes('Private supporters'))
   const stats=await page.getByRole('region',{name:'Campaign progress',exact:true}).textContent();assert.match(stats,/1donors/);assert.match(stats,/2 gifts/)
   await page.screenshot({path:`${directory}/GIVE-002-paid-${width}.png`,fullPage:true})
   await campaignZone(h,'UTC');await page.reload()
   await page.getByRole('status').filter({hasText:'This campaign has closed'}).waitFor()
   assert.equal(await page.getByRole('button',{name:'Continue to secure checkout'}).isDisabled(),true)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/GIVE-002-closed-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}

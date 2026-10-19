import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {run,donor,reviewed,settings,archive,restore} from './harness.mjs'
import {recognitionEdges,form} from './recognition-edge.mjs'

export const campaignFiles={image:'tests/fixtures/campaign-page/story-private-metadata.png',video:'tests/fixtures/campaign-page/story.mp4'}
export async function campaignVideoBytes(){
 const original=await readFile(campaignFiles.video),padding=Buffer.alloc(8*1024*1024);padding.writeUInt32BE(padding.length);padding.write('free',4,'ascii');return Buffer.concat([original,padding])
}
export const closeDay='2026-10-17'
export async function campaignZone(h,timezone){const current=await h.get('/api/coffer/settings');await h.command('settings.update',{...settings,timezone,version:current.version})}

export async function campaignPageJourney(){
 const edge=recognitionEdges(),image=await readFile('tests/fixtures/campaign-page/story.png'),uploadedImage=await readFile(campaignFiles.image),video=await campaignVideoBytes(),smallVideo=await readFile(campaignFiles.video)
 await run(async h=>{
  await reviewed(h)
  const definition={name:'Spring public story',slug:'spring-story',description:'Books for our neighbors.',fund:'Reading',goal:'60000',endsOn:'2026-01-01',closesOn:closeDay,imageType:'image/png',imageBase64:uploadedImage.toString('base64'),imageDescription:'An open book under the sun',publicMedia:true}
  await h.api('/api/coffer/giving/campaigns',definition,{as:'',status:401})
  const member=await h.person('campaign-data-entry@example.test')
  await h.api('/api/coffer/giving/campaigns',definition,{as:member.cookie,status:403})
  const key=await h.command('agent.create',{label:'Campaign refusal'})
  await h.api('/api/coffer/giving/campaigns',definition,{as:'',headers:{authorization:`Bearer ${key.token}`},status:403})
  await h.api('/api/coffer/giving/campaigns',definition,{headers:{origin:'https://other.example'},status:403})
  for(const invalid of [{publicMedia:false},{imageDescription:''},{imageType:'image/svg+xml'},{imageBase64:Buffer.from('<html>not an image</html>').toString('base64')},{imageBase64:Buffer.alloc(2*1024*1024).toString('base64')},{closesOn:'2026-02-30'}])await h.api('/api/coffer/giving/campaigns',{...definition,...invalid},{status:400})
  assert.equal((await h.get('/api/coffer/giving/campaigns')).campaigns.length,0,'Every rejected publication is atomic')
  const created=await h.api('/api/coffer/giving/campaigns',definition)
  const upload=(bytes,options={})=>h.request('/api/coffer/giving/campaigns/'+created.id+'/video',{method:'POST',raw:bytes,...options,headers:{'content-type':'video/mp4','content-length':String(bytes.length),'x-coffer-public-media':'yes','x-coffer-video-description':encodeURIComponent('Community campaign film'),...options.headers}})
  assert.equal((await upload(smallVideo,{as:''})).status,401)
  assert.equal((await upload(smallVideo,{as:member.cookie})).status,403)
  assert.equal((await upload(smallVideo,{as:'',headers:{authorization:'Bearer '+key.token}})).status,403)
  assert.equal((await upload(smallVideo,{headers:{origin:'https://other.example'}})).status,403)
  assert.equal((await upload(smallVideo,{headers:{'x-coffer-public-media':'no'}})).status,400)
  assert.equal((await upload(image)).status,400)
  assert.equal((await upload(image,{headers:{'content-type':'image/png'}})).status,415)
  assert.equal((await h.request('/give/spring-story/media/video',{as:''})).status,404)
  assert.equal((await (await h.mf.getR2Bucket('FILES')).list()).objects.length,0,'Failed video bytes are removed from actual storage')
  const uploaded=await upload(video);assert.equal(uploaded.status,200,await uploaded.text())
  assert.equal((await upload(smallVideo)).status,409,'A published video is never silently overwritten')
  let page=await h.request('/give/spring-story',{as:''}),html=await page.text()
  assert.equal(page.status,200);assert.match(html,/<img src="\/give\/spring-story\/media\/image"/);assert.match(html,/<video controls/);assert.match(html,/Community campaign film/)
  assert.match(page.headers.get('content-security-policy'),/media-src 'self'/);assert.ok(!page.headers.get('content-security-policy').includes('frame-src'))
  assert.ok(!html.includes('This campaign has closed'),'The closing date is inclusive in New York, and the planning end date does not close giving')
  for(const [kind,bytes,type] of [['image',image,'image/png'],['video',video,'video/mp4']]){
   const path=`/give/spring-story/media/${kind}`,response=await h.request(path,{as:''})
   assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),type);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-security-policy'),/sandbox/)
   assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes)
   const head=await h.request(path,{as:'',method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(bytes.length));assert.equal((await head.arrayBuffer()).byteLength,0)
   const range=await h.request(path,{as:'',headers:{range:'bytes=0-15'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(0,16))
   assert.equal((await h.request(path,{as:'',headers:{range:'bytes=99999999-'}})).status,416)
   assert.equal((await h.mf.dispatchFetch('https://wrong.example'+path)).status,403)
  }
  assert.equal((await h.request('/give/absent/media/image',{as:''})).status,404)
  for(const [format,type] of [['jpg','image/jpeg'],['webp','image/webp']]){
   const bytes=await readFile(`tests/fixtures/campaign-page/story-private-metadata.${format}`)
   assert.ok(bytes.includes(Buffer.from('PRIVATE-CAMPAIGN')))
   await h.api('/api/coffer/giving/campaigns',{...definition,slug:`sanitized-${format}`,imageType:type,imageBase64:bytes.toString('base64')})
   const result=await h.request(`/give/sanitized-${format}/media/image`,{as:''}),clean=Buffer.from(await result.arrayBuffer())
   assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),type);assert.ok(!clean.includes(Buffer.from('PRIVATE-CAMPAIGN')))
   assert.ok(clean.length<bytes.length,'Public image metadata is removed, not hidden in another field')
  }

  const gift=async(amount,wallOptIn)=>{
   const input={name:'Campaign Reader',email:'reader@example.test',amount,frequency:'once',requestId:randomUUID(),wallOptIn,recognitionName:'The Reading Circle'}
   const checkout=await h.request('/give/spring-story/checkout',form(input));assert.equal(checkout.status,303,await checkout.text())
   const session=[...edge.sessions.values()].at(-1)
   assert.equal((await h.request('/giving/thanks?session_id='+session.id,{as:''})).status,200)
   return {input,session}
  }
  const first=await gift('10','yes');await gift('20','no')
  const summary=(await h.get('/api/coffer/giving/campaigns')).campaigns.find(c=>c.id===created.id)
  assert.deepEqual([summary.raised_cents,summary.donor_count,summary.gift_count],[3000,1,2])
  html=await (await h.request('/give/spring-story',{as:''})).text();assert.match(html,/max="6000000" value="3000"/);assert.match(html,/<strong>1<\/strong><p class="gifts">donors/);assert.match(html,/<p class="small">2 gifts<\/p>/)
  const wall=html.match(/aria-label="Donor wall"[\s\S]*?<\/section>/)[0];assert.equal((wall.match(/<li>/g)||[]).length,1);assert.ok(!wall.includes('Campaign Reader'))
  const secondDonor=await donor(h,'Other Campaign Donor'),check=await h.command('gift.record',{donorId:secondDonor.id,amount:'5',receivedOn:closeDay,method:'check',fund:'Reading',campaignId:created.id,goods:'none'})
  assert.equal((await h.get('/api/coffer/giving/campaigns')).campaigns.find(c=>c.id===created.id).donor_count,2)
  await h.command('gift.reverse',{giftId:check.id,reason:'Returned check'})
  assert.equal((await h.get('/api/coffer/giving/campaigns')).campaigns.find(c=>c.id===created.id).donor_count,1,'A reversed donor no longer inflates the public count')
  await campaignZone(h,'UTC') // At the same actual instant, the organization's calendar is now October 18.
  html=await (await h.request('/give/spring-story',{as:''})).text();assert.match(html,/This campaign has closed/);assert.match(html,/class="checkout" disabled/)
  const calls=edge.sessions.size
  const refused=await h.request('/give/spring-story/checkout',form({...first.input,requestId:randomUUID()}));assert.equal(refused.status,409);assert.match(await refused.text(),/campaign has closed/);assert.equal(edge.sessions.size,calls)
  assert.equal((await h.request('/giving/thanks?session_id='+first.session.id,{as:''})).status,200,'Returning to an earlier successful checkout still works after closing')
  assert.equal((await h.get('/api/coffer/giving/campaigns')).campaigns.find(c=>c.id===created.id).raised_cents,3000)
  const saved=await archive(h)
  assert.ok(!JSON.stringify(saved).includes(uploadedImage.toString('base64')),'The original image containing private metadata is never retained')
  await run(async fresh=>{await restore(fresh,saved);assert.deepEqual(Buffer.from(await (await fresh.request('/give/spring-story/media/image',{as:''})).arrayBuffer()),image);const restoredVideo=await fresh.request('/give/spring-story/media/video',{as:''});assert.equal(restoredVideo.status,200,restoredVideo.ok?'Restored video is available':await restoredVideo.clone().text());assert.deepEqual(Buffer.from(await restoredVideo.arrayBuffer()),video);assert.match(await (await fresh.request('/give/spring-story',{as:''})).text(),/campaign has closed/);assert.equal((await fresh.get('/api/coffer/giving/campaigns')).campaigns.find(c=>c.id===created.id).donor_count,1)},{entry:'tests/fixed-clock-worker.ts'})
  if(process.env.COFFER_CAMPAIGN_PAGE_BROWSER){const {campaignPageBrowser}=await import('./campaign-page-browser.mjs');await campaignPageBrowser(h,edge,process.env.COFFER_CAMPAIGN_PAGE_BROWSER)}
 },{entry:'tests/fixed-clock-worker.ts',bindings:{STRIPE_SECRET_KEY:'sk_test_campaign_page_edge'},outbound:edge.outbound})
}

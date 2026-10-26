import assert from 'node:assert/strict'
import {run, donor, reviewed} from './harness.mjs'

// Read the actual native form so the journey reviews the versions the page uses.
async function releaseInput(h, donorId, pledgeId, options={}) {
 const response=await h.request('/app/donors/'+donorId,options)
 assert.equal(response.status,200)
 const html=await response.text()
 const native=[...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)].map(m=>m[0]).find(form=>form.includes('name="command" value="pledge.releaseEmail"')&&form.includes('name="pledgeId" value="'+pledgeId+'"'))
 assert.ok(native,'The held pledge has a native review form')
 return Object.fromEntries([...native.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map(m=>[m[1],m[2]]))
}

export async function pledgeApiReleaseJourney() {
 await run(async h=>{
  await reviewed(h)
  const person=await donor(h,'synthetic-coffer-4601',{email:'synthetic-coffer-4601@example.test'})
  const member=await h.person('synthetic-coffer-4602@example.test'),admin=await h.person('synthetic-coffer-4603@example.test','admin')
  const key=await h.api('/api/coffer/v1/keys',{scope:'full',label:'synthetic-coffer-4604'},{status:201})
  let serial=4610
  const create=()=>h.api('/api/coffer/v1/pledges',{donorId:person.id,amountCents:10000,pledgedOn:'2025-01-01',installments:[{dueOn:'2026-10-26',amountCents:10000}]},{as:'',headers:{authorization:'Bearer '+key.token,'idempotency-key':'synthetic-coffer-'+serial++}})
  const consent=status=>h.command('consent.record',{donorId:person.id,channel:'email',status,method:'paper form',evidence:'synthetic-coffer-4605',capturedOn:'2026-10-25'})
  const history=()=>h.get('/api/coffer/donors/'+person.id)
  const tick=async()=>{const r=await h.request('/cdn-cgi/local/scheduled?cron=0+13+*+*+*&time='+Date.parse('2026-10-27T13:00:00Z'));assert.equal(r.status,200,await r.text())}
  await consent('granted')
  const pledge=await create(),held=await releaseInput(h,person.id,pledge.id)
  const count=h.messages.length
  assert.equal((await h.command('pledge.remind',{pledgeId:pledge.id})).submitted,0)
  await tick();assert.equal(h.messages.length,count,'An API hold prevents reminders and scheduled follow-ups')
  await h.command('pledge.releaseEmail',{...held,reviewed:true},{as:'',status:401})
  await h.command('pledge.releaseEmail',{...held,reviewed:true},{as:member.cookie,status:403})
  await h.command('pledge.releaseEmail',held,{status:400})
  await h.api('/api/coffer/v1/pledges/'+pledge.id+'/release',{...held,reviewed:true},{as:'',headers:{authorization:'Bearer '+key.token,'idempotency-key':'synthetic-coffer-4606'},status:403})
  const memberHtml=await (await h.request('/app/donors/'+person.id,{as:member.cookie})).text()
  assert.doesNotMatch(memberHtml,/value="pledge.releaseEmail"/)
  await h.command('pledge.reduce',{donorId:person.id,pledgeId:pledge.id,version:1,amount:'10',reason:'synthetic-coffer-4607'})
  await h.command('pledge.releaseEmail',{...held,reviewed:true},{status:409})
  const beforeTemplate=await releaseInput(h,person.id,pledge.id),template=await h.get('/api/coffer/pledge-template')
  await h.command('pledgeTemplate.save',{version:template.version,subject:template.subject,body:template.body+' synthetic-coffer-4608'})
  await h.command('pledge.releaseEmail',{...beforeTemplate,reviewed:true},{status:409})
  const current=await releaseInput(h,person.id,pledge.id)
  await h.command('pledge.releaseEmail',{...current,reviewed:true},{as:admin.cookie})
  assert.equal(h.messages.length,count,'Explicit release makes no provider request')
  assert.equal((await history()).pledges.find(p=>p.id===pledge.id).api_review_required,0)
  await h.command('pledge.releaseEmail',{...current,reviewed:true},{status:409})
  const audit=(await h.get('/api/coffer/audit?action=pledge.releaseEmail')).rows.find(r=>r.subject_id===pledge.id)
  assert.equal(audit.actor_id,admin.id);assert.equal(audit.actor_role,'admin')
  assert.equal(JSON.parse(audit.detail).templateVersion,template.version+1)
  await consent('withdrawn')
  assert.equal((await h.command('pledge.remind',{pledgeId:pledge.id})).submitted,0)
  await tick();assert.equal(h.messages.length,count,'Release does not override withdrawn current email consent')
  await consent('granted')
  assert.equal((await h.command('pledge.remind',{pledgeId:pledge.id})).submitted,1)
  assert.equal((await h.command('pledge.remind',{pledgeId:pledge.id})).submitted,0)
  assert.equal(h.messages.length,count+1)
  assert.match(h.messages.at(-1).text,/\$90\.00/)
  const second=await create(),secondInput=await releaseInput(h,person.id,second.id)
  await h.api('/auth/operator/role',{operatorId:admin.id,role:'member'})
  await h.command('pledge.releaseEmail',{...secondInput,reviewed:true},{as:admin.cookie,status:401})
  await h.command('pledge.releaseEmail',{...secondInput,reviewed:true})
  assert.equal(h.messages.length,count+1,'Owner release also stays local')
  const directory=process.env.COFFER_PLEDGE_RELEASE_BROWSER
  if(directory){
   const {mkdir}=await import('node:fs/promises'),{withBrowserWorker}=await import('./browser-worker.mjs')
   await mkdir(directory,{recursive:true})
   await withBrowserWorker(h,async(context,origin)=>{
    const page=await context.newPage()
    for(const width of [1440,390]){
     const p=await create(),before=h.messages.length
     await page.setViewportSize({width,height:1000})
     await page.goto(origin+'/app/donors/'+person.id+'#pledge-'+p.id)
     // An API creation while the donor page is already open requires a fresh read.
     await page.reload()
     let panel=page.locator('#pledge-'+p.id)
     await panel.getByText('Review held pledge email',{exact:true}).click()
     await panel.getByRole('link',{name:'Edit reminder wording',exact:true}).click()
     await page.locator('#pledge-template').getByRole('heading',{name:'Pledge reminder wording',exact:true}).waitFor()
     await page.goto(origin+'/app/donors/'+person.id+'#pledge-'+p.id)
     panel=page.locator('#pledge-'+p.id)
     await panel.getByText('Review held pledge email',{exact:true}).click()
     await panel.getByRole('checkbox').focus()
     await page.keyboard.press('Tab')
     assert.ok(await panel.getByRole('button',{name:'Release pledge email',exact:true}).evaluate(button=>button===document.activeElement))
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await panel.screenshot({path:directory+'/API-001-pledge-review-'+width+'.png'})
     await panel.getByRole('checkbox').check()
     await panel.getByRole('button',{name:'Release pledge email',exact:true}).click()
     await page.waitForURL('**/app/donors/**')
     panel=page.locator('#pledge-'+p.id)
     await panel.getByRole('button',{name:'Send due reminders',exact:true}).waitFor()
     assert.equal(await panel.getByText('Review held pledge email',{exact:true}).count(),0)
     assert.equal(h.messages.length,before)
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await panel.screenshot({path:directory+'/API-001-pledge-released-'+width+'.png'})
    }
    await page.close()
   })
  }
 },{entry:'tests/advancing-clock-worker.ts',triggerHandlers:true,bindings:{COFFER_TEST_NOW:'2026-10-27T12:00:00Z'}})
}

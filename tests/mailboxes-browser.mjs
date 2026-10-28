import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function mailboxesBrowser(h,{directory,donorId,keys}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage(),formFor=command=>page.locator('form').filter({has:page.locator(`[name=command][value="${command}"]`)})
  const proof=async(name,width,selector='main')=>{
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mailbox screen fits its viewport')
   assert.equal(await page.locator('button,a,[role=button]').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length&&!node.textContent.trim()&&node.querySelector('svg')&&!node.querySelector('[role=tooltip]')).length),0,'Icon-only controls carry tooltips')
   const small=await page.locator(selector+' *').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length&&[...node.childNodes].some(child=>child.nodeType===3&&child.textContent.trim())&&parseFloat(getComputedStyle(node).fontSize)<13).map(node=>({tag:node.tagName,text:node.textContent.slice(0,60),size:getComputedStyle(node).fontSize})))
   assert.deepEqual(small,[],'Mailbox screen text is at least 13 pixels')
   await page.locator(selector).screenshot({path:`${directory}/COMM-004-${name}-${width}.png`})
  }
  for(const provider of ['gmail','microsoft']){
   const pattern=provider==='gmail'?'https://accounts.google.com/o/oauth2/v2/auth**':'https://login.microsoftonline.com/common/oauth2/v2.0/authorize**'
   await context.route(pattern,async route=>{
    const url=new URL(route.request().url())
    await route.fulfill({status:303,headers:{location:origin+'/app/settings/mailboxes/'+provider+'/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-coffer-4003'})}})
   })
   await page.goto(origin+'/app/settings/mailboxes')
   const panel=page.getByRole('heading',{name:provider==='gmail'?'Gmail':'Microsoft 365',exact:true}).locator('..')
   await panel.locator('summary').filter({hasText:'application'}).click()
   const configure=formFor('mailbox.configure').filter({has:page.locator('[name=provider][value='+provider+']')})
   await configure.locator('[name=clientId]').fill(keys.clientId);await configure.locator('[name=clientSecret]').fill(keys.clientSecret)
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await proof(provider+'-application',width)}
   await configure.locator('[name=confirm]').check();await configure.getByRole('button').click()
   const connect=formFor('mailbox.start').filter({has:page.locator('[name=provider][value='+provider+']')})
   await connect.locator('[name=confirm]').check();await connect.getByRole('button').click()
   const proceed=page.getByRole('link',{name:provider==='gmail'?'Continue to Google':'Continue to Microsoft',exact:true})
   await proceed.waitFor()
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await proof(provider+'-authorize',width)}
   await proceed.click();await page.getByRole('button',{name:'Disconnect my '+(provider==='gmail'?'Gmail':'Microsoft 365'),exact:true}).waitFor()
  }
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/settings')
   await page.getByRole('link',{name:'Connect and manage my mailboxes',exact:true}).click()
   await page.getByRole('heading',{name:'My personal mailboxes',exact:true}).waitFor()
   await proof('settings',width)
   await formFor('mailbox.sync').filter({has:page.locator('[name=provider][value=gmail]')}).getByRole('button').click()
   await page.getByRole('heading',{name:'Mailbox logging',exact:true}).first().waitFor();await proof('logging',width)
   await page.goto(origin+'/app/donors/'+donorId+'#personal-email')
   const panel=page.locator('#personal-email')
   await panel.getByText('Write a personal email',{exact:true}).click()
   const compose=formFor('mailbox.prepare')
   await compose.locator('[name=provider]').selectOption(width===1440?'gmail':'microsoft')
   await compose.locator('[name=purpose]').selectOption('newsletter')
   await compose.locator('[name=subject]').fill('Reading room visit '+width)
   await compose.locator('[name=body]').fill('Thank you for visiting the reading room. Here are the opening hours.')
   await proof('composer',width,'#personal-email')
   await compose.getByRole('button').click()
   const review=panel.locator('article').filter({has:page.getByRole('heading',{name:'Reading room visit '+width,exact:true})})
   await review.getByText('Awaiting your explicit submission.',{exact:false}).waitFor()
   await proof('review',width,'#personal-email')
   await review.locator('[name=confirm]').check();await review.getByRole('button',{name:'Submit this personal email',exact:true}).click()
   await panel.getByText('Submitted to your mailbox provider; delivery is not confirmed.',{exact:false}).first().waitFor()
   assert.ok((await h.get('/api/coffer/donors/'+donorId)).mailboxMessages.some(r=>r.subject==='Reading room visit '+width&&r.state==='submitted'),'Native donor composer persists provider submission')
   await proof('submitted',width,'#personal-email')
   await page.goto(origin+'/app/donors/'+donorId+'?timelineKind=email#timeline')
   await page.locator('#timeline').getByText('Personal email sent · Reading room visit '+width,{exact:true}).waitFor()
   await page.locator('#timeline').getByRole('link',{name:'Open in mailbox',exact:true}).first().waitFor()
   await proof('timeline',width,'#timeline')
   await page.goto(origin+'/app/appeals#donor-replies')
   assert.ok((await page.locator('#donor-replies').innerText()).includes('Library conversation gmail-ambiguous')||(await page.locator('#donor-replies').innerText()).includes('Library conversation microsoft-ambiguous'))
   await proof('replies',width,'#donor-replies')
  }
  await page.close()
 })
}

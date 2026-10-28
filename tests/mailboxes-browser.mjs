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
   const small=await page.locator(selector+' *').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length&&[...node.childNodes].some(child=>child.nodeType===3&&child.textContent.trim())&&parseFloat(getComputedStyle(node).fontSize)<13).map(node=>node.tagName))
   assert.deepEqual(small,[],'Mailbox screen text is at least 13 pixels')
   await page.locator(selector).screenshot({path:`${directory}/COMM-004-${name}-${width}.png`})
  }
  await context.route('https://accounts.google.com/o/oauth2/v2/auth**',async route=>{
   const url=new URL(route.request().url())
   await route.fulfill({status:303,headers:{location:origin+'/app/settings/mailboxes/gmail/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-coffer-4003'})}})
  })
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/settings')
   await page.getByRole('link',{name:'Connect and manage my mailboxes',exact:true}).click()
   await page.getByRole('heading',{name:'My personal mailboxes',exact:true}).waitFor()
   await proof('settings',width)
   if(width===1440){
    await page.getByRole('button',{name:'Disconnect my Gmail',exact:true}).click()
    const connect=formFor('mailbox.start').filter({has:page.locator('[name=provider][value=gmail]')})
    await connect.locator('[name=confirm]').check();await connect.getByRole('button').click()
    await page.getByRole('link',{name:'Continue to Google',exact:true}).waitFor();await proof('authorize',width)
    await page.getByRole('link',{name:'Continue to Google',exact:true}).click();await page.getByRole('button',{name:'Disconnect my Gmail',exact:true}).waitFor()
   }
   await formFor('mailbox.sync').filter({has:page.locator('[name=provider][value=gmail]')}).getByRole('button').click()
   await page.getByRole('heading',{name:'Mailbox logging',exact:true}).first().waitFor();await proof('logging',width)
   await page.goto(origin+'/app/donors/'+donorId+'#personal-email')
   const panel=page.locator('#personal-email')
   await panel.getByText('Write a personal email',{exact:true}).click()
   const compose=formFor('mailbox.prepare')
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
  }
  await page.close()
 })
}

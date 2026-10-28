import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

async function capture(page,directory,name,width){
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} fits ${width}px`)
 const small=await page.evaluate(()=>{
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),found=[]
  while(walker.nextNode()){
   const node=walker.currentNode,parent=node.parentElement
   if(!node.textContent.trim()||!parent||parent.closest('script,style,.sr,[aria-hidden="true"]'))continue
   const style=getComputedStyle(parent)
   if(style.visibility==='hidden'||style.display==='none')continue
   const range=document.createRange();range.selectNodeContents(node)
   if([...range.getClientRects()].some(rect=>rect.width>0&&rect.height>0)&&parseFloat(style.fontSize)<13)found.push({text:node.textContent.trim().slice(0,90),size:style.fontSize})
  }
  return found
 })
 assert.deepEqual(small,[],`${name} visible text is at least 13px`)
 await page.screenshot({path:`${directory}/PEER-${name}-${width}.png`,fullPage:true})
}

async function openDetails(form){
 const details=form.locator('..')
 if(await details.evaluate(element=>element.tagName==='DETAILS'&&!element.open))await details.locator('summary').click()
}

export async function peerBrowser(h,edge,{campaign,first,second,firstCookie,secondCookie},directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  let cookie=firstCookie
  // The bridge is HTTP; the real donor session is Secure. Pass that confirmed
  // cookie only to this local transport, never to Stripe or another origin.
  await context.route(origin+'/**',async route=>route.continue({headers:{...route.request().headers(),cookie}}))
  const page=await context.newPage();page.setDefaultTimeout(15000)
  await page.route('https://checkout.stripe.com/**',route=>route.fulfill({status:200,contentType:'text/plain',body:'Stripe test boundary'}))
  const state=as=>h.get('/giving/peer/state',{as})
  const publicState=id=>h.get(`/giving/peer/pages/${id}?format=json`,{as:''})
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   const teamTitle=`Reading circle ${width}`,pageTitles=[`First reading page ${width}`,`Second reading page ${width}`],pageIds=[],paid=[]
   for(const [index,as] of [firstCookie,secondCookie].entries()){
    cookie=as
    await page.goto(origin+'/giving/peer')
    const recognition=page.locator('form[action="/giving/peer/recognition"]')
    await recognition.locator('[name=recognitionName]').fill(`Reading champion ${width} ${index+1}`)
    await recognition.locator('[name=honorRollOptIn]').selectOption('yes')
    await recognition.locator('[name=anonymous]').selectOption('no')
    await recognition.getByRole('button',{name:'Save recognition choices',exact:true}).click()
    await page.waitForURL('**/giving/peer?saved=1')
    const recognized=await state(as)
    assert.equal(recognized.recognition.honor_roll_opt_in,1)
    assert.equal(recognized.recognition.anonymous,0)
    if(index===0){
     const team=page.locator('form[action="/giving/peer/teams"]').filter({has:page.getByRole('button',{name:'Create team',exact:true})})
     await openDetails(team)
     await team.locator('[name=campaignId]').selectOption(campaign.id)
     await team.locator('[name=title]').fill(teamTitle)
     await team.locator('[name=goal]').fill('100.00')
     await team.locator('[name=publish]').check();await team.locator('[name=publicationPermission]').check()
     await capture(page,directory,'team-filled',width)
     await team.getByRole('button',{name:'Create team',exact:true}).click();await page.waitForURL('**/giving/peer?saved=1')
    }
    const available=await state(as),team=available.teams.find(t=>t.title===teamTitle)
    assert.ok(team,'Published team is available to both supporters')
    const create=page.locator('form[action="/giving/peer/pages"]').filter({has:page.getByRole('button',{name:'Create fundraising page',exact:true})})
    await openDetails(create)
    await create.locator('[name=campaignId]').selectOption(campaign.id)
    await create.locator('[name=title]').fill(pageTitles[index])
    await create.locator('[name=goal]').fill('50.00')
    await create.locator('[name=teamId]').selectOption(team.id)
    await create.locator('[name=publish]').check();await create.locator('[name=publicationPermission]').check()
    await capture(page,directory,`dashboard-filled-${index+1}`,width)
    await create.getByRole('button',{name:'Create fundraising page',exact:true}).click();await page.waitForURL('**/giving/peer?saved=1')
    await capture(page,directory,`dashboard-saved-${index+1}`,width)
    const saved=(await state(as)).pages.find(p=>p.title===pageTitles[index]);assert.ok(saved);assert.equal(saved.published,1);assert.equal(saved.team_id,team.id)
    pageIds.push(saved.id)
   }
   cookie=''
   for(const [index,id] of pageIds.entries()){
    await page.goto(origin+'/giving/peer/pages/'+id)
    await page.getByRole('heading',{name:pageTitles[index],exact:true}).waitFor()
    await capture(page,directory,`page-${index+1}`,width)
    await page.getByRole('link',{name:'Give through this page',exact:true}).click()
    assert.equal(new URL(page.url()).pathname,'/give/'+campaign.slug)
    assert.equal(new URL(page.url()).searchParams.get('peer'),id)
    const name=`Browser Giver ${width} ${index+1}`,amount=index===0?1200:2300
    await page.locator('[name=name]').fill(name)
    await page.locator('[name=email]').fill(`browser.giver.${width}.${index+1}${String.fromCharCode(64)}example.test`)
    await page.locator('[name=amount]').fill((amount/100).toFixed(2))
    await page.locator('[name=wallOptIn]').check()
    await page.locator('[name=recognitionName]').fill(name)
    // withBrowserWorker fakes the challenge script at its provider boundary.
    await page.locator('[name="cf-turnstile-response"]').waitFor({state:'attached'})
    await capture(page,directory,`giving-${index+1}`,width)
    const before=edge.sessions.size
    await page.getByRole('button',{name:'Continue to secure checkout'}).click();await page.waitForURL('https://checkout.stripe.com/**')
    assert.equal(edge.sessions.size,before+1)
    const session=[...edge.sessions.values()].at(-1);assert.equal(session.amount_total,amount)
    await page.goto(origin+'/giving/thanks?session_id='+session.id)
    await page.getByRole('heading',{name:'Thank you for your gift',exact:true}).waitFor()
    await capture(page,directory,`paid-${index+1}`,width)
    const giver=(await h.get('/api/coffer/donors')).donors.find(d=>d.name===name)
    assert.ok(giver,'Paid donor exists in the real owner API')
    const hard=(await h.get('/api/coffer/donors/'+giver.id)).gifts.filter(g=>g.kind==='gift')
    assert.equal(hard.length,1);assert.equal(hard[0].amount_cents,amount)
    const fundraiser=await h.get('/api/coffer/donors/'+[first,second][index].id)
    const credit=fundraiser.giftDepth.creditedGifts.find(g=>g.gift_id===hard[0].id)
    assert.ok(credit,'Fundraiser receives soft credit for the actual giver’s gift')
    assert.equal(credit.amount_cents,amount)
    assert.ok(!fundraiser.gifts.some(g=>g.id===hard[0].id),'The fundraiser is not the hard-credit donor')
    const current=await publicState(id)
    assert.equal(current.raisedCents,amount);assert.equal(current.giftCount,1)
    assert.deepEqual(current.wall.map(g=>({name:g.name,amountCents:g.amountCents})),[{name,amountCents:amount}])
    paid.push(hard[0].id)
    await page.goto(origin+'/giving/peer/pages/'+id)
    await page.getByText(name,{exact:true}).waitFor()
    await capture(page,directory,`page-paid-${index+1}`,width)
   }
   assert.equal(new Set(paid).size,2,'Each payment records a distinct gift')
   const team=(await state(firstCookie)).teams.find(t=>t.title===teamTitle)
   const board=await h.get(`/giving/peer/leaderboard/${campaign.id}?format=json`,{as:''})
   assert.equal(board.pages.find(p=>p.id===pageIds[0]).raisedCents,1200)
   assert.equal(board.pages.find(p=>p.id===pageIds[1]).raisedCents,2300)
   assert.equal(board.teams.find(t=>t.id===team.id).raisedCents,3500)
   assert.equal(board.teams.find(t=>t.id===team.id).giftCount,2)
   await page.getByRole('link',{name:'View campaign leaderboard',exact:true}).click()
   await page.getByRole('heading',{name:'Teams',exact:true}).waitFor()
   await page.getByRole('heading',{name:'Fundraisers',exact:true}).waitFor()
   await capture(page,directory,'leaderboard',width)
   await page.getByRole('link',{name:teamTitle,exact:true}).first().click()
   await page.getByRole('heading',{name:'Team fundraisers',exact:true}).waitFor()
   await page.getByRole('link',{name:pageTitles[0],exact:true}).waitFor()
   await page.getByRole('link',{name:pageTitles[1],exact:true}).waitFor()
   await capture(page,directory,'team-page',width)
  }
  await page.close()
 })
}

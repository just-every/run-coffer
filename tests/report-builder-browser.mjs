import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function builderBrowser(h,{id,member,headers},directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders(headers)
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/more')
   await page.screenshot({path:`${directory}/builder-navigation-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Report builder',exact:false}).click()
   await page.getByLabel('Report name',{exact:true}).fill('Library giving '+width)
   await page.getByLabel('From',{exact:true}).fill('2025-01-01')
   await page.getByLabel('Through',{exact:true}).fill('2025-12-31')
   await page.screenshot({path:`${directory}/builder-create-${width}.png`,fullPage:true})
   await page.getByRole('button',{name:'Create report',exact:true}).click()
   await page.getByRole('heading',{name:'Library giving '+width,exact:true}).waitFor()
   assert.ok(await page.getByText('32346',{exact:true}).first().isVisible())
   await page.getByRole('link',{name:'Download CSV',exact:true}).waitFor()
   let pending=page.waitForEvent('download');await page.getByRole('link',{name:'Download Excel',exact:true}).click()
   assert.equal(await(await pending).failure(),null)
   await page.getByRole('checkbox',{name:'method',exact:true}).check()
   await page.getByRole('button',{name:'Save definition',exact:true}).click()
   await page.getByRole('heading',{name:'Report settings',exact:true}).scrollIntoViewIfNeeded()
   await page.getByLabel('Member',{exact:true}).selectOption(member.id)
   await page.getByRole('checkbox',{name:'I approve disclosure',exact:false}).check()
   await page.getByRole('button',{name:'Share report',exact:true}).click()
   await page.getByText('Shared with '+member.session.operator.displayName+'.',{exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   const bad=await page.locator('button,a,label[for="cf-menu"]').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width&&!(n.textContent||'').trim()).map(n=>n.outerHTML));assert.deepEqual(bad,[])
   const small=await page.locator('main input,main select,main button,main th,main td').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height&&parseFloat(getComputedStyle(n).fontSize)<13).map(n=>n.tagName));assert.deepEqual(small,[])
   await page.screenshot({path:`${directory}/builder-saved-${width}.png`,fullPage:true})
   const sharedPath=new URL(page.url()).pathname+new URL(page.url()).search
   await page.getByRole('link',{name:'Schedule this report',exact:true}).click()
   assert.equal(await page.getByLabel('Report URL with filters',{exact:true}).inputValue(),sharedPath)
   await page.screenshot({path:`${directory}/builder-schedule-${width}.png`,fullPage:true})
   const memberContext=await context.browser().newContext({viewport:{width,height:1000}})
   try{
    await memberContext.addCookies(member.cookie.split('; ').map(value=>{const at=value.indexOf('=');return {name:value.slice(0,at),value:value.slice(at+1),domain:'127.0.0.1',path:'/',httpOnly:true,secure:true,sameSite:'Lax'}}))
    await memberContext.setExtraHTTPHeaders(headers)
    const memberPage=await memberContext.newPage()
    await memberPage.goto(origin+sharedPath)
    await memberPage.getByRole('heading',{name:'Library giving '+width,exact:true}).waitFor()
    assert.equal(await memberPage.getByRole('link',{name:'Download CSV',exact:true}).count(),0)
    await memberPage.screenshot({path:`${directory}/builder-member-${width}.png`,fullPage:true})
   }finally{await memberContext.close()}

  }
  await page.close()
 })
}

export async function periodBalanceBrowser(h,{includedId,excludedId,giftId,headers},directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders(headers)
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/reports/builder?id='+includedId)
   await page.getByRole('cell',{name:giftId,exact:true}).waitFor()
   assert.ok(await page.getByText('10000',{exact:true}).first().isVisible())
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/builder-period-included-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/reports/builder?id='+excludedId)
   assert.equal(await page.getByRole('cell',{name:giftId,exact:true}).count(),0)
   assert.ok(await page.getByText('No matching records.',{exact:true}).first().isVisible())
   await page.screenshot({path:`${directory}/builder-period-excluded-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}

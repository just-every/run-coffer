import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

const fits=async(page,width)=>{
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'API key screen fits '+width)
 assert.equal(await page.locator('main button,main a').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&!n.textContent.trim()).length),0,'Every API key control has visible text')
}
async function submit(page,button){
 const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/app/actions'&&r.request().method()==='POST'),page.waitForNavigation({waitUntil:'load'}),button.click()])
 assert.ok([200,303].includes(response.status()),'Native key action completes')
}

export async function restApiBrowser(h,directory,{donorId,pledgeId}){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/settings')
   await fits(page,width)
   await page.screenshot({path:`${directory}/API-001-settings-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Public API keys',exact:true}).click()
   const panel=page.locator('#api-key-create'),add=panel.getByText('Add an API key',{exact:true})
   if(await add.count())await add.click()
   await panel.getByLabel('Key label',{exact:true}).fill('Riverbend accounting '+width)
   assert.equal(await panel.getByLabel('Permissions',{exact:true}).inputValue(),'read-only','New keys start with the conservative read-only choice')
   await page.keyboard.press('Tab')
   assert.equal(await panel.getByLabel('Permissions',{exact:true}).evaluate(n=>n===document.activeElement),true,'Scope follows the label in keyboard order')
   await panel.getByText('Scope and expiry policy',{exact:true}).click()
   await fits(page,width)
   await page.screenshot({path:`${directory}/API-001-create-${width}.png`,fullPage:true})
   await submit(page,panel.getByRole('button',{name:'Create API key',exact:true}))
   const secret=page.locator('[data-api-key-secret]')
   await secret.waitFor()
   const token=await secret.inputValue()
   assert.ok(await secret.evaluate(n=>n.readOnly&&n.value.length>0),'New key is available once in a read-only field')
   await fits(page,width)
   await page.screenshot({path:`${directory}/API-001-secret-${width}.png`,fullPage:true,mask:[secret]})
   await page.getByRole('link',{name:'Back to API keys',exact:true}).click()
   await page.waitForURL('**/app/api-keys')
   assert.equal(await page.locator('[data-api-key-secret]').count(),0,'Ordinary key management never reveals tokens')
   const keys=(await h.get('/api/coffer/v1/keys')).keys,key=keys.find(k=>k.label==='Riverbend accounting '+width)
   const auth={as:'',headers:{authorization:'Bearer '+token}}
   const result=await h.get('/api/coffer/v1/donors',auth)
   assert.ok(result.data.length>0,'New key reads real native constituents')
   await page.getByRole('link',{name:'OpenAPI document',exact:true}).click()
   assert.ok((await page.textContent('body')).includes('Coffer Public REST API'),'Documentation link serves the actual API schema')
   await page.goBack()
   await submit(page,page.locator(`[id=${JSON.stringify('api-key-'+key.id)}]`).getByRole('button',{name:'Revoke key',exact:true}))
   await h.get('/api/coffer/v1/donors',{...auth,status:401})
   const row=page.locator(`[id=${JSON.stringify('api-key-'+key.id)}]`)
   assert.equal(await row.getByRole('button').count(),0,'Revoked keys have no repeat revoke action')
   await fits(page,width)
   await page.screenshot({path:`${directory}/API-001-revoked-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/donors/'+encodeURIComponent(donorId))
   const pledge=page.locator(`[id=${JSON.stringify('pledge-'+pledgeId)}]`)
   await pledge.getByText('Automatic pledge email is held by the public API scope policy.',{exact:true}).waitFor()
   assert.equal(await pledge.getByRole('button',{name:'Send due reminders',exact:true}).count(),0,'Held API pledges do not offer a sending action')
   const tips=page.locator('.cf-tip')
   for(let i=0;i<await tips.count();i++){
    const tip=tips.nth(i)
    if(!await tip.isVisible())continue
    await tip.focus()
    assert.ok(await tip.locator('[role=tooltip]').isVisible(),'Icon-only controls explain themselves on keyboard focus')
    await tip.blur();await tip.hover();await page.waitForTimeout(350)
    assert.ok(await tip.locator('[role=tooltip]').isVisible(),'Icon-only controls explain themselves on hover')
   }
   await fits(page,width)
   await pledge.screenshot({path:`${directory}/API-001-pledge-held-${width}.png`})
  }
  await page.close()
 })
}

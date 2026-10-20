import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {donor} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function relationshipsBrowser(h,{directory}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]) {
   const parent=await donor(h,`Jordan Rivers ${width}`),child=await donor(h,`Casey Rivers ${width}`)
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/donors/'+parent.id)
   const section=page.locator('#relationships')
   await section.locator('summary').filter({hasText:'Add relationship'}).click()
   await section.getByLabel('Relationship',{exact:true}).selectOption('parent')
   await section.getByLabel('Related donor',{exact:true}).selectOption(child.id)
   await section.getByRole('button',{name:'Add relationship',exact:true}).click()
   await section.getByText('Child ·',{exact:false}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'DONOR-003 parent record fits '+width)
   await section.screenshot({path:`${directory}/DONOR-003-parent-${width}.png`})
   await section.getByRole('link',{name:child.name??`Casey Rivers ${width}`,exact:true}).click()
   await page.locator('#relationships').getByText('Parent ·',{exact:false}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'DONOR-003 child record fits '+width)
   await page.locator('#relationships').screenshot({path:`${directory}/DONOR-003-child-${width}.png`})
   await page.locator('#relationships summary').filter({hasText:'Add relationship'}).click()
   const choices=await page.locator('#relationships').getByLabel('Relationship',{exact:true}).locator('option').evaluateAll(nodes=>nodes.map(n=>n.value))
   for(const type of ['spouse','employer','board_member','parent','friend','advisor'])assert.ok(choices.includes(type))
   await page.goto(origin+'/app/donors?relationship=parent&relatedTo='+parent.id)
   await page.getByRole('link',{name:`Casey Rivers ${width}`,exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'DONOR-003 filtered list fits '+width)
   await page.screenshot({path:`${directory}/DONOR-003-list-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}

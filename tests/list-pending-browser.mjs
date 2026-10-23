import assert from 'node:assert/strict'
import {withBrowserWorker} from './browser-worker.mjs'
import {mkdir} from 'node:fs/promises'

export async function pendingRestoreBrowser(h,{listId,directory}){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   const list=(await h.get('/api/coffer/lists')).lists.find(l=>l.id===listId)
   const job=await h.command('list.profile',{listId,version:list.version,kind:'status',status:'inactive',statusReason:'Native review',reason:'synthetic-coffer-1601'})
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/exports?list=saved:'+listId)
   const row=()=>page.locator('li').filter({has:page.locator('input[name=jobId][value="'+job.id+'"]')}).last()
   await row().getByRole('button',{name:'Undo this bulk change',exact:true}).click();await page.waitForURL('**/app/exports?list=saved:*')
   await row().getByRole('button',{name:'Restore pending work',exact:true}).waitFor()
   const before=await h.get('/api/coffer/tasks'),closed=before.tasks.filter(t=>t.status==='done').map(t=>t.id)
   assert.ok(closed.length,'Record undo leaves closed tasks closed')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await row().screenshot({path:directory+'/DONOR-007-records-restored-'+width+'.png'})
   await row().getByRole('checkbox',{name:/Restore the earlier tasks/}).check()
   await row().getByRole('button',{name:'Restore pending work',exact:true}).click();await page.waitForURL('**/app/exports?list=saved:*')
   const after=await h.get('/api/coffer/tasks')
   assert.ok(after.tasks.some(t=>closed.includes(t.id)&&t.status==='open'),'Separate native confirmation restores earlier work')
   await page.getByRole('heading',{name:'Bulk change history',exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:directory+'/DONOR-007-pending-restored-'+width+'.png',fullPage:true})
  }
  await page.close()
 })
}

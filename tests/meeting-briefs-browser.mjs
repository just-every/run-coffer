import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function meetingBriefsBrowser(h,{directory,meetingId,donorId,questionId}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  const donorUrl=origin+'/app/donors/'+donorId+'#meetings'
  const briefUrl=origin+'/app/meetings/'+meetingId+'/brief'
  const apiUrl='/api/coffer/meetings/'+meetingId+'/brief'
  const formFor=command=>page.locator('form').filter({has:page.locator(`[name=command][value="${command}"]`)})
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await page.goto(donorUrl)
   const meetings=page.locator('#meetings')
   await meetings.waitFor()
   await meetings.locator('summary').filter({hasText:'Schedule a meeting'}).click()
   const schedule=formFor('meeting.schedule')
   const startsAt=new Date(Date.now()+7*86400000+width*1000).toISOString()
   await schedule.locator('[name=startsAt]').fill(startsAt)
   await schedule.getByRole('button').click()
   assert.ok((await h.get('/api/coffer/meetings')).some(m=>m.donor_id===donorId&&m.starts_at===startsAt),'Native scheduling persists the meeting')
   await page.goto(donorUrl)
   const question=page.locator(`[data-question-id="${questionId}"]`)
   await question.getByRole('button',{name:'Resolve question',exact:true}).click()
   assert.ok((await h.get(apiUrl)).lines.every(line=>line.kind!=='open_question'||line.facts.id!==questionId),'Resolved question leaves the ready brief')
   await page.goto(donorUrl)
   await question.getByRole('button',{name:'Reopen question',exact:true}).click()
   assert.ok((await h.get(apiUrl)).lines.some(line=>line.kind==='open_question'&&line.facts.id===questionId),'Reopened question returns to the ready brief')
   await page.goto(donorUrl)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'DEV-006 meetings fit '+width)
   await meetings.screenshot({path:`${directory}/DEV-006-meetings-${width}.png`})
   await page.goto(briefUrl)
   await page.getByRole('heading',{name:'Questions left open',exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'DEV-006 brief fits '+width)
   const brief=await h.get(apiUrl)
   const links=await page.locator('main a.source').evaluateAll(anchors=>anchors.map(a=>({href:a.getAttribute('href'),pointer:a.dataset.sourcePointer,id:a.dataset.sourceId})))
   assert.equal(links.length,brief.lines.length,'Every brief line has a source link')
   for(const line of brief.lines) {
    assert.ok(links.some(link=>link.href===line.source.href&&link.pointer===line.source.pointer&&link.id===(line.source.id??undefined)))
    let source=await h.get(line.source.href)
    for(const part of line.source.pointer.split('/').filter(Boolean))source=source[part]
    if(line.source.id)source=source.find(record=>record.id===line.source.id)
    assert.deepEqual(line.facts,source,'Printed source facts remain exact')
   }
   const questionText=brief.lines.find(line=>line.kind==='open_question'&&line.facts.id===questionId).facts.open_question
   assert.ok((await page.locator('main').textContent()).includes(questionText),'Full unresolved question appears without truncation')
   await page.screenshot({path:`${directory}/DEV-006-brief-${width}.png`,fullPage:true})
  }
  await page.emulateMedia({media:'print'})
  const pdf=await page.pdf({path:`${directory}/DEV-006-brief.pdf`,format:'Letter',preferCSSPageSize:true,displayHeaderFooter:false,scale:1})
  const pages=[...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length
  assert.equal(pages,1,'Representative DEV-006 brief prints on one US Letter page at 100% scale')
  await page.screenshot({path:`${directory}/DEV-006-print.png`,fullPage:true})
  await page.close()
 })
}

import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

const sourceNames={lgl:'Little Green Light',bloomerang:'Bloomerang','re-nxt':"Raiser's Edge NXT"}
const date=value=>value?new Intl.DateTimeFormat('en-US',{dateStyle:'long',timeZone:'UTC'}).format(new Date(value.slice(0,10)+'T00:00:00Z')):'Source date unknown'
const answer={granted:/granted|agreed|yes/i,withdrawn:/withdrawn|withdrew|declined/i,unknown:/unknown|not asked/i}
const channel={email:/email/i,mail:/mail/i,phone:/phone/i,sms:/sms/i}
const codeLines=rules=>Object.entries(rules??{}).map(([code,r])=>{
 const meaning={stop:'stop',ignore:'skip',channels:'no '+(r.channels??[]).join(', '),withdraw:'withdraw '+(r.channels??[]).join(', '),limit:'limit '+r.maxAsks,tag:'tag '+r.tag}[r.type]
 assert.ok(meaning,'Supported reviewed communication rule: '+r.type)
 return code+' = '+meaning
}).join('\n')

export async function consentImportBrowser(h,input,preview,directory){
 if(directory)await mkdir(directory,{recursive:true})
 return withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage(),rules=codeLines(input.solicitCodes??preview.solicitCodes)
  const files=input.files.map(f=>({name:f.name,mimeType:f.name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv',buffer:Buffer.from(f.base64,'base64')}))
  let id
  const capture=async(stage,width)=>{await fits(page,width);if(directory)await page.screenshot({path:`${directory}/DONOR-consent-import-${stage}-${width}.png`,fullPage:true})}
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/move-in/crm')
   let form=page.locator('form[action="/app/move-in/crm/preview"]')
   await form.locator('select[name=source]').selectOption(input.source)
   await form.locator('input[name=exports]').setInputFiles(files)
   await form.getByText('Map organization-specific communication codes',{exact:true}).click()
   await form.locator('textarea[name=solicitCodes]').fill(rules)
   await form.locator('input[name=noGoodsOrServices]').setChecked(input.noGoodsOrServices===true)
   await capture('start',width)
   await form.getByRole('button',{name:'Preview exports',exact:true}).click()
   await page.waitForURL('**/app/move-in/crm/review?id=*')
   const reviewedId=new URL(page.url()).searchParams.get('id')
   assert.ok(reviewedId,'Native file upload creates a review')
   if(id)assert.equal(reviewedId,id,'Identical mobile upload opens the same import')
   id=reviewedId
   await page.getByRole('heading',{name:'Channel preferences',exact:true}).waitFor()
   const panel=page.getByRole('heading',{name:'Channel preferences',exact:true}).locator('..')
   await page.getByRole('heading',{name:'Reviewed communication codes',exact:true}).waitFor()
   for(const preference of preview.consents??[]){
    const rows=await panel.locator('li,tr').allTextContents()
    const matching=rows.filter(text=>text.includes(preference.donorExternalId)&&channel[preference.channel].test(text)&&answer[preference.status].test(text))
    assert.ok(matching.length,`Review retains ${preference.donorExternalId} ${preference.channel} ${preference.status}`)
    assert.ok(matching.some(text=>text.includes(date(preference.sourceOn))||preference.sourceOn&&text.includes(preference.sourceOn)),'Review distinguishes source date from import time')
    const loc=preference.location
    for(const value of [loc?.file,loc?.sheet==='CSV'?'':loc?.sheet,loc?.row?String(loc.row):'',loc?.column].filter(Boolean))assert.ok(matching.some(text=>text.includes(value)),'Review retains source location '+value)
   }
   assert.ok((await panel.innerText()).includes(sourceNames[input.source]),'Review names the source CRM')
   form=page.locator('form[action="/app/move-in/crm/preview"]')
   await form.getByText('Map organization-specific communication codes',{exact:true}).click()
   assert.equal(await form.locator('textarea[name=solicitCodes]').inputValue(),rules,'Recheck retains every reviewed code mapping')
   await capture('review',width)
   if(width===1440){
    await form.locator('input[name=exports]').setInputFiles(files)
    await form.locator('input[name=noGoodsOrServices]').setChecked(input.noGoodsOrServices===true)
    await form.getByRole('button',{name:'Check the files again',exact:true}).click()
    await page.waitForURL('**/app/move-in/crm/review?id=*')
    assert.equal(new URL(page.url()).searchParams.get('id'),id,'Rechecking preserves the reviewed import')
    const apply=page.locator('form[action="/app/move-in/crm/apply"]')
    await apply.locator('input[name=acknowledged][value=no]').check()
    await apply.locator('input[name=confirm]').check()
    await apply.getByRole('button',{name:'Move these records in',exact:true}).click()
    await page.waitForURL('**/app/move-in/crm/journal?id=*')
   }else{
    await page.getByRole('link',{name:'Open its journal',exact:true}).click()
    await page.waitForURL('**/app/move-in/crm/journal?id=*')
   }
   let journal=await h.get('/api/coffer/move-in/journal?id='+id)
   while(journal.job.state==='applying'){
    const before=journal.job.applied_parts
    await page.locator('form[action="/app/move-in/crm/continue"]').getByRole('button',{name:'Continue',exact:true}).click()
    await page.waitForURL('**/app/move-in/crm/journal?id=*')
    journal=await h.get('/api/coffer/move-in/journal?id='+id)
    assert.ok(journal.job.state==='completed'||journal.job.applied_parts>before,'Continue advances the real import')
   }
   assert.equal(journal.job.state,'completed')
   assert.deepEqual(journal.job.report.counts,preview.counts,'Every reviewed record count survives the native upload')
   assert.equal(journal.job.check_report.matches,true,'Saved import reconciles against all source records')
   await capture('journal',width)
   for(const externalId of new Set((preview.consents??[]).map(p=>p.donorExternalId))){
    const donor=preview.donors.find(d=>d.externalId===externalId)
    assert.ok(donor,'Preference links to a reviewed donor')
    await page.goto(origin+'/app/donors?q='+encodeURIComponent(donor.name))
    await page.getByRole('link',{name:donor.name,exact:true}).click()
    const donorId=new URL(page.url()).pathname.split('/').pop(),history=await h.get('/api/coffer/donors/'+donorId)
    const consent=page.locator('#consent')
    await consent.waitFor()
    for(const expected of preview.consents.filter(p=>p.donorExternalId===externalId)){
     const saved=history.consents.find(p=>p.channel===expected.channel&&p.status===expected.status&&((p.captured_on??'')===(expected.sourceOn??'')))
     assert.ok(saved,`Saved donor retains ${expected.channel} ${expected.status} with its source date`)
     assert.ok(saved.recorded_at,'Import time is recorded separately')
     const rows=await consent.locator('li').allTextContents()
     assert.ok(rows.some(text=>channel[expected.channel].test(text)&&answer[expected.status].test(text)&&(text.includes(date(expected.sourceOn))||expected.sourceOn&&text.includes(expected.sourceOn))),'Donor history exposes the imported preference and source date')
    }
    await consent.scrollIntoViewIfNeeded()
    await capture('donor-history-'+externalId.replace(/[^a-zA-Z0-9_-]/g,'_'),width)
   }
  }
  await page.close()
  return {id}
 })
}

async function fits(page,width){
 const failures=await page.evaluate(()=>{
  const visible=node=>node.checkVisibility()&&!node.closest('.sr,[aria-hidden="true"]')
  const small=[...document.querySelectorAll('body *')].filter(node=>visible(node)&&[...node.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(node).fontSize)<13).map(node=>node.textContent.trim().slice(0,80))
  const unlabeled=[...document.querySelectorAll('button,a,[role=button]')].filter(node=>visible(node)&&!(node.innerText||'').trim()&&!node.hasAttribute('data-tooltip')&&!node.hasAttribute('data-tip')&&!node.hasAttribute('data-tooltip-content')).map(node=>node.outerHTML.slice(0,150))
  return {overflow:document.documentElement.scrollWidth>innerWidth,small,unlabeled}
 })
 assert.equal(failures.overflow,false,'Screen fits '+width)
 assert.deepEqual(failures.small,[],'Visible text is at least 13px')
 assert.deepEqual(failures.unlabeled,[],'Icon-only controls provide tooltip data')
}

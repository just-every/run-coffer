import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function organizationsBrowser(h,directory) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  page.setDefaultTimeout(15000)
  const formFor=command=>page.locator('form').filter({has:page.locator(`[name=command][value="${command}"]`)})
  const fits=async name=>{
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'DONOR-002 '+name+' fits')
   const target=name.startsWith('create-')?formFor('donor.create'):name.startsWith('profile-')?formFor('donor.profile'):name.startsWith('organization-')?page.locator('#organization'):name.startsWith('contact-')?page.locator('#timeline'):page.locator('main')
   await target.screenshot({path:`${directory}/DONOR-002-${name}.png`})
  }
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   const create=async(name,organization=false)=>{
    await page.goto(origin+'/app/donors')
    const form=formFor('donor.create')
    await form.getByLabel('Name',{exact:true}).fill(name)
    await form.getByLabel('Email',{exact:true}).fill(name.toLowerCase().replaceAll(' ','.')+'@example.test')
    if(organization){
     await form.locator('[name=constituentKind]').selectOption('organization')
     await form.locator('[name=organizationType]').selectOption('foundation')
     await form.getByLabel('Website',{exact:true}).fill('https://foundation.example.org')
     await form.getByLabel('Organization EIN',{exact:true}).fill('12-7654321')
    }
    await form.getByLabel('Address line 1',{exact:true}).fill('210 Lake Street')
    await form.getByLabel('City',{exact:true}).fill('Minneapolis')
    await form.getByLabel('State',{exact:true}).fill(organization?'MN':'CA')
    await form.getByLabel('ZIP code',{exact:true}).fill(organization?'55401':'90001')
    await fits('create-'+(organization?'foundation':name.split(' ')[0])+'-'+width)
    await form.getByRole('button',{name:'Add donor',exact:true}).click()
    await page.waitForURL(/\/app\/donors\/[^/?]+$/)
    return page.url().split('/').at(-1)
   }
   const contactNames=[`Maya Wren ${width}`,`Owen Brook ${width}`]
   const contactIds=[]
   for(const name of contactNames){
    const id=await create(name);contactIds.push(id)
    await page.getByText('Name parts and household eligibility',{exact:true}).click()
    const profile=formFor('donor.profile')
    await profile.getByLabel('Informal salutation',{exact:true}).fill(name.split(' ')[0])
    await fits('profile-'+name.split(' ')[0]+'-'+width)
    await profile.getByRole('button',{name:'Save name parts',exact:true}).click()
    await page.waitForLoadState('domcontentloaded')
   }
   const organizationId=await create(`Wrenfield Foundation ${width}`,true)
   for(let index=0;index<2;index++){
    await page.goto(origin+'/app/donors/'+organizationId)
    await page.getByText('Add or update organization contact',{exact:true}).click()
    const link=formFor('organization.contact')
    await link.locator('[name=contactDonorId]').selectOption(contactIds[index])
    await link.getByLabel('Contact role',{exact:true}).fill(index?'Grants officer':'Executive director')
    if(index===0)await link.getByRole('checkbox').check()
    await link.getByRole('button',{name:'Save organization contact',exact:true}).click()
    await page.waitForLoadState('domcontentloaded')
   }
   await page.goto(origin+'/app/donors/'+organizationId+'#organization')
   assert.ok((await page.locator('#organization').textContent()).includes(contactNames[0]))
   assert.ok((await page.locator('#organization').textContent()).includes(contactNames[1]))
   await page.getByText('Edit organization',{exact:true}).click()
   await fits('organization-'+width)
   await page.goto(origin+'/app/donors/'+organizationId+'#record')
   const gift=page.locator('#record form')
   await gift.getByLabel('Amount (USD)',{exact:true}).fill('10000')
   await gift.getByLabel('Received on',{exact:true}).fill('2026-09-15')
   await gift.locator('[name=method]').selectOption('check')
   await gift.getByLabel('Fund',{exact:true}).fill('Food access')
   await gift.getByLabel('No goods or services',{exact:true}).check()
   await gift.getByRole('button',{name:'Record gift',exact:true}).click()
   await page.waitForLoadState('domcontentloaded')
   const organization=await h.get('/api/coffer/donors/'+organizationId)
   assert.equal(organization.gifts[0].amount_cents,1000000)
   await fits('gift-'+width)
   for(const id of contactIds){
    await page.goto(origin+'/app/donors/'+id+'#timeline')
    const text=await page.locator('#timeline').textContent()
    assert.ok(text.includes('Related organization gift · $10,000.00'))
    assert.ok(text.includes('credited to the organization only'))
    assert.equal((await h.get('/api/coffer/donors/'+id)).totals.lifetimeCents,0)
    await fits('contact-'+(id===contactIds[0]?'primary':'secondary')+'-'+width)
   }
   await page.goto(origin+'/app/letters')
   // The queue prepares all currently due gifts through the ordinary public form.
   const prepare=formFor('ack.prepare')
   await prepare.getByRole('button').click()
   await page.waitForURL(/\/app\/letters\/[^/?]+$/)
   await page.getByRole('button',{name:'Approve these letters',exact:true}).click()
   await page.waitForLoadState('domcontentloaded')
   await fits('receipt-review-'+width)
   const batchId=page.url().split('/').at(-1)
   await page.goto(origin+'/app/letters/'+batchId+'/print')
   const receipt=page.locator('.letter').filter({has:page.locator('.recipient').filter({hasText:`Wrenfield Foundation ${width}`})})
   assert.ok((await receipt.locator('.recipient').textContent()).includes('Attn: '+contactNames[0]))
   assert.ok((await receipt.locator('.letter-body').textContent()).includes('Dear Maya,'))
   await fits('receipt-print-'+width)
   await page.goto(origin+'/app/reports/states?year=2026')
   assert.ok((await page.locator('main').textContent()).includes('Minnesota'))
   await fits('state-report-'+width)
  }
  await page.close()
 })
}

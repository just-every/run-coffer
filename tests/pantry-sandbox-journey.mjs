// Manual live-provider proof. Run under heavy-slot; never registered with node:test.
// node tests/pantry-sandbox-journey.mjs PANTRY_CHECKOUT SCREENSHOTS PAYOUT_ID TRANSACTION_ID CHARGE_ID
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {installation,reviewed,donor} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
import {startPantry,controlTooltips} from './pantry-sandbox-runtime.mjs'

const money=n=>(n/100).toFixed(2)
const sum=(rows,key)=>rows.reduce((n,row)=>n+row[key],0)
export async function sandboxJourney({pantryCheckout,directory,payoutId,transactionId,chargeId}={}){
 assert.ok(pantryCheckout&&directory,'Pass Pantry checkout and screenshot directory')
 assert.match(payoutId??'',/^po_[A-Za-z0-9]+$/)
 assert.match(transactionId??'',/^txn_[A-Za-z0-9]+$/)
 assert.match(chargeId??'',/^ch_[A-Za-z0-9]+$/)
 const key=process.env.STRIPE_SECRET_KEY
 assert.ok(typeof key==='string'&&/^sk_test_/.test(key),'Inject a Stripe test secret key')
 const stripeRead=async path=>{
  const response=await fetch('https://api.stripe.com/v1/'+path,{headers:{authorization:'Bearer '+key}})
  assert.equal(response.status,200,'Stripe read refused')
  const data=await response.json()
  // Stripe balance transactions have no livemode field; their charge and payout do.
  if('livemode' in data)assert.equal(data.livemode,false,'Only test objects are allowed')
  return data
 }
 const [account,balance]=await Promise.all([stripeRead('account'),stripeRead('balance')])
 assert.equal(account.country,'US');assert.equal(account.default_currency,'usd');assert.ok(balance.available.some(b=>b.currency==='usd'))
 console.log(JSON.stringify({accountId:account.id,country:account.country,currency:account.default_currency,usdBalancePresent:true}))
 const [charge,payout,transaction]=await Promise.all([stripeRead('charges/'+chargeId),stripeRead('payouts/'+payoutId),stripeRead('balance_transactions/'+transactionId)])
 assert.equal(charge.livemode,false);assert.equal(payout.livemode,false)
 assert.equal(charge.paid,true);assert.equal(charge.status,'succeeded');assert.equal(charge.amount,15000)
 assert.equal(payout.status,'paid');assert.equal(payout.currency,'usd');assert.equal(payout.amount,14535);assert.equal(payout.automatic,false)
 assert.equal(transaction.amount,15000);assert.equal(transaction.fee,465);assert.equal(transaction.net,14535)
 assert.equal(typeof transaction.source==='string'?transaction.source:transaction.source.id,chargeId)
 const folder=resolve(directory);await mkdir(folder,{recursive:true})
 const pantry=await startPantry(resolve(pantryCheckout));let h
 try{
  const tag=randomUUID().slice(0,8),state=await pantry.api('/api/pantry/state')
  if(!state.settings.entity)await pantry.command('entity.save',{legalName:'Coffer sandbox evidence',entityType:'sole-proprietorship',state:'CA',fiscalYearStart:1,taxMethod:'accrual',booksStart:'2020-01-01'})
  if(!state.accounts.length)await pantry.command('chart.start',{})
  const create=(code,name,type,subtype='other')=>pantry.command('account.save',{code:code+'-'+tag,name,type,subtype})
  const accounts=[];for(const input of [
   ['1000','Coffer sandbox checking '+tag,'asset','bank'],['6400','Coffer sandbox fees '+tag,'expense'],
   ...['General','Reading','Meals'].map((name,i)=>[String(4100+i),`Coffer sandbox ${name} ${tag}`,'income'])
  ])accounts.push(await create(...input))
  const [bank,fee,...income]=accounts
  const fund=String(charge.metadata?.fund??'Unrestricted').trim()||'Unrestricted'
  const fundAccounts={Unrestricted:income[0].id,Reading:income[1].id,Meals:income[2].id};if(!Object.hasOwn(fundAccounts,fund))fundAccounts[fund]=income[0].id
  const agent=await pantry.command('agent.create',{name:'Coffer sandbox '+tag})
  let stripeRequests=0,proposalSubmissions=0
  // Pass requests to the actual providers. No Stripe or Pantry network substitutes.
  const outbound=async request=>{
   const url=new URL(request.url)
   assert.ok(url.hostname==='api.stripe.com'||url.origin===pantry.origin,'Unexpected outbound destination')
   if(url.hostname==='api.stripe.com'){
    assert.equal(request.method,'GET','This journey only reads existing Stripe objects')
    stripeRequests++
   }else if(request.method==='POST'){
    assert.equal(url.pathname,'/api/pantry/agent/proposals')
    proposalSubmissions++
   }
   return fetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),redirect:'manual',...(['GET','HEAD'].includes(request.method)?{}:{body:await request.arrayBuffer()})})
  }
  h=await installation({givingProtection:false,outbound,bindings:{STRIPE_SECRET_KEY:key,PANTRY_ORIGIN:pantry.origin,PANTRY_AGENT_TOKEN:agent.token,PANTRY_DEPOSIT_ACCOUNT:bank.id,PANTRY_FEE_ACCOUNT:fee.id,PANTRY_FUND_ACCOUNTS:JSON.stringify(fundAccounts)}})
  await reviewed(h)
  await withBrowserWorker(h,async(context,origin)=>{
   const page=await context.newPage();page.setDefaultTimeout(30_000)
   const capture=async(name,path,ownerPage=page)=>{
    for(const width of [1440,390]){
     await ownerPage.setViewportSize({width,height:1000})
     if(path)await ownerPage.goto(path)
     assert.ok(await ownerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} fits ${width}`)
     if(ownerPage===page)await controlTooltips(page)
     const file=`${folder}/${name}-${width}.png`
     await ownerPage.screenshot({path:file,fullPage:true})
     console.log(JSON.stringify({screenshot:file}))
    }
   }
   await page.goto(origin+'/app/payouts')
   await page.getByLabel('Payout ID (optional)',{exact:true}).fill(payoutId)
   await page.getByRole('button',{name:'Sync from Stripe',exact:true}).click()
   await page.getByRole('heading',{name:'Match a manual payout',exact:true}).waitFor()
   await capture('payout-unmatched',null)
   await page.getByLabel('Stripe balance transaction IDs',{exact:true}).fill(transactionId)
   await page.getByRole('checkbox',{name:'I checked that these transactions belong to this payout.',exact:true}).check()
   await page.getByRole('button',{name:'Match selected transactions',exact:true}).click()
   await page.getByText('Matched gift amounts balance to this payout.',{exact:true}).waitFor()
   const matched=await h.get('/api/coffer/payments/'+payoutId)
   assert.equal(matched.payout.complete,1);assert.equal(matched.payout.matched_cents,14535)
   assert.equal(matched.lines.length,1);assert.equal(matched.lines[0].charge_id,chargeId)
   assert.equal(sum(matched.splits,'gross_cents'),15000);assert.equal(sum(matched.splits,'fee_cents'),465)
   const imported=(await h.get('/api/coffer/donors')).donors.find(d=>d.email===charge.receipt_email)
   assert.ok(imported,'The Stripe gift has a matched donor')
   const profile=(await h.get('/api/coffer/donors/'+imported.id)).donor
   await h.command('donor.update',{donorId:profile.id,version:profile.version,name:'Maya Rivera',email:profile.email})
   const batch=await makeBatch(h,{page,origin,capture})
   const native=await h.get('/api/coffer/gift-batches?id='+batch.id)
   assert.equal(native.total_cents,60000);assert.equal(native.entries.length,3)
   await capture('closed-check-batch',origin+'/app/gifts/batches?id='+batch.id)
   const batchLink=page.locator(`a[href="/app/payouts/batches/${batch.id}"]`)
   assert.equal(await batchLink.count(),1,'Closed batch links to its native deposit')
   await batchLink.click();assert.equal(new URL(page.url()).pathname,'/app/payouts/batches/'+batch.id)
   const batchView=await h.get('/api/coffer/payments/batches/'+batch.id)
   assert.equal(sum(batchView.lines,'amount_cents'),60000)
   await proveDeposit({kind:'payout',id:payoutId,path:'/api/coffer/payments/'+payoutId,ui:'/app/payouts/'+payoutId,deposit:14535,gross:15000,fees:465,splits:matched.splits})
   await proveDeposit({kind:'batch',id:batch.id,path:'/api/coffer/payments/batches/'+batch.id,ui:'/app/payouts/batches/'+batch.id,deposit:60000,gross:60000,fees:0,splits:batchView.splits})

   async function proveDeposit({kind,id,path,ui,deposit,gross,fees,splits}){
    console.log(JSON.stringify({stage:'deposit-start',kind,id}))
    const current=()=>h.get(path),uiPath=origin+ui
    await capture(kind+'-matched',uiPath)
    const csvResponse=await h.request(path+'/evidence.csv');assert.equal(csvResponse.status,200)
    const bytes=Buffer.from(await csvResponse.arrayBuffer())
    const document=await pantry.command('document.upload',{name:`coffer-${kind}-${id}.csv`,mediaType:'text/csv',base64:bytes.toString('base64')})
    assert.equal(document.sha256,createHash('sha256').update(bytes).digest('hex'))
    const before=await pantry.api('/api/pantry/journal'),beforeIds=new Set(before.entries.map(e=>e.id))
    await page.goto(uiPath)
    await page.locator('input[name=documentId]').fill(document.id)
    await page.getByRole('button',{name:'Send to Pantry for approval',exact:true}).click()
    await page.getByText('Awaiting approval',{exact:true}).waitFor()
    const pending=(await current()).posting
    assert.equal(pending.state,'proposed');assert.equal(pending.external_id,null)
    const proposals=()=>pantry.api('/api/pantry/proposals')
    const matching=(await proposals()).proposals.filter(p=>p.id===pending.proposal_id)
    assert.equal(matching.length,1);assert.equal(matching[0].status,'proposed')
    assert.equal((await pantry.api('/api/pantry/journal')).entries.filter(e=>!beforeIds.has(e.id)).length,0,'Proposal creates no journal before human approval')
    const proposalCount=(await proposals()).proposals.length
    await h.api(path+'/post',{})
    assert.equal((await proposals()).proposals.length,proposalCount)
    await capture(kind+'-pending',uiPath)
    await pantry.page.goto(pantry.origin+'/app/agents')
    const card=pantry.page.locator('section.card').filter({has:pantry.page.getByText(matching[0].summary,{exact:true})}).filter({has:pantry.page.getByRole('button',{name:'Approve and post',exact:true})}).last()
    await card.getByRole('button',{name:'Approve and post',exact:true}).waitFor({state:'visible'})
    await pantry.page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Approve and post'&&!b.disabled),null,{timeout:60_000})
    await capture(kind+'-pantry-approval',null,pantry.page)
    await card.getByRole('button',{name:'Approve and post',exact:true}).click()
    const approvalDeadline=Date.now()+60_000
    while((await proposals()).proposals.find(p=>p.id===pending.proposal_id)?.status==='proposed'&&Date.now()<approvalDeadline)await new Promise(r=>setTimeout(r,250))
    assert.equal((await proposals()).proposals.find(p=>p.id===pending.proposal_id)?.status,'approved','Human approval posts the proposal')
    await page.goto(uiPath)
    await page.getByRole('button',{name:'Refresh Pantry posting',exact:true}).click()
    await page.getByText('Posted',{exact:true}).waitFor()
    const posted=(await current()).posting
    assert.equal(posted.state,'posted');assert.ok(posted.external_id)
    const approved=(await proposals()).proposals.find(p=>p.id===pending.proposal_id)
    assert.equal(approved.status,'approved');assert.equal(approved.result_id,posted.external_id);assert.equal(approved.result_kind,'journal')
    const entries=(await pantry.api('/api/pantry/journal')).entries
    const journal=entries.find(e=>e.id===posted.external_id)
    assert.ok(journal);assert.equal(journal.status,'posted');assert.equal(journal.proposal_id,pending.proposal_id);assert.equal(journal.document_id,document.id)
    assert.equal(sum(journal.lines,'debit_cents'),sum(journal.lines,'credit_cents'))
    assert.equal(journal.lines.filter(l=>l.account_id===bank.id).reduce((n,l)=>n+l.debit_cents-l.credit_cents,0),deposit)
    assert.equal(journal.lines.filter(l=>l.account_id===fee.id).reduce((n,l)=>n+l.debit_cents-l.credit_cents,0),fees)
    assert.equal(journal.lines.filter(l=>income.some(a=>a.id===l.account_id)).reduce((n,l)=>n+l.credit_cents-l.debit_cents,0),gross)
    for(const split of splits){const lines=journal.lines.filter(l=>l.account_id===fundAccounts[split.fund]);assert.equal(lines.reduce((n,l)=>n+l.credit_cents-l.debit_cents,0),split.gross_cents);assert.ok(lines.every(l=>l.class_name===split.fund),'Fund classes survive Pantry approval')}
    await capture(kind+'-posted',uiPath)
    await pantry.page.goto(pantry.origin+'/app/books')
    await pantry.page.getByRole('tab',{name:'Journal entries',exact:true}).click()
    await pantry.page.getByRole('row').filter({hasText:journal.memo}).click()
    await pantry.page.getByRole('heading',{name:`Entry ${journal.number} — ${journal.memo}`,exact:true}).waitFor()
    await capture(kind+'-pantry-posted',null,pantry.page)
    await h.api(path+'/post',{})
    assert.equal((await proposals()).proposals.length,proposalCount)
    assert.equal((await pantry.api('/api/pantry/journal')).entries.length,entries.length)
    assert.equal((await current()).posting.external_id,posted.external_id)
    console.log(JSON.stringify({kind,id,state:'posted',proposalId:pending.proposal_id,journalId:posted.external_id,depositCents:deposit,grossCents:gross,feeCents:fees}))
   }
   await page.close()
  })
  assert.ok(stripeRequests>0,'Coffer reached the live Stripe sandbox API')
  assert.equal(proposalSubmissions,2,'One actual Pantry proposal submission per deposit')
  console.log(JSON.stringify({stage:'complete',stripeRequests,proposalSubmissions}))
 }finally{if(h)await h.close();await pantry.close()}
}

async function makeBatch(h,{page,origin,capture}){
 const receivedOn='2026-10-24',people=await Promise.all(['Ada Morgan','Ben Ortiz','Cora Nguyen'].map(name=>donor(h,name)))
 await page.goto(origin+'/app/gifts/batches')
 await page.getByLabel('Batch name',{exact:true}).fill('Community program checks')
 await page.getByLabel('Received on',{exact:true}).fill(receivedOn)
 await page.getByLabel('Fund',{exact:true}).fill('Reading')
 await page.getByLabel('Expected deposit total (USD)',{exact:true}).fill('600.00')
 await page.getByRole('button',{name:'Start batch',exact:true}).click()
 await page.getByRole('heading',{name:'Donor lookup',exact:true}).waitFor()
 const id=new URL(page.url()).searchParams.get('id');assert.ok(id)
 for(const [i,person] of people.entries()){
  await page.getByLabel('Find donor by name, email, phone or legacy ID',{exact:true}).fill(person.name??['Ada Morgan','Ben Ortiz','Cora Nguyen'][i])
  await page.getByRole('button',{name:'Find donor',exact:true}).click()
  await page.getByRole('link',{name:'Select '+['Ada Morgan','Ben Ortiz','Cora Nguyen'][i],exact:true}).click()
  await page.getByLabel('Gift amount (USD)',{exact:true}).fill(money((i+1)*10000))
  await page.getByLabel('Gift fund',{exact:true}).fill(['Reading','Meals','Unrestricted'][i])
  await page.getByLabel('Check number',{exact:true}).fill(String(4471+i))
  if(i===0)await capture('check-entry',null)
  await page.getByRole('button',{name:'Add gift',exact:true}).click()
  await page.getByRole('heading',{name:'Batch rows',exact:true}).waitFor()
 }
 await page.getByRole('button',{name:'Close batch',exact:true}).click()
 await page.getByText('Closed deposit · 3 gifts · $600.00',{exact:true}).waitFor()
 return {id}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [pantryCheckout,directory,payoutId,transactionId,chargeId]=process.argv.slice(2)
 sandboxJourney({pantryCheckout,directory,payoutId,transactionId,chargeId}).catch(error=>{
  // Never dump provider requests, process output, native cookies or credentials.
  console.error('Pantry sandbox journey failed; no provider cleanup was performed.');console.error(String(error.message).replace(/https?:\/\/\S+/g,'[url]').replace(/(?:sk_test_|rk_test_|pantry_agent_)\S+/g,'[credential]').slice(0,1200));console.error(String(error.stack).split('\n').filter(line=>line.trim().startsWith('at ')).join('\n'))
  process.exitCode=1
 })
}

import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {run,reviewed} from '/workspace/run-coffer/tests/harness.mjs'
import {withBrowserWorker} from '/workspace/run-coffer/tests/browser-worker.mjs'
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),directory='/home/agent/rer-consolidation/work/sx-coffer-c-f174/packet/screens'
await run(async h=>{
 await reviewed(h)
 const order={id:3201,email:'synthetic-coffer-3201'+String.fromCharCode(64)+'example.test',customer:{id:3202},currency:'USD',financial_status:'paid',cancelled_at:null,processed_at:'2026-09-01T12:00:00Z',total_price:'74.20',total_tax:'3.20',total_discounts:'0.00',total_shipping_price_set:{shop_money:{amount:'6.00',currency_code:'USD'}},line_items:[{id:3203,quantity:1,price:'40.00',total_discount:'0.00',tax_lines:[{price:'3.20'}],properties:[{name:'_coffer_kind',value:'merchandise'}]},{id:3204,quantity:1,price:'25.00',total_discount:'0.00',tax_lines:[],properties:[{name:'_coffer_kind',value:'donation'},{name:'_coffer_fund',value:'Reading'},{name:'_coffer_campaign',value:'none'}]}]}
 const raw=JSON.stringify(order),signature=createHmac('sha256','synthetic-coffer-3205').update(raw).digest('base64')
 const response=await h.request('/api/coffer/shops/shopify/webhook',{method:'POST',raw,as:'',headers:{'x-shopify-shop-domain':'synthetic-coffer-3206.myshopify.com','x-shopify-topic':['orders','paid'].join('/'),'x-shopify-event-id':'synthetic-coffer-3207','x-shopify-hmac-sha256':signature}})
 assert.equal(response.status,200)
 const key=(await response.json()).id,view=await h.get('/api/coffer/payments/shops/'+key)
 assert.equal(view.state,'held');assert.equal(view.gift_id,null)
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  try{
   await page.goto(origin+'/app/payouts/shops/'+key)
   assert.match(await page.locator('main').innerText(),/State:\s*held/)
   assert.match(await page.locator('main').innerText(),/No contribution has been recorded/)
   assert.match(await page.locator('main').innerText(),/\$74\.20/)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:directory+'/held-order-'+width+'.png',fullPage:true})}
  }finally{await page.close()}
 })
 console.info('HELD_PUBLIC_DOOR_PROBE head='+head+' state=held gift=null wholeOrderCents=7420 widths=1440,390 PASS')
},{entry:'tests/fixed-clock-worker.ts',bindings:{SHOPIFY_SHOP_DOMAIN:'synthetic-coffer-3206.myshopify.com',SHOPIFY_SHOP_ID:'3208',SHOPIFY_WEBHOOK_SECRET:'synthetic-coffer-3205',SHOPIFY_ACCESS_TOKEN:'synthetic-coffer-3209'},outbound:async()=>assert.fail('The initial source hold makes no provider network request')})

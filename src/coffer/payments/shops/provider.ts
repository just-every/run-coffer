import { fail, type Row } from '../../db'
import { managed, stripe, type GivingEnv } from '../../giving/stripe'

export type ShopEnv=GivingEnv & { SHOPIFY_SHOP_DOMAIN?:string; SHOPIFY_SHOP_ID?:string; SHOPIFY_ACCESS_TOKEN?:string; SHOPIFY_WEBHOOK_SECRET?:string; SHOPIFY_STRIPE_ACCOUNT?:string }
export const home=(env:ShopEnv)=>env.RER_INSTALLATION_ID||env.AUTH_ORIGIN
export function connection(env:ShopEnv){
 if(managed(env))fail('not_available','Shopify is not available yet on RER Managed.',503)
 const domain=env.SHOPIFY_SHOP_DOMAIN??'',shop=env.SHOPIFY_SHOP_ID??''
 if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)||!/^\d+$/.test(shop)||!env.SHOPIFY_ACCESS_TOKEN||!env.SHOPIFY_WEBHOOK_SECRET)fail('SHOP_UNAVAILABLE','The installation owner must configure the Shopify shop and private connection.',503)
 return {domain,shop}
}
export function decimal(value:unknown,signed=false):number{
 if(typeof value!=='string'||!(signed?/^-?\d{1,9}\.\d{2}$/:/^\d{1,9}\.\d{2}$/).test(value))fail('SHOP_FACTS','Shopify must supply exact USD decimal amounts.')
 const n=Math.round(Number(value)*100);if(!Number.isSafeInteger(n))fail('SHOP_FACTS','The source amount is unsupported.');return n
}
export function sourceId(value:unknown){if(!(typeof value==='string'&&/^\d+$/.test(value)||typeof value==='number'&&Number.isSafeInteger(value)&&value>0))fail('SHOP_FACTS','Shopify must supply a stable source identity.');return String(value)}
export function orderFacts(order:Row){
 const orderId=sourceId(order.id)
 if(order.currency!=='USD'||!['paid','refunded'].includes(order.financial_status)||order.cancelled_at||order.total_discounts!=='0.00'||!Array.isArray(order.line_items)||!order.line_items.length||order.line_items.length>100)fail('SHOP_FACTS','Only unchanged one-time paid USD orders without discounts are supported.')
 const email=String(order.email??'').trim().toLowerCase()
 if(!email||!email.includes('@')||!/^\d{4}-\d{2}-\d{2}T/.test(order.processed_at??'')||!Number.isFinite(Date.parse(order.processed_at)))fail('SHOP_FACTS','The order needs its source email and paid date.')
 const lines=order.line_items.map((l:Row)=>{
  if(!Number.isInteger(l.quantity)||l.quantity<1||!Array.isArray(l.tax_lines)||!Array.isArray(l.properties)||l.total_discount!=='0.00'||l.selling_plan_allocation||l.selling_plan_id)fail('SHOP_FACTS','Line quantities, discounts, tax and properties must be complete.')
  const properties:Record<string,string>={}
  for(const p of l.properties){if(typeof p.name!=='string'||typeof p.value!=='string'||p.name in properties)fail('SHOP_FACTS','Source properties conflict.');if(['_coffer_kind','_coffer_fund','_coffer_campaign'].includes(p.name))properties[p.name]=p.value}
  return {id:sourceId(l.id),benefit:l.gift_card===true||l.requires_shipping===true,quantity:l.quantity,price:decimal(l.price),tax:l.tax_lines.reduce((s:number,t:Row)=>s+decimal(t.price),0),properties}
 })
 if(new Set(lines.map((l:Row)=>l.id)).size!==lines.length)fail('SHOP_FACTS','Source lines conflict.')
 const total=decimal(order.total_price),tax=decimal(order.total_tax),shipping=decimal(order.total_shipping_price_set?.shop_money?.amount)
 if(order.total_shipping_price_set?.shop_money?.currency_code!=='USD'||total!==lines.reduce((s:number,l:Row)=>s+l.price*l.quantity,0)+shipping+tax)fail('SHOP_FACTS','The complete order totals do not reconcile.')
 return {orderId,email,date:order.processed_at.slice(0,10),total,tax,shipping,lines}
}
async function read(env:ShopEnv,path:string){
 const {domain}=connection(env),url='https://'+domain+'/admin/api/2026-10/'+path
 let response:Response
 try{response=await fetch(url,{headers:{'X-Shopify-Access-Token':env.SHOPIFY_ACCESS_TOKEN!},redirect:'manual',signal:AbortSignal.timeout(30000)})}catch{fail('SHOP_PROVIDER','Shopify could not be read. Nothing was released.',502)}
 if(!response.ok)fail('SHOP_PROVIDER','Shopify did not confirm complete source facts.',502)
 let body:Row;try{body=await response.json()}catch{fail('SHOP_PROVIDER','Shopify returned unreadable source facts.',502)}
 return {body,link:response.headers.get('link')}
}
/** Documented REST Order, Transaction and Shopify Payments balance resources.
 * The balance listing is exhausted before matching, never guessed from dates. */
async function orderObservation(env:ShopEnv,orderId:string){
 const bound=connection(env),shop=(await read(env,'shop.json')).body.shop
 if(String(shop?.id)!==bound.shop||shop?.myshopify_domain!==bound.domain)fail('SHOP_BINDING','Shopify did not confirm this installation shop.')
 const order=(await read(env,'orders/'+orderId+'.json')).body.order,facts=orderFacts(order??{})
 if(facts.orderId!==orderId)fail('SHOP_BINDING','Shopify returned a different order.')
 const result=await read(env,'orders/'+orderId+'/transactions.json')
 if(result.link||!Array.isArray(result.body.transactions))fail('SHOP_PROVIDER','The payment history is incomplete.',502)
 const txs=result.body.transactions as Row[]
 if(txs.some(t=>!['sale','capture','authorization','refund','void'].includes(t.kind)||t.status!=='success'))fail('SHOP_FACTS','Uncertain or unsupported payment history stays held.')
 const captures=txs.filter(t=>['sale','capture'].includes(t.kind)),refunds=txs.filter(t=>t.kind==='refund')
 if(captures.length!==1||decimal(captures[0].amount)!==facts.total||captures[0].currency!=='USD')fail('SHOP_FACTS','Only one complete USD payment is supported.')
 const capture=captures[0],payment=sourceId(capture.id)
 if(txs.some(t=>String(t.order_id)!==orderId||t.currency!=='USD')||new Set(txs.map(t=>sourceId(t.id))).size!==txs.length)fail('SHOP_BINDING','Payment identities conflict.')
 if(refunds.length>1||refunds.some(r=>String(r.parent_id)!==payment||r.gateway!==capture.gateway||decimal(r.amount)!==facts.total))fail('SHOP_FACTS','Partial or ambiguous refunds stay held.')
 const refund=refunds[0],refundId=refund?sourceId(refund.id):null
 if((order.financial_status==='refunded')!==Boolean(refundId))fail('SHOP_FACTS','Order and full-refund observations conflict.')
 return {facts,payment,refundId,capture,refund}
}

async function linkedProcessor(env:ShopEnv,facts:Row,capture:Row,refund:Row|undefined,ownershipOnly=false){
 if(!env.SHOPIFY_STRIPE_ACCOUNT||!/^ch_[A-Za-z0-9_]+$/.test(capture.authorization??''))fail('SHOP_GATEWAY','This gateway or shared processor ownership is unsupported and stays held.')
 const account=(await stripe(env,'/account')).id
 if(account!==env.SHOPIFY_STRIPE_ACCOUNT)fail('SHOP_BINDING','The linked processor account is not this shop connection.')
 const chargeId=String(capture.authorization),charge=await stripe(env,'/charges/'+encodeURIComponent(chargeId))
 if(charge.id!==chargeId||charge.currency!=='usd'||charge.amount!==facts.total||charge.paid!==true||charge.status!=='succeeded'||!ownershipOnly&&(charge.amount_refunded!==(refund?facts.total:0)||typeof charge.balance_transaction!=='string'))fail('SHOP_BINDING','The linked charge does not confirm the complete order.')
 if(charge.metadata?.coffer_intent||charge.metadata?.coffer_pledge_checkout)fail('SHOP_PROCESSOR_CONFLICT','This charge already belongs to a Coffer checkout.')
 const processorRefs=[chargeId,charge.payment_intent,typeof charge.invoice==='string'?charge.invoice:null].filter((v):v is string=>typeof v==='string'&&Boolean(v))
 return {account,chargeId,charge,processorRefs}
}

/** Establish linked-charge ownership at signed observation, before fee allocation
 * or donor review. Missing settlement evidence must not release merchandise. */
export async function processorObservation(env:ShopEnv,orderId:string){
 const bound=connection(env),shop=(await read(env,'shop.json')).body.shop
 if(String(shop?.id)!==bound.shop||shop?.myshopify_domain!==bound.domain)fail('SHOP_BINDING','Shopify did not confirm this installation shop.')
 const order=(await read(env,'orders/'+orderId+'.json')).body.order
 if(!order||sourceId(order.id)!==orderId)fail('SHOP_BINDING','Shopify returned a different order.')
 const result=await read(env,'orders/'+orderId+'/transactions.json')
 if(result.link||!Array.isArray(result.body.transactions))fail('SHOP_PROVIDER','The payment history is incomplete.',502)
 const captures=result.body.transactions.filter((t:Row)=>['sale','capture'].includes(t.kind)&&t.gateway==='stripe'&&t.status==='success')
 if(!captures.length)return null
 const capture=captures[0],facts={total:decimal(order.total_price)}
 if(captures.length!==1||String(capture.order_id)!==orderId||capture.currency!=='USD'||order.currency!=='USD'||decimal(capture.amount)!==facts.total)fail('SHOP_BINDING','The linked payment does not confirm this complete order.')
 return linkedProcessor(env,facts,capture,undefined,true)
}

export async function observe(env:ShopEnv,orderId:string){
 const bound=connection(env),{facts,payment,refundId,capture,refund}=await orderObservation(env,orderId)
 let processorRefs:string[]=[],fee=0,refundFee=0,settlement:string|null=null,chargeId:string|null=null,account:string|null=null,balances:Row[]=[]
 if(capture.gateway==='shopify_payments'){
  let path='shopify_payments/balance/transactions.json?limit=250'
  const seen=new Set<string>()
  for(let page=0;page<20;page++){
   if(seen.has(path))fail('SHOP_PROVIDER','The settlement history repeated a page.',502);seen.add(path)
   const response=await read(env,path)
   if(!Array.isArray(response.body.transactions))fail('SHOP_PROVIDER','Settlement facts are incomplete.',502)
   balances.push(...response.body.transactions)
   const next=response.link?.match(/<([^>]+)>; rel="next"/)
   if(!next)break
   const url=new URL(next[1]);if(url.origin!=='https://'+bound.domain||url.pathname!=='/admin/api/2026-10/shopify_payments/balance/transactions.json'||page===19)fail('SHOP_PROVIDER','The complete settlement history could not be read.',502)
   path=url.pathname.split('/2026-10/')[1]+url.search
  }
  const exact=(transaction:string,type:string,amount:number)=>{
   const matches=balances.filter(b=>String(b.source_order_transaction_id)===transaction)
   if(matches.length!==1)fail('SHOP_FEES','Actual settled payment and fee evidence is missing or ambiguous.')
   const b=matches[0]
   if(String(b.source_order_id)!==orderId||b.source_type!==type||b.currency!=='USD'||b.payout_status!=='paid'||!b.payout_id||decimal(b.amount,true)!==amount||decimal(b.net,true)!==amount-decimal(b.fee,true))fail('SHOP_FEES','Actual settled payment and fee evidence does not reconcile.')
   return b
  }
  const paid=exact(payment,'charge',facts.total);fee=decimal(paid.fee,true);settlement=sourceId(paid.payout_id)
  balances=[paid,...(refund?[exact(refundId!,'refund',-facts.total)]:[])]
  if(refund)refundFee=decimal(balances[1].fee,true)
 }else if(capture.gateway==='stripe'){
  const linked=await linkedProcessor(env,facts,capture,refund),charge=linked.charge
  account=linked.account;chargeId=linked.chargeId;processorRefs=linked.processorRefs
  const b=await stripe(env,'/balance_transactions/'+encodeURIComponent(charge.balance_transaction))
  if(b.id!==charge.balance_transaction||b.source!==chargeId||b.currency!=='usd'||b.amount!==facts.total||!Number.isSafeInteger(b.fee)||b.net!==b.amount-b.fee||b.status!=='available')fail('SHOP_FEES','The linked payment fee is incomplete.')
  fee=b.fee;balances=[b]
  // Linked refunds require their own documented gateway reference; unsupported
  // references remain held rather than borrowing the charge fee.
  if(refund)fail('SHOP_FACTS','Linked gateway refund qualification remains held.')
 }else fail('SHOP_GATEWAY','This gateway or shared processor ownership is unsupported and stays held.')
 if(fee<0||fee>facts.total)fail('SHOP_FEES','The actual payment fee is invalid.')
 return {facts,payment,refundId,fee,refundFee,settlement,chargeId,account,balances:balances.map(b=>({id:String(b.id),amount:b.amount,fee:b.fee,net:b.net,currency:b.currency,source_order_id:b.source_order_id,source_order_transaction_id:b.source_order_transaction_id,source_type:b.source_type,payout_id:b.payout_id,payout_status:b.payout_status,source:typeof b.source==='string'?b.source:undefined,status:b.status})),processorRefs}
}

import { date, email, fail, optional, text, type Row } from './db'
import { amount } from './money'
import { parseCsv } from './move-in/parse-input'

export type AuctionInputRow = {
 sourceRow:number; lot:string; item:string; kind:'lot'|'fund_a_need'|'donated_item';
 bidderName:string; bidderEmail:string|null; bidderKey:string; amountCents:number;
 fairValueCents:number|null; paid:number; quantity:string; statedValueCents:number;propertyGoods:'unknown'|'none'
}
const normalize=(value:string)=>value.trim().toLowerCase().replace(/[^a-z0-9]/g,'')
const names:Record<string,string[]>={
 lot:['lot','lotid','lotnumber','itemnumber','packagenumber','packageid'],
 item:['item','itemname','description','packagename','itemdescription'],
 bidder:['winningbidder','bidder','biddername','winner','winnername','donorname','purchasername','supportername'],
 email:['bidderemail','winningbidderemail','winneremail','email','donoremail','purchaseremail'],
 bidderId:['bidderid','winningbidderid','paddlenumber','paddle','supporterid','constituentid'],
 bid:['winningbid','bid','amount','amountpaid','saleprice','purchaseamount','winningamount'],
 fairValue:['fairmarketvalue','fmv','fairvalue','itemvalue','retailvalue'],
 paid:['paidstatus','paid','paymentstatus','status'], kind:['type','rowtype','transactiontype','itemtype'],
 quantity:['quantity','qty'], statedValue:['donorstatedvalue','statedvalue','donatedvalue'],propertyGoods:['donorgoodsanswer','goodsanswer'],
}

/** Normalize source headers, never money or an absent benefit answer by guess. */
export function auctionCsv(input:Row):{csv:string;source:string;receivedOn:string;rows:AuctionInputRow[]} {
 text(input.csv,'Auction CSV',1024*1024)
 const csv=input.csv as string,source=(optional(input.source,'Auction platform',80)??'Auction CSV').toLowerCase(),receivedOn=date(input.receivedOn,'Payment received on')
 if(new TextEncoder().encode(csv).byteLength>1024*1024)fail('AUCTION_CSV','Upload a CSV of at most 1 MB.',413)
 let cells:ReturnType<typeof parseCsv>
 try{cells=parseCsv(csv)}catch(error){fail('AUCTION_CSV',String(error instanceof Error?error.message:error),400)}
 if(cells.length<2||cells.length>101)fail('AUCTION_CSV','Review between 1 and 100 auction rows at a time.',400)
 const headers=cells[0].map(v=>normalize(String(v))),columns:Record<string,number>={}
 for(const [key,aliases] of Object.entries(names)){
  const matches=headers.flatMap((h,i)=>aliases.includes(h)?[i]:[])
  if(matches.length>1)fail('AUCTION_CSV',`Several columns describe ${key}. Keep one unambiguous column.`,400)
  if(matches.length)columns[key]=matches[0]
 }
 for(const key of ['lot','item','bidder'])if(columns[key]===undefined)fail('AUCTION_CSV',`The auction CSV needs a ${key==='bidder'?'Winning bidder':key} column.`,400)
 const seen=new Set<string>(),identities=new Map<string,string>()
 const rows=cells.slice(1).map((cells,index)=>({cells,index})).filter(({cells})=>cells.some(v=>String(v??'').trim())).map(({cells,index}):AuctionInputRow=>{
  const row=index+2,get=(key:string)=>String(cells[columns[key]]??'').trim(),label=(field:string)=>`Row ${row} ${field}`
  if(cells.length!==headers.length)fail('AUCTION_CSV',`Row ${row} has a different number of columns from the header.`,400)
  const rawKind=normalize(get('kind')||'lot'),kind=rawKind==='lot'||rawKind==='auction'?'lot':['fundaneed','paddleraise','donation'].includes(rawKind)?'fund_a_need':['donateditem','inkind','property'].includes(rawKind)?'donated_item':fail('AUCTION_CSV',`${label('type')} must be lot, fund-a-need or donated item.`,400)
  if(kind!=='donated_item')for(const key of ['bid','paid'])if(columns[key]===undefined)fail('AUCTION_CSV',`The CSV needs a ${key==='bid'?'Winning bid':'Paid status'} column.`,400)
  if(kind==='lot'&&columns.fairValue===undefined)fail('AUCTION_CSV','The CSV needs a Fair market value column. Leave an unknown value blank for review.',400)
  const lot=text(get('lot'),label('lot'),100),item=text(get('item'),label('item'),300),bidderName=text(get('bidder'),label('winning bidder'),200),bidderEmail=email(get('email'),label('bidder email'))
  const key=kind+':'+lot.toLowerCase()
  if(seen.has(key))fail('AUCTION_DUPLICATE',`Row ${row} repeats ${lot}. Nothing was imported.`,400)
  seen.add(key)
  const bidderKey=get('bidderId')?'id:'+text(get('bidderId'),label('bidder ID'),100):'person:'+bidderName.toLowerCase()+'|'+(bidderEmail??'')
  const identity=JSON.stringify([bidderName.toLowerCase(),bidderEmail]),prior=identities.get(bidderKey)
  if(prior&&prior!==identity)fail('AUCTION_CSV',`${label('bidder ID')} has conflicting names or emails. Correct the source identity before preview.`,400)
  identities.set(bidderKey,identity)
  const rawPaid=normalize(get('paid')),paid=kind==='donated_item'?0:['paid','yes','true','1','complete','completed','settled'].includes(rawPaid)?1:['unpaid','no','false','0','pending','outstanding','open'].includes(rawPaid)?0:fail('AUCTION_CSV',`${label('paid status')} must explicitly say paid or unpaid.`,400)
  const amountCents=kind==='donated_item'?0:amount({bid:get('bid')},'bid',label('winning bid'))
  const fairValueCents=kind==='fund_a_need'?0:get('fairValue')?amount({value:get('fairValue')},'value',label('fair market value'),{allowZero:true}):null
  if(kind==='fund_a_need'&&get('fairValue')&&amount({value:get('fairValue')},'value',label('fair market value'),{allowZero:true})!==0)fail('AUCTION_CSV',`${label('fund-a-need')} cannot include a benefit value.`,400)
  const quantity=get('quantity')||'1'
  if(!/^\d{1,9}(\.\d{1,6})?$/.test(quantity)||Number(quantity)<=0)fail('AUCTION_CSV',`${label('quantity')} must be positive with at most six decimal places.`,400)
  const statedValueCents=kind==='donated_item'?amount({value:get('statedValue')},'value',label('donor-stated value'),{allowZero:true}):0
  const answer=normalize(get('propertyGoods')),propertyGoods=!answer||answer==='unknown'?'unknown':answer==='none'?'none':fail('AUCTION_CSV',`${label('donor goods answer')} must be none or unknown. Record other benefits through the property register.`,400)
  return {sourceRow:row,lot,item,kind,bidderName,bidderEmail,bidderKey,amountCents,fairValueCents,paid,quantity,statedValueCents,propertyGoods}
 })
 if(!rows.length)fail('AUCTION_CSV','Add at least one auction result row.',400)
 return {csv,source,receivedOn,rows}
}

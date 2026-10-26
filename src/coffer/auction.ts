import { all, fail, id, type Context, type Row } from './db'
import { auctionAuthority, auctionEvent, auctionJob, auctionRows } from './auction-core'
import { previewAuction, matchAuctionBidder } from './auction-review'
import { applyAuction, reviewAuctionValue } from './auction-write'
import { undoAuction } from './auction-undo'

export const AUCTION_COMMANDS=['auction.preview','auction.match','auction.apply','auction.value','auction.settle','auction.undo'] as const
export async function auctionCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(!AUCTION_COMMANDS.includes(command as typeof AUCTION_COMMANDS[number]))return undefined
 auctionAuthority(c)
 if(command==='auction.preview')return previewAuction(c,p)
 if(command==='auction.match')return matchAuctionBidder(c,p)
 if(command==='auction.apply')return applyAuction(c,p)
 if(command==='auction.undo')return undoAuction(c,p)
 return reviewAuctionValue(c,command,p)
}

export async function auctionState(c:Context,eventId:string,jobId?:string){
 auctionAuthority(c)
 const event=await auctionEvent(c,eventId),jobs=await all(c,'SELECT id,source,state,version,created_at,applied_at,undone_at FROM cf_auction_jobs WHERE event_id=? ORDER BY created_at DESC,id',event.id)
 const selected=jobId?await auctionJob(c,jobId):jobs.length?await auctionJob(c,jobs[0].id):null
 if(selected&&selected.event_id!==event.id)fail('NOT_FOUND','That import belongs to another event.',404)
 const rows=selected?await auctionRows(c,selected.id):[]
 const balances=await all(c,'SELECT id,net_cents FROM cf_gift_balances WHERE id IN(SELECT gift_id FROM cf_auction_rows WHERE job_id=?)',selected?.id??'')
 const projected:Row[]=rows.map(row=>{
  const remaining=balances.find(b=>b.id===row.gift_id)?.net_cents??0
  const preview=selected?.state==='preview',outcome=row.status==='preview'&&preview?(row.kind==='donated_item'?'property':!row.paid?'open':row.fair_value_cents===null?'held':row.amount_cents>row.fair_value_cents?'gift':'purchase'):row.status
  return {...row,outcome,candidates:JSON.parse(row.candidates),paymentCents:row.paid&&row.kind!=='donated_item'&&(preview||row.status!=='preview')?row.amount_cents:0,deductibleCents:outcome==='gift'?Math.max(0,(preview?row.amount_cents:remaining)-(row.fair_value_cents??0)):0,openBalanceCents:outcome==='open'?row.amount_cents:0}
 })
 const active=projected.filter(r=>r.status!=='undone')
 return {event,jobs,job:selected,rows:projected,summary:{paymentsCents:active.reduce((n,r)=>n+r.paymentCents,0),deductibleCents:active.reduce((n,r)=>n+r.deductibleCents,0),purchaseRevenueCents:active.filter(r=>r.outcome==='purchase').reduce((n,r)=>n+r.amount_cents,0),openBalanceCents:active.reduce((n,r)=>n+r.openBalanceCents,0),held:active.filter(r=>r.outcome==='held').length,unreviewed:active.filter(r=>r.decision==='unreviewed').length}}
}

/** A donor's financial facts contain no other candidate or source-file data. */
export async function auctionDonorRows(c:Context,donorId:string){
 auctionAuthority(c)
 return all(c,`SELECT r.id,r.job_id,r.lot,r.item,r.kind,r.status,r.amount_cents,r.fair_value_cents,r.paid,r.received_on,r.gift_id,r.property_id,j.event_id,e.name AS event_name
 FROM cf_auction_rows r JOIN cf_auction_jobs j ON j.id=r.job_id JOIN cf_fundraising_events e ON e.id=j.event_id WHERE r.donor_id=? AND j.state IN('applied','redacted') ORDER BY r.received_on DESC,r.id`,id(donorId,'Donor'))
}

/** Call after the shared origin and session guard. Normal forms use /app/actions;
 * the file form needs this bounded multipart adapter before the page GET. */
export async function auctionUploadResponse(request:Request,c:Context):Promise<Response|null>{
 const match=new URL(request.url).pathname.match(/^\/app\/events\/([^/]+)\/auctions\/upload$/)
 if(!match)return null
 auctionAuthority(c)
 if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers:{Allow:'POST'}})
 if(Number(request.headers.get('content-length')??0)>1100000)fail('AUCTION_CSV','Upload a CSV of at most 1 MB.',413)
 const form=await request.formData(),file=form.get('file')
 if(!(file instanceof File)||file.size>1024*1024||!file.name.toLowerCase().endsWith('.csv'))fail('AUCTION_CSV','Choose a CSV file of at most 1 MB.',400)
 let csv:string
 try{csv=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer())}catch{fail('AUCTION_CSV','Save the auction CSV as UTF-8 and upload it again.',400)}
 const result=await previewAuction(c,{eventId:decodeURIComponent(match[1]),csv,source:form.get('source'),receivedOn:form.get('receivedOn')})
 return new Response(null,{status:303,headers:{location:`/app/events/${encodeURIComponent(result.eventId)}/auctions?jobId=${encodeURIComponent(result.jobId)}`,'cache-control':'no-store'}})
}

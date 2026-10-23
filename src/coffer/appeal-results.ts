import { all, one, type Row } from './db'

/** COMM-008: signed fund-ledger facts, never inferred tracking or delivery. */
export async function appealResults(c: { db: D1Database }, appealId: string) {
 const run = await one(c,'SELECT * FROM cf_appeal_runs WHERE appeal_id=?',appealId)
 if (!run) return { bound:false as const, code:null, note:'Historical run: no response code binding; results unknown.', comparison:[] }
 const summarize = async (r: Row) => {
  const entries = await all(c,`SELECT l.*,ga.appeal AS response_code FROM cf_fund_ledger l JOIN cf_gift_appeals ga ON ga.gift_id=l.gift_id JOIN cf_appeal_codes code ON code.code=ga.appeal WHERE ga.appeal=? COLLATE NOCASE OR code.mail_appeal_id=?`,r.code,r.appeal_id)
  const gifts = new Map<string, { donor:string; cents:number; code:string }>()
  for (const e of entries) {
   const g = gifts.get(e.gift_id) ?? {donor:e.donor_id,cents:0,code:e.response_code}
   g.cents += Number(e.amount_cents); gifts.set(e.gift_id,g)
  }
  const positive = [...gifts.values()].filter(g=>g.cents>0)
  const recipients = await all(c,'SELECT donor_id FROM cf_appeal_recipients WHERE appeal_id=?',r.appeal_id)
  const responding = new Set(positive.map(g=>g.donor))
  const responded = recipients.filter(d=>responding.has(d.donor_id)).length
  const dollarsCents = entries.reduce((n,e)=>n+Number(e.amount_cents),0)
  const outcomes = await all(c,"SELECT remote_status FROM cf_communications WHERE source_kind='appeal' AND source_id=?",r.appeal_id)
  const pieces = r.channel==='mail' ? await all(c,'SELECT id,response_code,name FROM cf_appeal_pieces WHERE appeal_id=? AND response_code IS NOT NULL ORDER BY name,id',r.appeal_id) : []
  const pieceResults=pieces.map(p=>{
   const lines=entries.filter(e=>String(e.response_code).toLowerCase()===String(p.response_code).toLowerCase()),balances=new Map<string,number>()
   for(const e of lines)balances.set(e.gift_id,(balances.get(e.gift_id)??0)+Number(e.amount_cents))
   const gifts=[...balances.values()].filter(n=>n>0).length
   return {pieceId:p.id,name:p.name,code:p.response_code,responded:gifts>0,gifts,dollarsCents:lines.reduce((sum,e)=>sum+Number(e.amount_cents),0)}
  })
  const pieceCount=r.channel==='mail'?(JSON.parse(r.segment).pieceCount??pieces.length):null
  const pieceCodes=await all(c,'SELECT code FROM cf_appeal_codes WHERE mail_appeal_id=?',r.appeal_id)
  const respondingCodes=new Set(positive.map(g=>g.code.toLowerCase()))
  const respondedPieces=pieceCodes.filter(p=>respondingCodes.has(p.code.toLowerCase())).length
  const delivered = r.channel==='mail' ? null : outcomes.filter(o=>o.remote_status==='delivered').length
  return {pieceCount,respondedPieces:pieceCount===null?null:respondedPieces,pieceResponseRate:pieceCount?respondedPieces/pieceCount:null,pieces:pieceResults,id:r.appeal_id,name:r.name,channel:r.channel,code:r.code,recipients:recipients.length,
   delivered,deliveryUnknown:r.channel==='mail'?recipients.length:recipients.length-outcomes.filter(o=>['delivered','bounced','rejected','failed'].includes(o.remote_status)).length,
   opened:null,clicked:null,responded,responseRate:recipients.length?responded/recipients.length:0,
   gifts:positive.length,dollarsCents,averageGiftCents:positive.length?Math.round(dollarsCents/positive.length):null,
   costCents:r.cost_cents,returnCents:dollarsCents-r.cost_cents,returnRatio:r.cost_cents?(dollarsCents-r.cost_cents)/r.cost_cents:null}
 }
 const current = await one(c,'SELECT r.*,a.name,a.channel,a.segment,a.prepared_at FROM cf_appeal_runs r JOIN cf_appeals a ON a.id=r.appeal_id WHERE r.appeal_id=?',appealId)
 const earlier = await all(c,`SELECT r.*,a.name,a.channel,a.segment FROM cf_appeal_runs r JOIN cf_appeals a ON a.id=r.appeal_id
 WHERE a.prepared_at<? OR (a.prepared_at=? AND a.id<?) ORDER BY a.prepared_at DESC,a.id DESC`,current!.prepared_at,current!.prepared_at,appealId)
 return {bound:true as const,...await summarize(current!),comparison:await Promise.all(earlier.map(summarize))}
}

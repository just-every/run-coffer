import { all, one, type Row } from './db'

/** COMM-008: signed fund-ledger facts, never inferred tracking or delivery. */
export async function appealResults(c: { db: D1Database }, appealId: string) {
 const run = await one(c,'SELECT * FROM cf_appeal_runs WHERE appeal_id=?',appealId)
 if (!run) return { bound:false as const, code:null, note:'Historical run: no response code binding; results unknown.', comparison:[] }
 const summarize = async (r: Row) => {
  const entries = await all(c,`SELECT l.* FROM cf_fund_ledger l JOIN cf_gift_appeals ga ON ga.gift_id=l.gift_id WHERE ga.appeal=? COLLATE NOCASE`,r.code)
  const gifts = new Map<string, { donor:string; cents:number }>()
  for (const e of entries) {
   const g = gifts.get(e.gift_id) ?? {donor:e.donor_id,cents:0}
   g.cents += Number(e.amount_cents); gifts.set(e.gift_id,g)
  }
  const positive = [...gifts.values()].filter(g=>g.cents>0)
  const recipients = await all(c,'SELECT donor_id FROM cf_appeal_recipients WHERE appeal_id=?',r.appeal_id)
  const responding = new Set(positive.map(g=>g.donor))
  const responded = recipients.filter(d=>responding.has(d.donor_id)).length
  const dollarsCents = entries.reduce((n,e)=>n+Number(e.amount_cents),0)
  const outcomes = await all(c,"SELECT remote_status FROM cf_communications WHERE source_kind='appeal' AND source_id=?",r.appeal_id)
  const delivered = r.channel==='mail' ? null : outcomes.filter(o=>o.remote_status==='delivered').length
  return {id:r.appeal_id,name:r.name,channel:r.channel,code:r.code,recipients:recipients.length,
   delivered,deliveryUnknown:r.channel==='mail'?recipients.length:recipients.length-outcomes.filter(o=>['delivered','bounced','rejected','failed'].includes(o.remote_status)).length,
   opened:null,clicked:null,responded,responseRate:recipients.length?responded/recipients.length:0,
   gifts:positive.length,dollarsCents,averageGiftCents:positive.length?Math.round(dollarsCents/positive.length):null,
   costCents:r.cost_cents,returnCents:dollarsCents-r.cost_cents,returnRatio:r.cost_cents?(dollarsCents-r.cost_cents)/r.cost_cents:null}
 }
 const current = await one(c,'SELECT r.*,a.name,a.channel,a.prepared_at FROM cf_appeal_runs r JOIN cf_appeals a ON a.id=r.appeal_id WHERE r.appeal_id=?',appealId)
 const earlier = await all(c,`SELECT r.*,a.name,a.channel FROM cf_appeal_runs r JOIN cf_appeals a ON a.id=r.appeal_id
 WHERE a.prepared_at<? OR (a.prepared_at=? AND a.id<?) ORDER BY a.prepared_at DESC,a.id DESC`,current!.prepared_at,current!.prepared_at,appealId)
 return {bound:true as const,...await summarize(current!),comparison:await Promise.all(earlier.map(summarize))}
}

import { all, type Row } from './db'

/** One projection for donor histories and the gift ledger. A reviewed historical
 * cutoff supplies no invented thank-you date, method or external message link. */
export async function withGiftAcknowledgments(c: {db:D1Database}, gifts:Row[]) {
 if(!gifts.length)return
 const ids=JSON.stringify(gifts.map(g=>g.id))
 const [recorded,prior]=await Promise.all([
  all(c,'SELECT * FROM cf_gift_acknowledgments WHERE gift_id IN (SELECT value FROM json_each(?))',ids),
  all(c,'SELECT gift_id FROM cf_prior_acknowledgements WHERE gift_id IN (SELECT value FROM json_each(?))',ids),
 ])
 const byId=new Map(recorded.map(r=>[r.gift_id,r])),beforeCutoff=new Set(prior.map(r=>r.gift_id))
 for(const gift of gifts)gift.acknowledgment=byId.get(gift.id)??(beforeCutoff.has(gift.id)?{status:'acknowledged',source:'Reviewed move-in cutoff',acknowledged_on:null,method:null,batch_id:null,letter_id:null,reason:null}:{status:'not acknowledged'})
}

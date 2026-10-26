import { all, type Context, type Row } from '../db'
import { box, e, empty, longDay, money } from './common'

/** Display the actual selected gift IDs, independently of donor membership. */
export async function giftSelection(c:Context,rows:Row[]):Promise<string> {
 const preview=rows.slice(0,50)
 const names=new Map((await all(c,'SELECT id,name FROM cf_donors WHERE id IN(SELECT value FROM json_each(?))',JSON.stringify(preview.map(g=>g.donor_id)))).map(d=>[d.id,d.name]))
 const entries=preview.map(g=>{
  const link=g.acknowledgment_link?JSON.parse(g.acknowledgment_link):null
  return `<li><a href="/app/donors/${e(g.donor_id)}#gift-${e(g.id)}">${e(names.get(g.donor_id))} · ${money(g.amount_cents)} · ${longDay(g.received_on)}</a><p>${e(g.acknowledgment_status)}${g.acknowledged_on?' · '+longDay(g.acknowledged_on):''}${g.acknowledgment_method?' · '+e(g.acknowledgment_method):''}${link?' · '+e(link.kind)+' '+e(link.id):''}</p></li>`
 }).join('')
 return box('Matching gifts',entries?`${rows.length>50?'<p>Showing the first 50 gifts. The download includes all matching gifts.</p>':''}<ul class="list">${entries}</ul>`:empty('No matching gifts.'))
}

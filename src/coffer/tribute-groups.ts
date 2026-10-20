import { all, type Context } from './db'
export const tributeKey=(kind:string,honoree:string)=>`${kind}:${honoree.trim().replace(/\s+/g,' ').toLowerCase()}`

/** A display grouping never combines constituent identities. Signed remaining
 * balances include imported gifts, refunds and reversals without new income. */
export async function tributeGroups(c:Pick<Context,'db'>) {
 const rows=await all(c,`SELECT t.*,g.donor_id AS gift_donor_id,g.net_cents FROM cf_gift_tributes t
  JOIN cf_gift_balances g ON g.id=t.gift_id JOIN cf_donors d ON d.id=g.donor_id
  WHERE d.erased_at IS NULL ORDER BY t.kind,lower(t.honoree),t.gift_id`)
 const groups=new Map<string,{key:string;kind:string;honoree:string;totalCents:number;giftIds:string[]}>()
 for(const row of rows) {
  const key=tributeKey(row.kind,row.honoree),group=groups.get(key)??{key,kind:row.kind,honoree:row.honoree,totalCents:0,giftIds:[] as string[]}
  group.totalCents+=row.net_cents;group.giftIds.push(row.gift_id);groups.set(key,group)
 }
 return [...groups.values()]
}

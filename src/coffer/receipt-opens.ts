import { addDays, all, today, type Context, type Row } from './db'

/** Only provider evidence is retained. An open is not proof a person read it. */
export async function receiptOpens(c: Pick<Context,'db'>, timezone: string, since: string, through: string) {
 const rows=await all(c,`SELECT a.donor_id AS donorId,e.id,e.letter_id AS letterId,e.occurred_at AS occurredAt
  FROM cf_letter_events e JOIN cf_acks a ON a.id=e.letter_id JOIN cf_donors d ON d.id=a.donor_id
  WHERE e.event='opened' AND d.erased_at IS NULL AND substr(e.occurred_at,1,10)>=? AND substr(e.occurred_at,1,10)<=? ORDER BY e.occurred_at,e.id`,addDays(since,-1),new Date(Date.parse(through+'T00:00:00Z')+86400000).toISOString().slice(0,10))
 const result=new Map<string,Row[]>()
 for(const row of rows) {
  const day=today(timezone,new Date(row.occurredAt))
  if(day<since||day>through)continue
  const events=result.get(row.donorId)??[];events.push({id:row.id,letterId:row.letterId,occurredAt:row.occurredAt,day});result.set(row.donorId,events)
 }
 return result
}

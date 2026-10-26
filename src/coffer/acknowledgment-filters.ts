import { choice, date, fail, text, type Row } from './db'
import { SOFT_ACK_METHODS } from './soft-credit-ack'

export const ACK_FILTERS = ['ackStatus','ackFrom','ackThrough','ackMethod','ackLink'] as const
export const GIFT_FILTERS = [...ACK_FILTERS,'giftOver'] as const
export function acknowledgmentFilters(input: Row): Record<string,string> {
 const result=Object.fromEntries(GIFT_FILTERS.map(k=>[k,input[k]==null||input[k]===''?'':text(input[k],k,200)]))
 choice(result.ackStatus,['','not acknowledged','acknowledged','do not acknowledge'],'acknowledgment status')
 choice(result.ackMethod,['',...SOFT_ACK_METHODS],'acknowledgment method')
 for(const key of ['ackFrom','ackThrough'])if(result[key])date(result[key],key)
 if(result.ackFrom&&result.ackThrough&&result.ackFrom>result.ackThrough)fail('INPUT','The first thank-you date must be on or before the last.',400)
 if(result.giftOver&&!/^\d{1,12}(?:\.\d{1,2})?$/.test(result.giftOver))fail('INPUT','Gift amount is nonnegative USD with at most two decimal places.',400)
 return Object.fromEntries(Object.entries(result).filter(([,v])=>v!==''))
}

/** All predicates refer to the same original gift. Ledger adjustments follow it. */
export function acknowledgmentSql(value:(key:string)=>string,giftId:string) {
 const f=(key:string)=>`COALESCE(${value(key)},'')`
 return `EXISTS(SELECT 1 FROM (SELECT ${giftId} AS id) ag
 LEFT JOIN cf_gift_acknowledgments aa ON aa.gift_id=ag.id
 WHERE (${f('ackStatus')}='' OR COALESCE(aa.status,CASE WHEN EXISTS(SELECT 1 FROM cf_prior_acknowledgements ap WHERE ap.gift_id=ag.id) THEN 'acknowledged' ELSE 'not acknowledged' END)=${f('ackStatus')})
 AND (${f('ackFrom')}='' OR aa.acknowledged_on>=${f('ackFrom')})
 AND (${f('ackThrough')}='' OR aa.acknowledged_on<=${f('ackThrough')})
 AND (${f('ackMethod')}='' OR aa.method=${f('ackMethod')})
 AND (${f('ackLink')}='' OR ${f('ackLink')} IN(aa.interaction_id,aa.note_id,aa.letter_id,aa.batch_id,aa.communication_id,aa.source_reference))
 AND (${f('giftOver')}='' OR EXISTS(SELECT 1 FROM cf_gift_balances ab WHERE ab.id=ag.id AND ab.net_cents>CAST(round(CAST(${f('giftOver')} AS REAL)*100) AS INTEGER))))`
}

/** Bound values repeat in SQL order so this composes inside larger selections. */
export function acknowledgmentPredicate(url:URL,giftId:string) {
 const filters=acknowledgmentFilters(Object.fromEntries(url.searchParams)),params:string[]=[]
 if(!Object.keys(filters).length)return {filters,sql:'1',params}
 const sql=acknowledgmentSql(key=>{params.push(filters[key]??'');return '?'},giftId)
 return {filters,sql,params}
}

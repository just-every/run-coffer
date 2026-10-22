import { choice, date, fail, optional, text, type Row } from './db'

export const ADVANCED_FILTERS=['givingFrom','givingThrough','minGiven','maxGiven','lastGiftFrom','lastGiftThrough','fund','campaignId','managerId','tag','emailConsent','mailConsent','ackStatus','customKey','customValue','status'] as const
export function advancedFilters(p:Row):Record<string,string>{
 const result:Record<string,string>={}
 for(const key of ADVANCED_FILTERS)result[key]=p[key]===undefined||p[key]===null||p[key]===''?'':text(p[key],key,200)
 for(const key of ['givingFrom','givingThrough','lastGiftFrom','lastGiftThrough'])if(result[key])date(result[key],key)
 for(const [a,b] of [['givingFrom','givingThrough'],['lastGiftFrom','lastGiftThrough']])if(result[a]&&result[b]&&result[a]>result[b])fail('INPUT','The first date must be on or before the last.',400)
 for(const key of ['minGiven','maxGiven'])if(result[key]&&!/^\d{1,12}(?:\.\d{1,2})?$/.test(result[key]))fail('INPUT','Giving bounds are nonnegative USD with at most two decimal places.',400)
 if(result.minGiven&&result.maxGiven&&Number(result.minGiven)>Number(result.maxGiven))fail('INPUT','Minimum giving must not exceed maximum giving.',400)
 for(const key of ['emailConsent','mailConsent'])choice(result[key],['','granted','withdrawn','unknown'],'consent answer')
 choice(result.ackStatus,['','not acknowledged','acknowledged','do not acknowledge'],'acknowledgment status')
 choice(result.status,['','active','inactive','deceased','all'],'constituent status')
 if(Boolean(result.customKey)!==Boolean(result.customValue))fail('INPUT','Choose a custom field key and value together.',400)
 return result
}
/** SQL identifiers below are fixed by our caller; all filter values are JSON parameters. */
export function advancedListSql(definition:string,donor='d') {
 const f=(key:string)=>`COALESCE(json_extract(${definition},'$.${key}'),'')`
 const history=`SELECT g.* FROM cf_fund_ledger g WHERE g.donor_id=${donor}.id AND (${f('givingFrom')}='' OR g.received_on>=${f('givingFrom')}) AND (${f('givingThrough')}='' OR g.received_on<=${f('givingThrough')}) AND (${f('fund')}='' OR g.fund=${f('fund')}) AND (${f('campaignId')}='' OR g.campaign_id=${f('campaignId')})`
 const sum=`COALESCE((SELECT SUM(amount_cents) FROM (${history})),0)`
 const last=`(SELECT MAX(received_on) FROM cf_gift_balances WHERE donor_id=${donor}.id AND net_cents>0)`
 const consent=(channel:string)=>`(${f(channel+'Consent')}='' OR COALESCE((SELECT status FROM cf_consents WHERE donor_id=${donor}.id AND channel='${channel}' ORDER BY id DESC LIMIT 1),'unknown')=${f(channel+'Consent')})`
 return `(${f('minGiven')}='' OR ${sum}>=CAST(round(CAST(${f('minGiven')} AS REAL)*100) AS INTEGER))
 AND (${f('maxGiven')}='' OR ${sum}<=CAST(round(CAST(${f('maxGiven')} AS REAL)*100) AS INTEGER))
 AND (${f('fund')}='' AND ${f('campaignId')}='' OR EXISTS(${history}))
 AND (${f('lastGiftFrom')}='' OR ${last}>=${f('lastGiftFrom')}) AND (${f('lastGiftThrough')}='' OR ${last}<=${f('lastGiftThrough')})
 AND ${consent('email')} AND ${consent('mail')}
 AND (${f('tag')}='' OR EXISTS(SELECT 1 FROM (SELECT donor_id,tag FROM cf_donor_rule_tags UNION SELECT donor_id,tag FROM cf_donor_tags) WHERE donor_id=${donor}.id AND tag=${f('tag')}))
 AND (${f('managerId')}='' OR EXISTS(SELECT 1 FROM cf_portfolio_members pm JOIN cf_portfolios pp ON pp.id=pm.portfolio_id WHERE pm.donor_id=${donor}.id AND pp.manager_id=${f('managerId')}))
 AND (${f('ackStatus')}='' OR EXISTS(SELECT 1 FROM cf_gift_balances gb LEFT JOIN cf_gift_acknowledgments ga ON ga.gift_id=gb.id WHERE gb.donor_id=${donor}.id AND gb.net_cents>0 AND COALESCE(ga.status,'not acknowledged')=${f('ackStatus')}))
 AND (${f('customKey')}='' OR EXISTS(SELECT 1 FROM cf_custom_values cv JOIN cf_custom_fields cf ON cf.key=cv.field_key WHERE cv.record_id=${donor}.id AND cf.kind='constituent' AND cf.key=${f('customKey')} AND (CAST(json_extract(cv.value,'$') AS TEXT)=${f('customValue')} OR EXISTS(SELECT 1 FROM json_each(cv.value) j WHERE CAST(j.value AS TEXT)=${f('customValue')}))))`
}

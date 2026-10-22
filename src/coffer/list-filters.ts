import { customValue } from './custom-fields'
import { choice, date, fail, one, optional, text, type Row, type Context } from './db'

export const DONOR_FILTER_FIELDS=[['name','Display name'],['prefix','Prefix'],['first_name','First name'],['middle_name','Middle name'],['last_name','Last name'],['suffix','Suffix'],['nickname','Nickname'],['email','Primary email'],['phone','Primary phone'],['address_line1','Street'],['address_line2','Address second line'],['city','City'],['region','State or region'],['postal_code','Postal code'],['country','Country'],['constituent_kind','Person or organization'],['organization_type','Organization type'],['website','Website'],['ein','Organization EIN'],['informal_salutation','Informal salutation override'],['formal_salutation','Formal salutation override'],['envelope_name','Envelope name override'],['constituent_status','Status'],['status_reason','Status reason'],['deceased_on','Date of death'],['source','Source'],['created_at','Created at']] as const
export const ADVANCED_FILTERS=['givingFrom','givingThrough','minGiven','maxGiven','lastGiftFrom','lastGiftThrough','fund','campaignId','managerId','tag','emailConsent','mailConsent','ackStatus','customKey','customValue','status','minScore','maxScore','lapsed','fieldKey','fieldValue','fieldOperator'] as const
export function advancedFilters(p:Row):Record<string,string>{
 const result:Record<string,string>={}
 for(const key of ADVANCED_FILTERS)result[key]=p[key]===undefined||p[key]===null||p[key]===''?'':text(p[key],key,200)
 for(const key of ['givingFrom','givingThrough','lastGiftFrom','lastGiftThrough'])if(result[key])date(result[key],key)
 for(const [a,b] of [['givingFrom','givingThrough'],['lastGiftFrom','lastGiftThrough']])if(result[a]&&result[b]&&result[a]>result[b])fail('INPUT','The first date must be on or before the last.',400)
 for(const key of ['minGiven','maxGiven'])if(result[key]&&!/^\d{1,12}(?:\.\d{1,2})?$/.test(result[key]))fail('INPUT','Giving bounds are nonnegative USD with at most two decimal places.',400)
 if(result.minGiven&&result.maxGiven&&Number(result.minGiven)>Number(result.maxGiven))fail('INPUT','Minimum giving must not exceed maximum giving.',400)
 for(const key of ['emailConsent','mailConsent'])choice(result[key],['','granted','withdrawn','unknown'],'consent answer')
 choice(result.ackStatus,['','not acknowledged','acknowledged','do not acknowledge'],'acknowledgment status')
 for(const key of ['minScore','maxScore'])if(result[key]&&(!/^\d{1,3}(?:\.\d{1,2})?$/.test(result[key])||Number(result[key])>100))fail('INPUT','Engagement scores range from 0 to 100 with at most two decimals.',400)
 if(result.minScore&&result.maxScore&&Number(result.minScore)>Number(result.maxScore))fail('INPUT','Minimum score must not exceed maximum score.',400)
 choice(result.lapsed,['','at_risk','current','unknown'],'giving lapse status')
 choice(result.status,['','active','inactive','deceased','all'],'constituent status')
 if(result.fieldKey){
  choice(result.fieldKey,DONOR_FILTER_FIELDS.map(f=>f[0]),'constituent field')
  result.fieldOperator=choice(result.fieldOperator||'equal',['equal','contains','empty','present','before','after'],'field comparison')
  if(!['empty','present'].includes(result.fieldOperator)&&!result.fieldValue)fail('INPUT','Enter a field comparison value.',400)
 }else if(result.fieldValue||result.fieldOperator)fail('INPUT','Choose a constituent field for the comparison.',400)
 if(Boolean(result.customKey)!==Boolean(result.customValue))fail('INPUT','Choose a custom field key and value together.',400)
 return Object.fromEntries(Object.entries(result).filter(([,value])=>value!==''))
}
/** SQL identifiers below are fixed by our caller; all filter values are JSON parameters. */
export function advancedListSql(definition:string,donor='d') {
 const f=(key:string)=>`COALESCE(json_extract(${definition},'$.${key}'),'')`
 const native=`CASE ${DONOR_FILTER_FIELDS.map(([key])=>`WHEN ${f('fieldKey')}='${key}' THEN CAST(${donor}.${key} AS TEXT)`).join(' ')} END`
 const history=`SELECT g.* FROM cf_fund_ledger g WHERE g.donor_id=${donor}.id AND (${f('givingFrom')}='' OR g.received_on>=${f('givingFrom')}) AND (${f('givingThrough')}='' OR g.received_on<=${f('givingThrough')}) AND (${f('fund')}='' OR g.fund=${f('fund')}) AND (${f('campaignId')}='' OR g.campaign_id=${f('campaignId')})`
 const sum=`COALESCE((SELECT SUM(amount_cents) FROM (${history})),0)`
 const last=`(SELECT MAX(received_on) FROM cf_gift_balances WHERE donor_id=${donor}.id AND net_cents>0)`
 const consent=(channel:string)=>`(${f(channel+'Consent')}='' OR COALESCE((SELECT status FROM cf_consents WHERE donor_id=${donor}.id AND channel='${channel}' ORDER BY id DESC LIMIT 1),'unknown')=${f(channel+'Consent')})`
 return `(${f('fieldKey')}='' OR CASE ${f('fieldOperator')} WHEN 'equal' THEN COALESCE(${native},'')=${f('fieldValue')} COLLATE NOCASE WHEN 'contains' THEN instr(lower(COALESCE(${native},'')),lower(${f('fieldValue')}))>0 WHEN 'empty' THEN trim(COALESCE(${native},''))='' WHEN 'present' THEN trim(COALESCE(${native},''))<>'' WHEN 'before' THEN ${native}<${f('fieldValue')} WHEN 'after' THEN ${native}>${f('fieldValue')} ELSE 0 END) AND (${f('status')}='' OR ${f('status')}='all' OR ${donor}.constituent_status=${f('status')}) AND (${f('minGiven')}='' OR ${sum}>=CAST(round(CAST(${f('minGiven')} AS REAL)*100) AS INTEGER))
 AND (${f('maxGiven')}='' OR ${sum}<=CAST(round(CAST(${f('maxGiven')} AS REAL)*100) AS INTEGER))
 AND (${f('fund')}='' AND ${f('campaignId')}='' OR EXISTS(${history}))
 AND (${f('lastGiftFrom')}='' OR ${last}>=${f('lastGiftFrom')}) AND (${f('lastGiftThrough')}='' OR ${last}<=${f('lastGiftThrough')})
 AND ${consent('email')} AND ${consent('mail')}
 AND (${f('tag')}='' OR EXISTS(SELECT 1 FROM (SELECT donor_id,tag FROM cf_donor_rule_tags UNION SELECT donor_id,tag FROM cf_donor_tags) WHERE donor_id=${donor}.id AND tag=${f('tag')}))
 AND (${f('managerId')}='' OR EXISTS(SELECT 1 FROM cf_portfolio_members pm JOIN cf_portfolios pp ON pp.id=pm.portfolio_id WHERE pm.donor_id=${donor}.id AND pp.manager_id=${f('managerId')}))
 AND (${f('ackStatus')}='' OR EXISTS(SELECT 1 FROM cf_gift_balances gb LEFT JOIN cf_gift_acknowledgments ga ON ga.gift_id=gb.id WHERE gb.donor_id=${donor}.id AND gb.net_cents>0 AND COALESCE(ga.status,'not acknowledged')=${f('ackStatus')}))
 AND (${f('customKey')}='' OR EXISTS(SELECT 1 FROM cf_custom_values cv JOIN cf_custom_fields cf ON cf.key=cv.field_key WHERE cv.record_id=${donor}.id AND cf.kind='constituent' AND cf.key=${f('customKey')} AND ((CASE WHEN cf.type='currency' THEN json_extract(cv.value,'$')=CAST(round(CAST(${f('customValue')} AS REAL)*100) AS INTEGER) ELSE CAST(json_extract(cv.value,'$') AS TEXT)=${f('customValue')} END) OR EXISTS(SELECT 1 FROM json_each(cv.value) j WHERE CAST(j.value AS TEXT)=${f('customValue')}))))`
}

/** Keep public filter units identical to entry units, including USD currency. */
export async function validateCustomFilter(c:Pick<Context,'db'>,filters:Record<string,string>) {
 if(!filters.customKey)return
 const field=await one(c,"SELECT * FROM cf_custom_fields WHERE key=? AND kind='constituent'",filters.customKey)
 if(!field)fail('INPUT','Choose a defined constituent custom field.',400)
 const normalized=JSON.parse(customValue({...field,entry:field.entry==='pick-many'?'pick-one':field.entry},filters.customValue))
 filters.customValue=field.type==='currency'?(Number(normalized)/100).toFixed(2):String(normalized)
}

import { all, fail, type Row } from './db'
import { NAME_MERGE_FIELDS } from './person-names'
import { HOUSEHOLD_MERGE_FIELDS, CONTACT_MERGE_FIELDS, recipientMergeFields, renderTemplate, templateTokens } from './template-fields'
import { usd } from './money'
import type { Settings } from './settings'

export const CONTRIBUTION_TEMPLATE_KINDS = ['stock','daf','qcd'] as const
export type ContributionTemplateKind = typeof CONTRIBUTION_TEMPLATE_KINDS[number]
const COMMON = [...NAME_MERGE_FIELDS,...CONTACT_MERGE_FIELDS, ...HOUSEHOLD_MERGE_FIELDS,'date','donor_name','gift_date','goods_statement','organization','ein']
const REQUIRED = ['donor_name','gift_date','goods_statement','organization','ein']
export const CONTRIBUTION_TEMPLATE_FIELDS: Record<ContributionTemplateKind,[string[],string[]]> = {
 stock:[[...COMMON,'description','quantity','stock_symbol','stock_shares'],[...REQUIRED,'description','stock_symbol','stock_shares']],
 daf:[[...COMMON,'amount','fund'],[...REQUIRED,'amount']],
 qcd:[[...COMMON,'amount','fund','qcd_custodian'],[...REQUIRED,'amount','qcd_custodian']],
}
export const contributionReceiptKind = (gift:Row):ContributionTemplateKind|null => CONTRIBUTION_TEMPLATE_KINDS.includes(gift.contribution_type) ? gift.contribution_type : null

/** Kept independent of command/settings/template modules so every receipt door
 * can annotate ledger facts without importing gift-entry handlers. */
export async function withContributionTypes(c:{db:D1Database},gifts:Row[]) {
 if(!gifts.length)return gifts
 const key=(g:Row)=>g.reverses??g.property_id??g.id
 const ids=JSON.stringify(gifts.map(key))
 const [monetary,stock]=await Promise.all([
  all(c,'SELECT * FROM cf_contribution_types WHERE gift_id IN (SELECT value FROM json_each(?))',ids),
  all(c,'SELECT * FROM cf_stock_contributions WHERE in_kind_id IN (SELECT value FROM json_each(?))',ids),
 ])
 const facts=new Map([...monetary.map(r=>[r.gift_id,r] as const),...stock.map(r=>[r.in_kind_id,r] as const)])
 for(const gift of gifts) {
  const typed=facts.get(key(gift));if(!typed)continue
  gift.contribution_type=typed.kind??'stock';gift.contribution_details=typed
  if(typed.kind==='qcd')gift.qcd_custodian=typed.custodian
  if(!typed.kind)gift.valuation_basis='market_high_low_mean'
 }
 return gifts
}

/** Typed grants and IRA distributions must never inherit generic deductibility
 * promises. Stock wording describes property; only its generated goods statement
 * may state the separate good-faith value of benefits actually provided. */
export function checkContributionTemplate(kind:string,subject:string,body:string) {
 if(!CONTRIBUTION_TEMPLATE_KINDS.includes(kind as ContributionTemplateKind))return
 const wording=subject+'\n'+body
 const [allowed,required]=CONTRIBUTION_TEMPLATE_FIELDS[kind as ContributionTemplateKind],used=templateTokens(body).map(t=>t.field)
 if(required.some(field=>!used.includes(field))||templateTokens(wording).some(t=>!allowed.includes(t.field)))fail('TEMPLATE','The contribution template must include its required facts and only its published fields.',400)
 if(/deduct/i.test(wording.replace(/[^a-z]/gi,'')))fail('TEMPLATE','Stock, DAF and IRA acknowledgments cannot contain deduction or deductibility language.',400)
 if(kind==='stock'&&(/\$/.test(wording)||/\b(?:usd|dollars?|valu(?:e|ed|ation)|worth|proceeds|prices?)\b/i.test(wording)))fail('TEMPLATE','A stock acknowledgment describes shares without assigning a gift value. Use {{goods_statement}} for any separately provided benefits.',400)
}

const noGoods='No goods or services were provided in exchange for this contribution.'
export function contributionGoodsStatement(s:Settings,gift:Row):string {
 const kind=contributionReceiptKind(gift)
 if(kind==='daf'||kind==='qcd') {
  if(gift.goods!=='none'||Number(gift.goods_cents)!==0)fail('RECEIPT_FACTS','Review this typed contribution: it must record no goods or services.')
  return noGoods
 }
 if(gift.goods==='unknown')fail('GOODS_UNKNOWN','Confirm goods or services before preparing this property acknowledgment.')
 if(gift.goods==='provided')return `In exchange for this contribution, ${s.organisation} provided ${gift.goods_description}, with a good-faith estimated value of ${usd(gift.goods_cents)}.`
 if(gift.goods==='intangible religious benefits')return 'The only goods or services provided in exchange for this contribution consisted entirely of intangible religious benefits.'
 return noGoods
}

const defaults:Record<ContributionTemplateKind,{subject:string;body:string}> = {
 daf:{subject:'Donor-advised fund grant acknowledgment from {{organization}}',body:'{{date}}\n\nDear {{donor_name}},\n\n{{organization}} acknowledges receipt of a donor-advised fund grant of {{amount}} from {{donor_name}} on {{gift_date}}.\n\n{{goods_statement}}\n\n{{organization}}\nEIN {{ein}}'},
 qcd:{subject:'IRA distribution acknowledgment from {{organization}}',body:'{{date}}\n\nDear {{donor_name}},\n\n{{organization}} acknowledges receipt of an IRA distribution of {{amount}} from custodian {{qcd_custodian}} on {{gift_date}}.\n\n{{goods_statement}}\n\n{{organization}}\nEIN {{ein}}'},
 stock:{subject:'Securities contribution acknowledgment from {{organization}}',body:'{{date}}\n\nDear {{donor_name}},\n\n{{organization}} acknowledges receipt on {{gift_date}} of the following property:\n\n{{description}}\nShares: {{stock_shares}}\nSymbol: {{stock_symbol}}\n\n{{goods_statement}}\n\n{{organization}}\nEIN {{ein}}'},
}
const longDate=(day:string)=>new Intl.DateTimeFormat('en-US',{dateStyle:'long',timeZone:'UTC'}).format(new Date(`${day}T00:00:00Z`))

/** Metadata includes the typed kind even for built-in wording, tied to the
 * reviewed settings version; a generic template can never override this path. */
export function renderContributionReceipt(s:Settings,gift:Row,recipient:Row,day:string,template?:Row|null) {
 const kind=contributionReceiptKind(gift)
 if(!kind)fail('RECEIPT_FACTS','Choose a classified stock, DAF or IRA contribution.')
 const selected=template?.kind===kind?template:null
 const wording=selected??defaults[kind],facts=gift.contribution_details??{}
 checkContributionTemplate(kind,wording.subject,wording.body)
 const fields:Record<string,string>={...recipientMergeFields(recipient),date:longDate(day),donor_name:kind==='daf'?recipient.name:recipient.letter_salutation??recipient.name,
  gift_date:longDate(gift.received_on),goods_statement:contributionGoodsStatement(s,gift),organization:s.organisation,ein:s.ein,
  ...(kind==='stock'?{description:gift.description??gift.property_description,quantity:String(facts.shares??gift.quantity??''),stock_symbol:facts.symbol??'',stock_shares:facts.shares??''}
   :{amount:usd(gift.amount_cents),fund:gift.receipt_fund??gift.fund,qcd_custodian:gift.qcd_custodian??facts.custodian??''})}
 if(!s.reviewed_at||CONTRIBUTION_TEMPLATE_FIELDS[kind][1].some(field=>!String(fields[field]??'').trim()))fail('RECEIPT_FACTS','Review the required contribution, organization, EIN and custodian/property facts before preparing this acknowledgment.')
 return {...renderTemplate(wording as {subject:string;body:string},fields),template_kind:kind,template_id:selected?.id??null,template_version:selected?.version??s.version}
}

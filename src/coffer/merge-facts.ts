import { GIFT_DETAIL_MERGE_FIELDS } from './merge-field-catalog'
import { all, one, type Row } from './db'
import { givingSummary } from './giving-summary'
import { donorGiftDepth } from './gift-depth'
import { pledgeHistory } from './pledges'
import { subscriptions } from './giving/campaigns'
import { usd } from './money'

export async function recipientFacts(c:{db:D1Database;now?:string},donorId:string):Promise<Record<string,string>> {
 const [gifts,pledges,plans,depth,recognition] = await Promise.all([
  all(c,"SELECT * FROM cf_contribution_ledger WHERE donor_id=? AND kind IN ('gift','reversal')",donorId),
  pledgeHistory(c,donorId),subscriptions(c,donorId),donorGiftDepth(c,donorId),
  one(c,'SELECT * FROM cf_donor_recognition WHERE donor_id=?',donorId),
 ])
 const s=await givingSummary(c,donorId,{gifts,pledges,subscriptions:plans,recognitionCents:depth.recognitionCents})
 const amount=(gift:Row|null)=>gift?usd(gift.amountCents):''
 const date=(gift:Row|null)=>gift?.receivedOn??''
 return {recognition_name:recognition?.anonymous?'Anonymous':recognition?.recognition_name??'',
  total_given:usd(s.lifetimeCents),gift_count:String(s.giftCount),
  first_gift_amount:amount(s.firstGift),first_gift_date:date(s.firstGift),
  last_gift_amount:amount(s.lastGift),last_gift_date:date(s.lastGift),
  largest_gift_amount:amount(s.largestGift),largest_gift_date:date(s.largestGift),
  consecutive_giving_years:String(s.consecutiveGivingYears),current_fiscal_year_given:usd(s.fiscalYear.currentCents),previous_fiscal_year_given:usd(s.fiscalYear.previousCents),
  open_pledge_balance:usd(s.openPledgeCents),soft_credit_total:usd(s.softCreditCents),recurring_plan_count:String(s.recurring.filter(p=>p.status==='active').length)}
}

export async function giftFacts(c:{db:D1Database},gifts:Row[]) {
 if(!gifts.length)return
 const rows=await all(c,`SELECT g.id,c.name AS campaign,a.name AS appeal,t.honoree AS tribute_name
  FROM cf_contribution_ledger g LEFT JOIN cf_campaign_gifts cg ON cg.gift_id=g.id LEFT JOIN cf_campaigns c ON c.id=cg.campaign_id
  LEFT JOIN cf_gift_appeals ga ON ga.gift_id=g.id LEFT JOIN cf_appeal_codes a ON a.code=ga.appeal
  LEFT JOIN cf_gift_tributes t ON t.gift_id=g.id WHERE g.id IN(SELECT value FROM json_each(?))`,JSON.stringify(gifts.map(g=>g.id)))
 const byId=new Map(rows.map(r=>[r.id,r]))
 for(const gift of gifts){const facts=byId.get(gift.id);gift.merge_fields={...(gift.merge_fields??{}),...Object.fromEntries(GIFT_DETAIL_MERGE_FIELDS.map(key=>[key,facts?.[key]??'']))}}
}

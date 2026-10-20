import { all, today, type Context, type Row } from './db'
import { settings } from './settings'
import { fiscalPeriod } from './giving-summary'

/** Ledger IDs are the identity. Equal amounts/dates never collapse two gifts. */
export async function householdTotals(c:Context,householdId:string,query:{year?:number,basis?:'calendar'|'fiscal'}={}) {
 const s=await settings(c),asOf=today(s.timezone,new Date(c.now)),basis=query.basis??'calendar'
 const year=query.year, start=year===undefined?null:`${year}-${basis==='fiscal'?s.fiscal_year_start:'01-01'}`
 const end=year===undefined?null:`${year+1}-${basis==='fiscal'?s.fiscal_year_start:'01-01'}`
 const member=`SELECT id FROM cf_donors d WHERE household_id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`
 const gifts=await all(c,`SELECT g.* FROM cf_gift_balances g WHERE donor_id IN (${member}) AND (? IS NULL OR (received_on>=? AND received_on<?)) ORDER BY received_on,id`,householdId,start,start,end)
 const outside=await all(c,`SELECT g.id,g.net_cents,SUM(s.amount_cents) AS credits FROM cf_soft_credits s JOIN cf_gift_balances g ON g.id=s.gift_id WHERE s.donor_id IN (${member}) AND g.donor_id NOT IN (${member}) AND (? IS NULL OR (g.received_on>=? AND g.received_on<?)) GROUP BY g.id,g.net_cents`,householdId,householdId,start,start,end)
 const moneyCents=gifts.reduce((n,g)=>n+g.net_cents,0)
 const outsideRecognitionCents=outside.reduce((n,g)=>n+Math.max(0,Math.min(g.net_cents,g.credits)),0)
 const funds=await all(c,`SELECT f.fund,SUM(f.amount_cents) AS cents FROM cf_fund_ledger f JOIN cf_gifts g ON g.id=f.gift_id WHERE g.donor_id IN (${member}) AND (? IS NULL OR (g.received_on>=? AND g.received_on<?)) GROUP BY f.fund ORDER BY f.fund`,householdId,start,start,end)
 return {asOf,label:`Current members as of ${asOf}`,basis,year:year??null,start,end,fiscalYearStart:s.fiscal_year_start,currentFiscalPeriod:fiscalPeriod(asOf,s.fiscal_year_start),moneyCents,recognitionCents:moneyCents+outsideRecognitionCents,outsideRecognitionCents,gifts,funds}
}

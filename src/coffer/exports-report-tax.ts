import { choice, type Context } from './db'
import { taxRecordSelection } from './tax-reports'
import { selectedReport } from './exports-report-records'

export async function taxExportSelection(c:Context,url:URL) {
 const s=await taxRecordSelection(c,url)
 const paper=choice(url.searchParams.get('paper')||'schedule-a',['schedule-a','schedule-b','schedule-m'] as const,'working paper')
 const start=paper==='schedule-a'?s.start:s.periods[4].start
 const monetary=`SELECT id,donor_id,gift_id,received_on,amount_cents,0 AS stated_value_cents,kind,fund,NULL AS campaign_id FROM (${s.monetary.query}) WHERE received_on>=?`
 const property=`SELECT id,donor_id,gift_id,received_on,amount_cents,stated_value_cents,'in_kind' AS kind,fund,campaign_id FROM (${s.property.query}) WHERE received_on>=?`
 const query=paper==='schedule-m'?property:monetary+' UNION ALL '+property
 const params=paper==='schedule-m'?[...s.property.params,start]:[...s.monetary.params,start,...s.property.params,start]
 const denominator=s.configuration.denominator?.start===s.periods[4].start&&s.configuration.denominator?.through===s.through?s.configuration.denominator.cents:null
 const special=s.configuration.rule==='public_support'
 const qualifies=`working_cents>=500000${special?denominator===null?' AND 0':` AND working_cents>${Math.floor(denominator/50)}`:''}`
 return selectedReport(c,'tax','gifts',{
  query:`WITH source AS MATERIALIZED (${query}), contributors AS (
   SELECT donor_id,SUM(amount_cents)+SUM(stated_value_cents) AS working_cents FROM source GROUP BY donor_id)
   SELECT * FROM source WHERE ${paper==='schedule-b'?`donor_id IN(SELECT c.donor_id FROM contributors c JOIN cf_donors d ON d.id=c.donor_id WHERE ${qualifies} AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`:'1'}`,
  params,timezone:s.s.timezone,current:`(SELECT version FROM cf_tax_report_settings WHERE id=1)=${s.configuration.version} AND fiscal_year_start='${s.s.fiscal_year_start}'`,
  parameters:{year:s.year,basis:s.basis,paper,from:start,through:s.through,rule:s.configuration.rule},
  allocations:'SELECT l.* FROM cf_fund_ledger l WHERE l.id IN(SELECT id FROM report_entries)',
  totals:`(SELECT json_object('monetaryCents',COALESCE(SUM(amount_cents),0),'noncashStatedCents',COALESCE(SUM(stated_value_cents),0),
   'giftCount',COUNT(DISTINCT gift_id),'excludedNoncashStatedCents',COALESCE(SUM(CASE WHEN donor_id NOT IN(SELECT id FROM members) THEN stated_value_cents ELSE 0 END),0)) FROM report_entries)`,
 })
}

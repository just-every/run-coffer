import { choice, type Context } from './db'
import { taxRecordSelection } from './tax-reports'
import { selectedReport } from './exports-report-records'

export async function taxExportSelection(c:Context,url:URL) {
 const s=await taxRecordSelection(c,url)
 const paper=choice(url.searchParams.get('paper')||'schedule-a',['schedule-a','schedule-b','schedule-m','classifications'] as const,'working paper')
 const cohort=paper==='schedule-b'?choice(url.searchParams.get('cohort')||'selected',['selected','all','below','unidentified'] as const,'contributor cohort'):null
 const contributionType=paper==='classifications'?choice(url.searchParams.get('contributionType')||'all',['all','daf','qcd'] as const,'contribution type'):null
 const start=paper==='schedule-a'?s.start:s.periods[4].start
 const monetary=`SELECT id,donor_id,gift_id,received_on,amount_cents,0 AS stated_value_cents,kind,fund,NULL AS campaign_id FROM (${s.monetary.query}) WHERE received_on>=?`
 const property=`SELECT id,donor_id,gift_id,received_on,amount_cents,stated_value_cents,'in_kind' AS kind,fund,campaign_id FROM (${s.property.query}) WHERE received_on>=?`
 const classified=`SELECT id,donor_id,gift_id,received_on,amount_cents,0 AS stated_value_cents,kind,fund,NULL AS campaign_id FROM (${s.classification.query}) WHERE (?='all' OR contribution_type=?)`
 const query=paper==='classifications'?classified:paper==='schedule-m'?property:monetary+' UNION ALL '+property
 const params=paper==='classifications'?[...s.classification.params,contributionType,contributionType]:paper==='schedule-m'?[...s.property.params,start]:[...s.monetary.params,start,...s.property.params,start]
 const denominator=s.configuration.denominator?.start===s.periods[4].start&&s.configuration.denominator?.through===s.through?s.configuration.denominator.cents:null
 const special=s.configuration.rule==='public_support'
 const qualifies=`working_cents>=500000${special?denominator===null?' AND 0':` AND working_cents>${Math.floor(denominator/50)}`:''}`
 const identified=`SELECT d.id FROM cf_donors d WHERE d.erased_at IS NULL AND d.name<>'' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`
 const qualified=`SELECT c.donor_id FROM contributors c WHERE ${qualifies}`
 const predicate=cohort==='selected'?`donor_id IN(${identified}) AND donor_id IN(${qualified})`:cohort==='below'?`donor_id IN(${identified}) AND donor_id NOT IN(${qualified})`:cohort==='unidentified'?`donor_id NOT IN(${identified})`:'1'
 return selectedReport(c,'tax','gifts',{
  query:`WITH source AS MATERIALIZED (${query}), contributors AS (
   SELECT donor_id,SUM(amount_cents)+SUM(stated_value_cents) AS working_cents FROM source GROUP BY donor_id)
   SELECT * FROM source WHERE ${predicate}`,
  params,timezone:s.s.timezone,current:`(SELECT version FROM cf_tax_report_settings WHERE id=1)=${s.configuration.version} AND fiscal_year_start='${s.s.fiscal_year_start}'`,
  parameters:{year:s.year,basis:s.basis,paper,cohort,contributionType,from:start,through:s.through,rule:s.configuration.rule},
  allocations:'SELECT l.* FROM cf_fund_ledger l WHERE l.id IN(SELECT id FROM report_entries)',
  totals:`(SELECT json_object('monetaryCents',COALESCE(SUM(amount_cents),0),'noncashStatedCents',COALESCE(SUM(stated_value_cents),0),
   'giftCount',COUNT(DISTINCT gift_id),'ledgerEntries',COALESCE(SUM(kind<>'in_kind'),0),'excludedNoncashStatedCents',COALESCE(SUM(CASE WHEN donor_id NOT IN(SELECT id FROM members) THEN stated_value_cents ELSE 0 END),0),
   'periods',json_array(${s.periods.map(p=>`(SELECT json_object('year',${p.year},'monetaryCents',COALESCE(SUM(amount_cents),0),'noncashStatedCents',COALESCE(SUM(stated_value_cents),0),
    'excludedMonetaryCents',COALESCE(SUM(CASE WHEN donor_id NOT IN(SELECT id FROM members) THEN amount_cents ELSE 0 END),0),
    'excludedNoncashStatedCents',COALESCE(SUM(CASE WHEN donor_id NOT IN(SELECT id FROM members) THEN stated_value_cents ELSE 0 END),0)) FROM report_entries WHERE received_on>='${p.start}' AND received_on<='${p.through}')`).join(',')})) FROM report_entries)`,
 })
}

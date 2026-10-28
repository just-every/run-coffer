import { one, type Context } from './db'
import type { ExportSelection } from './exports-selection'
import type { ExportType } from './exports-records'

export type ReportRecords = {
 query:string; params:unknown[]; parameters:Record<string,unknown>
 totals?:string; current?:string; timezone?:string; recordQuery?:string; allocations?:string
 data?:unknown
}

/** Reports retain unidentified financial facts while private files use only
 * distinct current constituents. Every projection uses this same record set. */
export async function selectedReport(c:Context,report:string,type:ExportType,s:ReportRecords):Promise<ExportSelection> {
 const timezone=s.timezone??String((await one(c,'SELECT timezone FROM cf_settings WHERE id=1'))!.timezone)
 return {source:'report',savedId:null,timezone,year:0,through:'',scoreCurrentSql:s.current??'1',reportType:type,
  ctes:`${s.data===undefined?'':'report_input AS (SELECT ? AS data),'}config AS (SELECT timezone,name_defaults,${s.current??'1'} AS selection_current FROM cf_settings WHERE id=1),
   selected_list AS (SELECT NULL AS version,NULL AS name),filters AS (SELECT '{}' AS definition),
   report_entries AS MATERIALIZED (${s.query}),
   report_allocations AS MATERIALIZED (${s.allocations??'SELECT * FROM report_entries'}),
   members AS MATERIALIZED (SELECT DISTINCT d.id FROM report_entries r JOIN cf_donors d ON d.id=r.donor_id
    WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`,
  params:[...(s.data===undefined?[]:[JSON.stringify(s.data)]),...s.params],reportTotalsSql:s.totals,reportRecordQuery:s.recordQuery,
  selection:{source:'report',report,parameters:s.parameters}}
}

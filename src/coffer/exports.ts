import { requireRole } from './auth'
import { commit, event, fail, type Context, type Row } from './db'
import { csv } from './csv'
import { personNames } from './person-names'
import { exportSelection } from './exports-selection'
import { EXPORT_TYPES, exportRecords, recordJson, type ExportType } from './exports-records'

export { EXPORT_TYPES }
export type { ExportType }
const MAX_ROWS = 10000, MAX_BYTES = 4 * 1024 * 1024

export function exportType(value: string): ExportType {
 if (!EXPORT_TYPES.includes(value as ExportType)) fail('INPUT','Choose a supported export record type.',400)
 return value as ExportType
}

/** There is one data read: membership, records, counts and withheld notes all
 * come from this statement's snapshot, including a saved definition's version.
 * Oversize reads return metadata only, never a silently shortened file. */
export async function exportSnapshot(c: Context, type: ExportType, url: URL) {
 requireRole(c.actor,['owner','admin'],'export donor records')
 const s = await exportSelection(c,url), spec = exportRecords[type]
 const query = `WITH ${s.ctes}, records AS (${spec.query}),
 record_json AS (SELECT ${recordJson(type)} AS data FROM records r),
 totals AS (SELECT count(*) AS row_count,COALESCE(SUM(length(CAST(data AS BLOB))),0) AS byte_count FROM record_json),
 metadata AS (SELECT t.*,? AS as_of,c.timezone,c.name_defaults,c.timezone=? AS calendar_current,
  (SELECT count(*) FROM members) AS member_count,(SELECT version FROM selected_list) AS list_version,
  (SELECT name FROM selected_list) AS list_name,(SELECT definition FROM filters) AS definition,
  (SELECT count(*) FROM cf_donor_notes n JOIN members m ON m.id=n.donor_id WHERE n.confidential=1) AS withheld
  FROM totals t CROSS JOIN config c)
 SELECT meta.*,r.data FROM metadata meta LEFT JOIN record_json r ON meta.row_count<=? AND meta.byte_count<=?
 ORDER BY json_extract(r.data,'$.donor_id'),json_extract(r.data,'$.id')`
 const result = (await c.db.prepare(query).bind(...s.params,c.now,s.timezone,MAX_ROWS,MAX_BYTES).all<Row>()).results
 const meta = result[0]
 if (!meta?.calendar_current) fail('SETTINGS_CHANGED','The organization calendar changed. Refresh the export.',409)
 if (s.source === 'saved' && meta.list_version == null) fail('NOT_FOUND','That saved list does not exist.',404)
 const selection = {...s.selection,...(s.source==='saved'?{version:meta.list_version,
  filters:Object.fromEntries(Object.entries(JSON.parse(meta.definition)).map(([k,v])=>[k,k==='relationship'||k==='volunteer'?v:Boolean(v)]))}:{}),scope:'donor-lifetime'}
 const withheld = {confidentialStaffNotes:Number(meta.withheld),statement:`${meta.withheld} confidential staff notes withheld`}
 const metadata = {source:s.source,listId:s.savedId,listName:meta.list_name??null,listVersion:meta.list_version??null,
  type,selection,rowCount:Number(meta.row_count),memberCount:Number(meta.member_count),asOf:meta.as_of,timezone:meta.timezone,withheld}
 if (meta.row_count>MAX_ROWS || meta.byte_count>MAX_BYTES) fail('EXPORT_TOO_LARGE',`This export contains ${meta.row_count} rows and is too large for one request. Narrow the list.`,413,metadata)
 const rows: Row[] = result.filter(r=>r.data!==null).map(r=>JSON.parse(r.data))
 if(type==='constituents') for (const row of rows) {
  const names=personNames({...row,name_defaults:meta.name_defaults})
  row.computed_informal_salutation=names.informal;row.computed_formal_salutation=names.formal;row.computed_envelope_name=names.envelope
 }
 return {metadata,rows}
}

export async function exportCsv(c: Context, type: ExportType, url: URL) {
 const snapshot = await exportSnapshot(c,type,url), columns=exportRecords[type].columns
 const body=csv(columns,snapshot.rows.map(r=>columns.map(k=>r[k])))
 if(new TextEncoder().encode(body).length>MAX_BYTES)fail('EXPORT_TOO_LARGE',`This export contains ${snapshot.metadata.rowCount} rows and is too large for one request. Narrow the list.`,413,snapshot.metadata)
 await commit(c,[event(c,'export.csv','list_export',snapshot.metadata.listId??snapshot.metadata.source,null,{
  source:snapshot.metadata.source,recordType:type,selection:snapshot.metadata.selection,rowCount:snapshot.metadata.rowCount,
  memberCount:snapshot.metadata.memberCount,asOf:snapshot.metadata.asOf,...snapshot.metadata.withheld,
 })])
 return {body,metadata:snapshot.metadata}
}

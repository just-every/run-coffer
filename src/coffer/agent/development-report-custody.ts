import { sql, type Stmt } from '../db'

/** Call in the native merge transaction. Keep both donor links so erasure after
 * either merge or undo still finds the retained report artifact. */
export function developmentReportMergeStatements(sourceId:string,targetId:string):Stmt[] {
 return [sql(`UPDATE cf_development_reports SET custody_hold='Constituent identity changed. Prepare and approve a new report.'
  WHERE id IN(SELECT report_id FROM cf_development_report_donors WHERE donor_id IN (?,?))`,sourceId,targetId),
  sql(`INSERT OR IGNORE INTO cf_development_report_donors(report_id,donor_id)
   SELECT report_id,? FROM cf_development_report_donors WHERE donor_id=?`,targetId,sourceId)]
}
/** Execute before donor/contact erasure. Exact approved artifacts are redacted
 * rather than silently recomputed or reused under their old approval. */
export function developmentReportErasureStatements(donorId:string):Stmt[] {
 const contacts="SELECT lower(value) FROM cf_contact_points WHERE donor_id=? AND kind='email'"
 const affected=`SELECT report_id FROM cf_development_report_donors WHERE donor_id=?
  UNION SELECT r.id FROM cf_development_reports r WHERE EXISTS(SELECT 1 FROM json_each(r.recipients) j WHERE lower(j.value) IN (${contacts}))
  UNION SELECT a.report_id FROM cf_development_report_approvals a WHERE EXISTS(SELECT 1 FROM json_each(a.recipients) j WHERE lower(j.value) IN (${contacts}))`
 const params=[donorId,donorId,donorId]
 return [
  sql(`UPDATE cf_events SET detail=json_remove(detail,'$.recipients') WHERE action IN ('developmentReport.approve','developmentReport.send') AND subject_id IN (${affected})`,...params),
  sql(`UPDATE cf_development_report_deliveries SET recipient='erased:'||id,message_id=NULL
   WHERE report_id IN (${affected}) AND lower(recipient) IN(${contacts})`,...params,donorId),
  sql(`UPDATE cf_development_report_approvals SET authority_note='[erased]' WHERE report_id IN (${affected})`,...params),
  sql(`UPDATE cf_development_reports SET custody_hold='Constituent data erased. Prepare and approve a new report.',subject='Development report — '||month,
   introduction='',notes='{}',recipients='[]',sources=json_object('month',month,'period',json_extract(sources,'$.period'),'sections',json('[]'),'donorIds',json('[]'))
   WHERE id IN (${affected})`,...params),
  sql(`UPDATE cf_development_report_approvals SET recipients='[]' WHERE report_id IN(SELECT id FROM cf_development_reports WHERE custody_hold='Constituent data erased. Prepare and approve a new report.')`),
  sql('DELETE FROM cf_development_report_donors WHERE donor_id=?',donorId),
 ]
}

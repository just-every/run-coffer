import { commit, event, fail, guard, newId, sql, type Context, type Row, type Stmt } from '../db'
import { donorMailUnavailable, DonorMailError, sendDonorMail } from '../outbound-mail'
import { reportCurrent, reportFresh, reportGrant, reportHash, reportRow } from './development-report'
import { developmentReportDocument, developmentReportText } from './development-report-document'

function approval(r:Row) {
 return guard(`EXISTS(SELECT 1 FROM cf_development_reports r JOIN oa_operators o ON o.id=r.approved_by
  JOIN cf_development_report_approvals a ON a.report_id=r.id AND a.version=r.approved_version
  WHERE r.id=? AND r.version=? AND r.status IN ('approved','sending') AND r.custody_hold IS NULL
  AND o.version=r.approver_version AND o.status='active' AND o.role IN ('owner','admin')
  AND a.content_hash=r.content_hash AND a.recipients=r.recipients AND a.approved_by=r.approved_by AND a.approver_version=o.version)`,
 'REPORT_APPROVAL','The exact content or approving director authority changed. No further submission is authorized.',r.id,r.version)
}
/** Outcome persistence survives revocation during the external request. It can
 * only finish a claim already made under live session and approval authority. */
async function outcome(c:Context,attempt:Row,status:string,messageId:string|null,detail:string|null) {
 const statements:Stmt[]=[sql("UPDATE cf_development_report_deliveries SET status=?,message_id=?,detail=? WHERE id=? AND report_id=? AND status='sending'",status,messageId,detail,attempt.id,attempt.reportId),event(c,'developmentReport.result','development_report',attempt.reportId,null,{attemptId:attempt.id,status})]
 await c.db.batch(statements.map(s=>c.db.prepare(s.sql).bind(...s.params)))
}
export async function sendDevelopmentReport(c:Context,p:Row) {
 const r=await reportRow(c,p)
 if(r.status!=='approved')fail('REPORT_APPROVAL','Approve the exact saved report before sending. A claimed report cannot be submitted again.')
 if(p.confirm!=='SEND'||p.contentHash!==r.content_hash)fail('REPORT_APPROVAL','Confirm SEND for this exact approved report.',400)
 const unavailable=donorMailUnavailable(c.env)
 if(unavailable)fail('REPORT_MAIL',unavailable,503)
 if(await reportHash(r)!==r.content_hash)fail('REPORT_CHANGED','The approved content no longer matches its hash.')
 const fresh=await reportFresh(c,r),attempts=(JSON.parse(r.recipients) as string[]).map(recipient=>({id:newId(),reportId:r.id,recipient}))
 await commit(c,[fresh,reportCurrent(r,'approved'),reportGrant(r),approval(r),
  guard('NOT EXISTS(SELECT 1 FROM cf_development_report_deliveries WHERE report_id=?)','REPORT_CLAIM','This report was already claimed. Investigate its existing outcomes.',r.id),
  ...attempts.map(a=>sql("INSERT INTO cf_development_report_deliveries(id,report_id,recipient,status,attempted_at) VALUES(?,?,?,'sending',?)",a.id,r.id,a.recipient,c.now)),
  sql("UPDATE cf_development_reports SET status='sending',updated_at=? WHERE id=?",c.now,r.id),
  event(c,'developmentReport.send','development_report',r.id,null,{contentHash:r.content_hash,recipients:JSON.parse(r.recipients),approvedBy:r.approved_by}),
 ])
 const html=developmentReportDocument(r,c.env!.AUTH_ORIGIN),body=developmentReportText(r,c.env!.AUTH_ORIGIN)
 for(const attempt of attempts){
  try{
   const sourceCheck=await reportFresh(c,r)
   // Recheck the caller, named grant, exact approval and source state for each envelope.
   await commit(c,[sourceCheck,reportGrant(r),approval(r),guard("EXISTS(SELECT 1 FROM cf_development_report_deliveries WHERE id=? AND status='sending')",'REPORT_CLAIM','This report envelope is no longer pending.',attempt.id)])
  }catch{
   await outcome(c,attempt,'held',null,'Current source, session, grant or approval authority changed. No email submitted for this recipient.');continue
  }
  let status='uncertain',messageId:string|null=null
  try{
   const result=await sendDonorMail(c.env!,{deliveryId:attempt.id,from:c.env!.MAIL_FROM!,to:[attempt.recipient],subject:r.subject,text:body,html,customArgs:{coffer_development_report_id:r.id,coffer_development_attempt_id:attempt.id}})
   messageId=result.providerMessageId;status=messageId?'submitted':'uncertain'
  }catch(error){if(error instanceof DonorMailError&&['rejected','rate_limited'].includes(error.outcome))status='rejected'}
  await outcome(c,attempt,status,messageId,status==='uncertain'?'Delivery unconfirmed. Check the provider; this report will not be submitted again.':null)
 }
 const rows=(await c.db.prepare('SELECT status FROM cf_development_report_deliveries WHERE report_id=?').bind(r.id).all<Row>()).results
 const states=new Set(rows.map(row=>row.status)),status=states.size===1?rows[0].status:'partial'
 await c.db.prepare("UPDATE cf_development_reports SET status=?,updated_at=? WHERE id=? AND status='sending'").bind(status,c.now,r.id).run()
 return {id:r.id,version:r.version,status,deliveries:rows}
}

/** An interrupted submission stays uncertain and is never automatically retried. */
export async function holdInterruptedDevelopmentReports(c:Context) {
 const { reportStaff }=await import('./development-report-sources');reportStaff(c)
 const cutoff=new Date(Date.parse(c.now)-15*60_000).toISOString()
 await commit(c,[sql("UPDATE cf_development_report_deliveries SET status='uncertain',detail='Submission interrupted; delivery unconfirmed. Check the provider before taking further action.' WHERE status='sending' AND attempted_at<=?",cutoff),
  sql("UPDATE cf_development_reports SET status='uncertain' WHERE status='sending' AND updated_at<=?",cutoff)])
}

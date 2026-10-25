import { commit, event, sql, type Context, type Row } from './db'
import { reportRefusal, holdReport, reportSystem } from './report-authority'
import { sendDonorMail, DonorMailError } from './outbound-mail'
import { readScheduledReport } from './scheduled-report-selection'

export async function deliverReport(c:Context,schedule:Row,attempt:Row,report:Awaited<ReturnType<typeof readScheduledReport>>) {
 const refusal=await reportRefusal(c,schedule,attempt.recipient)
 if(refusal){await holdReport(c,schedule,refusal,attempt.id);return}
 const bytes=new TextEncoder().encode(JSON.stringify(report,null,2))
 if(bytes.length>5*1024*1024){await holdReport(c,schedule,'Attachment too large',attempt.id);return}
 let status='uncertain',messageId:string|null=null
 try {
  const result=await sendDonorMail(c.env!,{deliveryId:attempt.id,from:c.env!.MAIL_FROM!,to:[attempt.recipient],subject:schedule.name,
   text:`${report.title}\nGenerated ${c.now}\nOpen this report (approved sign-in required): ${new URL('/app/scheduled-reports/'+schedule.id,c.env!.AUTH_ORIGIN).href}\nThe attached JSON report contains the selected report's current figures.`,
   attachments:[{filename:'coffer-report.json',type:'application/json',content:base64(bytes)}],customArgs:{coffer_report_run_id:attempt.id}})
  messageId=result.providerMessageId;status=messageId?'submitted':'uncertain'
 }catch(error){status=error instanceof DonorMailError&&['rejected','rate_limited'].includes(error.outcome)?'rejected':'uncertain'}
 await commit(reportSystem(c),[sql("UPDATE cf_report_runs SET status=?,message_id=?,detail=? WHERE id=? AND status='sending'",status,messageId,status==='uncertain'?'Delivery unconfirmed. Check the provider before choosing to resend.':null,attempt.id),event(c,'reportSchedule.result','report_run',attempt.id,null,{status})])
}
function base64(bytes:Uint8Array){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary)}

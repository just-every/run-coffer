import { fail, one, type Context, type Row } from '../db'
import { page } from '../ui/common'
import { developmentReportFacts, reportStaff } from './development-report-sources'
import { approveDevelopmentReport, developmentReports, draftDevelopmentReport, saveDevelopmentReport } from './development-report'
import { holdInterruptedDevelopmentReports, sendDevelopmentReport } from './development-report-delivery'
import { developmentReportPage, developmentReportSettingsPage } from './development-report-ui'
import { saveDevelopmentReportSchedule } from './development-report-scheduler'

/** Mount after native identity and origin checks, before generic agent dispatch.
 * No agent bearer grant gains a new capability through this manager-only door. */
export async function developmentReportResponse(request:Request,c:Context,body:()=>Promise<Row>):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname,settings=path==='/app/settings/development-reports',source=path==='/api/coffer/reports/development-sources'
 const match=path.match(/^\/(app\/agent|api\/coffer\/agent)\/reports(?:\/([^/]+))?$/)
 if(!source&&!match&&!settings)return null
 reportStaff(c)
 const api=path.startsWith('/api/'),json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}})
 if(request.method==='GET'||request.method==='HEAD'){
  if(settings)return page('Monthly report settings',await developmentReportSettingsPage(c,url),c.actor,200,'/app/settings')
  if(source)return json(await developmentReportFacts(c,url.searchParams.get('month')))
  if(match![2])fail('NOT_FOUND','That development report page does not exist.',404)
  await holdInterruptedDevelopmentReports(c)
  return api?json(await developmentReports(c,url.searchParams.get('month')??undefined)):page('Monthly development report',await developmentReportPage(c,url),c.actor,200,'/app/agent')
 }
 if(request.method!=='POST'||source)fail('METHOD','Use the development report review actions.',405)
 const p=await body(),command=match![2]
 const handlers:Record<string,(c:Context,p:Row)=>Promise<Row>>={draft:draftDevelopmentReport,save:saveDevelopmentReport,approve:approveDevelopmentReport,send:sendDevelopmentReport,schedule:saveDevelopmentReportSchedule}
 if(!command||!Object.hasOwn(handlers,command))fail('NOT_FOUND','That development report action does not exist.',404)
 const result=await handlers[command](c,p)
 if(api)return json(result)
 if(result.scheduled)return new Response(null,{status:303,headers:{location:'/app/settings/development-reports'+(p.month?'?month='+encodeURIComponent(p.month):''),'cache-control':'no-store'}})
 const r=await one(c,'SELECT month FROM cf_development_reports WHERE id=?',result.id)
 return new Response(null,{status:303,headers:{location:'/app/agent/reports?'+new URLSearchParams({month:r!.month,id:result.id}),'cache-control':'no-store'}})
}

import { fail, type Context } from './db'
import { dashboardReport, dashboardEntries } from './dashboard'
import { retention } from './retention'
import { annualLapses } from './annual-lapses'
import { fundReport } from './fund-report'
import { stateReport } from './state-report'
import { attributionReport } from './attribution'
import { report as customReport } from './custom-report'
import { report as honorRoll } from './recognition'
import { recurringHealth } from './recurring-health'
import { restrictionReport } from './restricted-funds'
import { taxReport } from './tax-reports'

const reports = [
 {path:'/app/reports/dashboard',label:'Fundraising dashboard',read:(c:Context,u:URL)=>u.searchParams.get('view')==='entries'?dashboardEntries(c,u):dashboardReport(c,u)},
 {path:'/app/retention',label:'Donor retention',read:retention},
 {path:'/app/lapses',label:'Annual lapse lists',read:(c:Context,u:URL)=>annualLapses(c,u.searchParams.has('year')?Number(u.searchParams.get('year')):undefined)},
 {path:'/app/funds',label:'Giving by fund',read:fundReport},
 {path:'/app/reports/states',label:'Giving by state',read:stateReport},
 {path:'/app/gifts/attribution',label:'Gift attribution',read:attributionReport},
 {path:'/app/reports/custom-fields',label:'Gift custom fields',read:customReport},
 {path:'/app/reports/honor-roll',label:'Honor roll',read:honorRoll},
 {path:'/app/giving/health',label:'Recurring giving health',read:recurringHealth},
 {path:'/app/funds/restrictions',label:'Restricted funds',read:restrictionReport},
 {path:'/app/reports/tax',label:'Form 990 working papers',read:taxReport},
]
export const availableReports=reports.map(({path,label})=>({path:path==='/app/lapses'?path+'?annual=1':path,label}))
export function reportSelection(path: string, origin: string) {
 if(!path.startsWith('/app/')||path.startsWith('//')||path.includes('\\'))fail('REPORT_SELECTION','Choose a report link from this installation.',400)
 const u=new URL(path,origin),definition=reports.find(r=>r.path===u.pathname)
 if(u.origin!==origin||u.hash||!definition||(u.pathname==='/app/lapses'&&!u.searchParams.has('annual')))fail('REPORT_SELECTION','Choose an existing report or dashboard link.',400)
 return {url:u,definition,path:u.pathname+u.search}
}
export async function readScheduledReport(c:Context,path:string) {
 const s=reportSelection(path,c.env!.AUTH_ORIGIN)
 return {selection:s.path,generatedAt:c.now,title:s.definition.label,report:await s.definition.read(c,s.url)}
}

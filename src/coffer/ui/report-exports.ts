import { requireRole } from '../auth'
import { exportSnapshot, exportType, EXPORT_TYPES } from '../exports'
import { choice, type Context } from '../db'
import { customFields } from '../custom-fields'
import { box, e, field, select } from './common'

const reports=[['funds','Giving by fund'],['states','Giving by state'],['attribution','Gift attribution'],['custom-fields','Gift custom fields'],['honor-roll','Honor roll'],['retention','Donor retention'],['annual-lapses','Annual lapse lists'],['dashboard','Fundraising dashboard'],['recurring','Recurring health'],['tax','Form 990 working papers'],['restrictions','Restricted funds']] as [string,string][]
const metrics:Record<string,[string,string][]>= {
 retention:[['cohorts','Donor cohorts'],['recognition','Soft-credit recognition'],['ledger','Signed ledger reconciliation'],['excluded','Unidentified contributions']],
 dashboard:[['money','Received money'],['cohorts','Donor cohorts'],['new-donor-money','New donor money'],['recurring','Monthly recurring commitment'],['pipeline','Current opportunity pipeline']],
 recurring:[['all','All plan sources'],['active','Active plans'],['new','New plans'],['canceled','Ended plans'],['length','Plan length'],['failed','Failed invoices'],['recovered','Recovered invoices'],['unknown-start','Unknown starts'],['unknown-state','Unknown states']]
}
export async function reportExportsPage(c:Context,url:URL) {
 requireRole(c.actor,['owner','admin'],'export report records')
 const report=choice(url.searchParams.get('report')||'funds',reports.map(([key])=>key),'report'),type=exportType(url.searchParams.get('type')||'gifts'),query=new URLSearchParams(url.searchParams)
 query.set('report',report);query.set('type',type)
 const value=(key:string)=>query.get(key)||''
 const filter=[]
 if(['states','retention','annual-lapses','dashboard','tax'].includes(report))filter.push(field('Year','year','number',value('year')))
 if(['states','retention','tax'].includes(report))filter.push(select('Year basis','basis',[['calendar','Calendar'],['fiscal','Fiscal']],value('basis')||'calendar'))
 if(!['states','retention','annual-lapses','dashboard','tax'].includes(report))filter.push(field(report==='recurring'?'From month':'From','from',report==='recurring'?'month':'date',value('from')))
 if(!['states','retention','annual-lapses','dashboard','tax'].includes(report))filter.push(field(report==='recurring'?'Through month':'Through',report==='attribution'?'to':'through',report==='recurring'?'month':'date',value(report==='attribution'?'to':'through')))
 if(metrics[report])filter.push(select('Metric','metric',metrics[report],value('metric')||metrics[report][0][0],'aria-label="Metric"'))
 if(report==='recurring'||report==='dashboard'&&value('metric')==='recurring')filter.push(field('Selected month','month','month',value('month')))
 if(report==='tax')filter.push(select('Working paper','paper',[['schedule-a','Schedule A · five years'],['schedule-b','Schedule B · contributors'],['schedule-m','Schedule M · property'],['classifications','Contribution classifications']],value('paper')||'schedule-a'))
 if(report==='tax'&&value('paper')==='schedule-b')filter.push(select('Contributor cohort','cohort',[['selected','Selected contributors'],['all','All contributors'],['below','Below selection'],['unidentified','Unidentified contributions']],value('cohort')||'selected'))
 if(report==='tax'&&value('paper')==='classifications')filter.push(select('Contribution type','contributionType',[['all','All classified contributions'],['daf','Donor advised funds'],['qcd','Qualified charitable distributions']],value('contributionType')||'all'))
 if(report==='annual-lapses')filter.push(select('Cohort','list',[['lybunt','Last year but not this year'],['sybunt','Some year but not this year']],value('list')||'lybunt'))
 if(report==='custom-fields')filter.push(select('Gift custom field','field',(await customFields(c)).filter(f=>f.kind==='gift').map(f=>[f.key,f.label] as [string,string]),value('field')))
 if(report==='funds'||report==='states'||report==='retention'||report==='restrictions')filter.push(field('Fund (optional)','fund','text',value('fund')))
 let review=''
 if(url.searchParams.has('review')){
  const selected=new URL(url);selected.search=query.toString()
  const m=(await exportSnapshot(c,type,selected)).metadata,download=new URLSearchParams(query);download.delete('type');download.delete('review')
  review=box('Review report records',`<p>${m.rowCount} ${e(type)} rows · ${m.memberCount} current constituents.</p><p>${e(m.withheld.statement)}.</p><p>Scope: ${e(m.selection.scope)}. As of ${e(m.asOf)} · ${e(m.timezone)}.</p><p><a href="/api/coffer/exports/${e(type)}.csv?${e(download.toString())}">Download ${e(type)} CSV</a></p><p>The report’s own record type follows its selected period and scope. Other record types include donor lifetime records, identified as lifetime in the file name. Anonymous financial facts stay in report totals; private exports exclude erased identities.</p>`)
 }
 return box('Choose a report',`<form method="get" action="/app/report-exports"><div class="fields">${select('Report','report',reports,report,'aria-label="Report"')}</div><button>Choose report</button></form>`)+box('Select report records',`<form method="get" action="/app/report-exports"><input type="hidden" name="report" value="${e(report)}"><div class="fields">${select('Record type','type',EXPORT_TYPES.map(t=>[t,t] as [string,string]),type,'aria-label="Record type"')}${filter.join('')}</div><button name="review" value="yes">Review report export</button></form>`)+review
}

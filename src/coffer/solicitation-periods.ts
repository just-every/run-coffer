import { date } from './db'

export const SOLICITATION_PERIODS = ['rolling-12-months','calendar-year','calendar-quarter','calendar-month','fiscal-year','fiscal-quarter','fiscal-month'] as const
export type SolicitationPeriod = typeof SOLICITATION_PERIODS[number]
export const SOLICITATION_PERIOD_LABELS:Record<SolicitationPeriod,string> = {
 'rolling-12-months':'Rolling 12 months','calendar-year':'Calendar year','calendar-quarter':'Calendar quarter','calendar-month':'Calendar month',
 'fiscal-year':'Fiscal year','fiscal-quarter':'Fiscal quarter','fiscal-month':'Fiscal month',
}
export const SOLICITATION_COUNT_COLUMNS=Object.fromEntries(SOLICITATION_PERIODS.map((p,i)=>[p,`period_${i}`])) as Record<SolicitationPeriod,string>
const dayAfter=(d:string)=>new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10)
// Fiscal months/quarters are anchored to the saved fiscal start day, clamped
// to the last day of shorter months. Every boundary uses organization-local days.
const monthOffset=(anchor:string,n:number)=>{
 const [y,m,d]=anchor.split('-').map(Number),last=new Date(Date.UTC(y,m-1+n+1,0)).getUTCDate()
 return new Date(Date.UTC(y,m-1+n,Math.min(d,last))).toISOString().slice(0,10)
}
export function solicitationPeriodWindows(value:string,fiscalStart='01-01'):Record<SolicitationPeriod,{start:string;through:string}> {
 const day=date(value,'Ask date'),year=Number(day.slice(0,4)),month=Number(day.slice(5,7))
 const quarterMonth=Math.floor((month-1)/3)*3+1
 const start=(m:number)=>`${day.slice(0,4)}-${String(m).padStart(2,'0')}-01`
 const end=(m:number)=>new Date(Date.UTC(year,m,0)).toISOString().slice(0,10)
 const fiscalAnchor=`${day.slice(5)>=fiscalStart?year:year-1}-${fiscalStart}`
 const window=(months:number)=>{
  let offset=0;while(monthOffset(fiscalAnchor,offset+months)<=day)offset+=months
  const next=monthOffset(fiscalAnchor,offset+months)
  return {start:monthOffset(fiscalAnchor,offset),through:new Date(Date.parse(next+'T00:00:00Z')-86400000).toISOString().slice(0,10)}
 }
 return {
  'rolling-12-months':{start:dayAfter(monthOffset(day,-12)),through:day},
  'calendar-year':{start:start(1),through:`${day.slice(0,4)}-12-31`},
  'calendar-quarter':{start:start(quarterMonth),through:end(quarterMonth+2)},
  'calendar-month':{start:start(month),through:end(month)},
  'fiscal-year':window(12),'fiscal-quarter':window(3),'fiscal-month':window(1),
 }
}
export function solicitationCounts(windows:ReturnType<typeof solicitationPeriodWindows>) {
 return {sql:SOLICITATION_PERIODS.map(p=>`COUNT(CASE WHEN a.asked_on>=? THEN 1 END) AS ${SOLICITATION_COUNT_COLUMNS[p]}`).join(','),params:SOLICITATION_PERIODS.map(p=>windows[p].start)}
}
export const solicitationCountCase=`CASE s.period ${SOLICITATION_PERIODS.map(p=>`WHEN '${p}' THEN a.${SOLICITATION_COUNT_COLUMNS[p]}`).join(' ')} END`

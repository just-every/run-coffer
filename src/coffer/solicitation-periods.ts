import { date } from './db'

export const SOLICITATION_PERIODS = ['calendar-year','calendar-quarter','calendar-month'] as const
export type SolicitationPeriod = typeof SOLICITATION_PERIODS[number]
export const SOLICITATION_PERIOD_LABELS:Record<SolicitationPeriod,string> = {
 'calendar-year':'Calendar year','calendar-quarter':'Calendar quarter','calendar-month':'Calendar month',
}
export const SOLICITATION_COUNT_COLUMNS:Record<SolicitationPeriod,string> = {
 'calendar-year':'year_count','calendar-quarter':'quarter_count','calendar-month':'month_count',
}

/** Input is already the organization's local day. All endpoints are inclusive;
 * UTC is used only to calculate calendar dates, never to select the local day. */
export function solicitationPeriodWindows(value:string):Record<SolicitationPeriod,{start:string;through:string}> {
 const day=date(value,'Ask date'),year=Number(day.slice(0,4)),month=Number(day.slice(5,7))
 const quarterMonth=Math.floor((month-1)/3)*3+1
 const start=(m:number)=>`${day.slice(0,4)}-${String(m).padStart(2,'0')}-01`
 const end=(m:number)=>new Date(Date.UTC(year,m,0)).toISOString().slice(0,10)
 return {
  'calendar-year':{start:start(1),through:`${day.slice(0,4)}-12-31`},
  'calendar-quarter':{start:start(quarterMonth),through:end(quarterMonth+2)},
  'calendar-month':{start:start(month),through:end(month)},
 }
}

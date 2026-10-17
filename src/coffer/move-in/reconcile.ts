import type { ImportTotals, ParsedImport, Total } from './types'
export type Difference = {scope:string;key:string;sourceCount:number|null;cofferCount:number;sourceCents:number|null;cofferCents:number;matches:boolean}
export function compare(parsed: ParsedImport, destination: ImportTotals = parsed.mappedTotals): Difference[] {
 const rows: Difference[]=[]
 const add=(scope:string,key:string,a:Partial<Total>,b:Total)=>rows.push({scope,key,sourceCount:a.giftCount??null,cofferCount:b.giftCount,sourceCents:a.amountCents??null,cofferCents:b.amountCents,matches:(a.giftCount===undefined||a.giftCount===b.giftCount)&&(a.amountCents===undefined||a.amountCents===b.amountCents)})
 add('all','All gifts',parsed.sourceTotals,destination)
 for(const [scope,field] of [['year','byYear'],['fund','byFund'],['donor','byDonor']] as const) {
  for(const key of new Set([...Object.keys(parsed.sourceTotals[field]),...Object.keys(destination[field])]))add(scope,key,parsed.sourceTotals[field][key]||{giftCount:0,amountCents:0},destination[field][key]||{giftCount:0,amountCents:0})
 }
 for(const control of parsed.controlTotals)add(`source report ${control.scope}`,control.key,{...(control.giftCount===null?{}:{giftCount:control.giftCount}),...(control.amountCents===null?{}:{amountCents:control.amountCents})},control.scope==='all'?destination:destination[control.scope==='year'?'byYear':control.scope==='fund'?'byFund':'byDonor'][control.key]||{giftCount:0,amountCents:0})
 return rows
}

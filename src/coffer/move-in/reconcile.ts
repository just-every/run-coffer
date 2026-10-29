import { outcomeScopes } from './types'
import type { ImportTotals, OutcomeScope, OutcomeTotals, ParsedImport, Total } from './types'
export type Difference = {scope:string;key:string;sourceCount:number|null;cofferCount:number;sourceCents:number|null;cofferCents:number;matches:boolean}
export function compare(parsed: ParsedImport, destination: ImportTotals = parsed.mappedTotals, outcomes:OutcomeTotals|undefined=parsed.outcomeTotals): Difference[] {
 const rows: Difference[]=[]
 const add=(scope:string,key:string,a:Partial<Total>,b:Total)=>rows.push({scope,key,sourceCount:a.giftCount??null,cofferCount:b.giftCount,sourceCents:a.amountCents??null,cofferCents:b.amountCents,matches:(a.giftCount===undefined||a.giftCount===b.giftCount)&&(a.amountCents===undefined||a.amountCents===b.amountCents)})
 add('all','All gifts',parsed.sourceTotals,destination)
 for(const [scope,field] of [['year','byYear'],['fund','byFund'],['donor','byDonor']] as const) {
  for(const key of new Set([...Object.keys(parsed.sourceTotals[field]),...Object.keys(destination[field])]))add(scope,key,parsed.sourceTotals[field][key]||{giftCount:0,amountCents:0},destination[field][key]||{giftCount:0,amountCents:0})
 }
 if(parsed.outcomeTotals&&outcomes)for(const scope of outcomeScopes){if(!Object.hasOwn(parsed.outcomeTotals,scope))continue;for(const key of new Set([...Object.keys(parsed.outcomeTotals[scope]),...Object.keys(outcomes[scope])]))add(scope,key,parsed.outcomeTotals[scope][key]??(scope==='active plan'&&!Object.keys(parsed.outcomeTotals[scope]).length?{}:{giftCount:0,amountCents:0}),outcomes[scope][key]??{giftCount:0,amountCents:0})}
 for(const control of parsed.controlTotals)add(`source report ${control.scope}`,control.key,{...(control.giftCount===null?{}:{giftCount:control.giftCount}),...(control.amountCents===null?{}:{amountCents:control.amountCents})},control.scope==='all'?destination:outcomeScopes.includes(control.scope as OutcomeScope)?outcomes?.[control.scope as OutcomeScope][control.key]??{giftCount:0,amountCents:0}:destination[control.scope==='year'?'byYear':control.scope==='fund'?'byFund':'byDonor'][control.key]||{giftCount:0,amountCents:0})
 return rows
}

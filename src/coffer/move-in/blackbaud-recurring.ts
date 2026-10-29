import { fail } from '../db'
import { day } from './source-rows'
import type { ParsedRecurringReference } from './types'

type Row=Record<string,any>
const error=(message:string):never=>fail('SKY_RECURRING',message+' Nothing was applied.',400)
/** The processor supplement attests opaque references and the original schedule.
 * It never supplies authority to charge, stop a source plan or retry a payment. */
export function blackbaudRecurring(gift:Row,sourceFacts:Row|undefined,dimensions:Row[],amountCents:number):ParsedRecurringReference {
 const facts=sourceFacts??error('Review the original recurring schedule and processor-reference supplement.')
 if(Object.keys(facts).some(k=>!['frequency','method','nextOn','startsOn','endsOn','customerReference','paymentMethodReference'].includes(k)))error('Review the original recurring schedule and processor-reference supplement.')
 if(!['Active','Held','Terminated','Completed','Cancelled'].includes(gift.gift_status)||amountCents<=0||dimensions.length!==1||gift.soft_credits?.length||gift.linked_gifts?.length)error('Review recurring status, amount and designation. Split plans and linked histories need a separate migration.')
 if(!['weekly','biweekly','monthly','quarterly','semiannual','annual'].includes(facts.frequency)||!['card','bank','cash','check','other'].includes(facts.method))error('Review the recurring frequency and source payment method.')
 const date=(v:unknown,required=false)=>{if((v===undefined||v===null||v==='')&&!required)return null;if(typeof v!=='string'||!day(v))error('Supply complete original schedule dates.');return v as string}
 const startsOn=date(facts.startsOn,true)!,endsOn=date(facts.endsOn),nextOn=date(facts.nextOn)
 if(endsOn&&endsOn<startsOn||nextOn&&nextOn<startsOn||nextOn&&endsOn&&nextOn>endsOn||gift.gift_status==='Active'&&!nextOn)error('Review the original recurring start, end and next dates; no dates are inferred.')
 const reference=(value:unknown)=>{if(value===undefined||value===null||value==='')return null;if(typeof value!=='string'||!/[a-z]/i.test(value)||!/[0-9_-]/.test(value)||!(/^[a-z][a-z0-9_:-]{0,199}$/i).test(value))error('Retain opaque processor references only, never raw account or card data.');return value as string}
 return {externalId:gift.id,donorExternalId:gift.constituent_id,amountCents,frequency:facts.frequency,status:gift.gift_status,method:facts.method,campaign:dimensions[0].campaign,fund:dimensions[0].fund,appeal:dimensions[0].appeal,nextOn,customerReference:reference(facts.customerReference),paymentMethodReference:reference(facts.paymentMethodReference),schedule:{startsOn,endsOn},location:{file:'sky-recurring.json',sheet:'SKY',row:1}}
}

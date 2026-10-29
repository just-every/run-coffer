import { fail } from '../db'
import { day } from './source-rows'
import { sourceId } from './bloomerang-edge'
import type { ParsedRecurringReference } from './types'

/** Schedule and vault facts come from an explicit source report, not inferred
 * from the REST transaction method's masked card or bank details. */
export function bloomerangRecurring(record:Record<string,any>,facts:Record<string,any>|undefined,donorExternalId:string):ParsedRecurringReference {
 const externalId=sourceId(record.Id)
 const allowed=['frequency','status','method','campaign','nextOn','customerReference','paymentMethodReference']
 if(record.EntryType!=='RecurringDonation'||!facts||typeof facts!=='object'||Array.isArray(facts)||Object.keys(facts).some(k=>!allowed.includes(k)))fail('BLOOMERANG_RECURRING','Each recurring source record needs its explicit reviewed schedule report. Nothing was applied.',400)
 if(!['daily','weekly','biweekly','monthly','quarterly','semiannual','annual'].includes(facts.frequency)||!['active','paused','canceled','completed'].includes(facts.status)||!['card','bank','cash','check','unknown'].includes(facts.method))fail('BLOOMERANG_RECURRING','Review the source frequency, status and payment classification. No replacement schedule is created.',400)
 if(typeof record.Amount!=='number'||record.Amount<=0||!Number.isSafeInteger(Math.round(record.Amount*100))||Math.abs(record.Amount*100-Math.round(record.Amount*100))>0.00001)fail('BLOOMERANG_RECURRING','The source plan amount must be positive exact USD cents.',400)
 const nextOn=facts.nextOn?day(facts.nextOn):null
 if(facts.nextOn&&!nextOn||facts.campaign!==undefined&&(typeof facts.campaign!=='string'||facts.campaign.length>1000))fail('BLOOMERANG_RECURRING','Review the source next date and campaign.',400)
 const reference=(key:string)=>{
  const value=facts[key]
  if(value===undefined||value===null||value==='')return null
  if(typeof value!=='string'||!/^[a-z][a-z0-9_:-]{0,199}$/i.test(value))fail('BLOOMERANG_RECURRING','Retain opaque source references only, never card or bank account details.',400)
  return value
 }
 return {externalId,donorExternalId,amountCents:Math.round(record.Amount*100),frequency:facts.frequency,status:facts.status,method:facts.method,campaign:facts.campaign??record.CampaignName??'',nextOn,customerReference:reference('customerReference'),paymentMethodReference:reference('paymentMethodReference'),location:{file:'Bloomerang RecurringDonation '+externalId,sheet:'REST and source report',row:1}}
}

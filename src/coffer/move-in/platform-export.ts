import { SourceRow, day, money, valueText } from './source-rows'
import type { ParsedImport, Table } from './types'

/** Labels from the payment export, followed by explicit source-evidence columns.
 * Keep unknown columns in the ordinary review instead of silently dropping them. */
const zeffyLabels:Record<string,string>={
 'Payment ID':'Gift ID','Contact ID':'Constituent ID','Form name':'Campaign','Form Name':'Campaign',
 'Payment date':'Gift Date','Payment Date':'Gift Date','Donation amount':'Amount','Donation Amount':'Amount',
 'Payment method':'Payment Method','First name':'First Name','Last name':'Last Name',
 'Advantage amount':'Non-Deductible Amount','Tax receipt date':'Acknowledgment Date','Receipt number':'Acknowledgment Reference',
 'Dedication name':'Tribute Honoree','Dedication type':'Tribute Type',
}
export function platformTables(tables:Table[],out:ParsedImport):Table[] {
 if(!['givebutter','zeffy'].includes(out.source))return tables
 return tables.map(table=>{
  const rows=table.rows.map(r=>[...r]),headers=rows[0]?.map(valueText)??[]
  if(out.source==='zeffy')rows[0]=headers.map(h=>zeffyLabels[h]??h)
  const labels=rows[0]?.map(valueText)??[]
  const index=(h:string)=>labels.indexOf(h)
  const gift=index('Gift ID')>=0&&index('Amount')>=0
  if(gift&&index('Gift Type')<0){rows[0].push('Gift Type');for(const row of rows.slice(1))row.push('Gift')}
  if(gift){
   if(index('Acknowledgment Status')<0){rows[0].push('Acknowledgment Status');for(const row of rows.slice(1))row.push(index('Acknowledgment Date')>=0&&valueText(row[index('Acknowledgment Date')])?'acknowledged':'not acknowledged')}
   if(index('Acknowledgment Method')<0){rows[0].push('Acknowledgment Method');for(const row of rows.slice(1))row.push(index('Acknowledgment Date')>=0&&valueText(row[index('Acknowledgment Date')])?'email':'')}
  }
  return {...table,rows}
 })
}
export function platformRow(r:SourceRow,out:ParsedImport):boolean {
 if(!['givebutter','zeffy'].includes(out.source)||!r.peek('planId'))return false
 const externalId=r.required('planId'),donorExternalId=r.required('donorId'),amountCents=r.cents('amount')
 const frequency=r.required('frequency'),status=r.required('planStatus'),method=r.get('method'),campaign=r.get('campaign')
 const next=r.get('nextOn'),nextOn=next?day(next):null
 if(next&&!nextOn)r.error('DATE','Source next charge must be a real date.','nextOn')
 const customerReference=r.get('customerReference')||null,paymentMethodReference=r.get('paymentMethodReference')||null
 for(const reference of [customerReference,paymentMethodReference])if(reference&&!/^[a-z][a-z0-9_:-]{0,199}$/i.test(reference))r.error('PLAN_REFERENCE','Retain opaque source references only, never payment account details.','customerReference')
 if(!customerReference||!paymentMethodReference)out.diagnostics.push({...r.location,severity:'warning',code:'PLAN_REFERENCE_MISSING',message:'Source processor references are incomplete. Retain the plan as evidence only; obtain source mapping before MOVE-009.'})
 if((out.recurringReferences??=[]).some(p=>p.externalId===externalId))r.error('DUPLICATE_ID','Source plan ID is repeated.','planId')
 if(amountCents!==null)out.recurringReferences.push({externalId,donorExternalId,amountCents,frequency,status,method,campaign,nextOn,customerReference,paymentMethodReference,location:r.location})
 r.finish();return true
}
export function platformGift(r:SourceRow,out:ParsedImport) {
 if(!['givebutter','zeffy'].includes(out.source))return undefined
 const campaignId=r.get('campaignId'),campaignName=r.peek('campaign'),fee=r.get('fee')
 const feeCents=fee===''&&out.source==='zeffy'?0:money(fee)
 if(feeCents===null)r.error('PLATFORM_FEE','Supply the source fee as a non-negative USD amount.','fee')
 const status=r.get('paymentStatus').toLowerCase(),refunded=r.get('refunded'),currency=r.get('currency')
 if(status&&!['paid','succeeded','successful','completed'].includes(status))r.error('PLATFORM_STATUS','Only completed historical payments can be imported. Resolve pending or failed source rows first.','paymentStatus')
 if(refunded&&!['false','no'].includes(refunded.toLowerCase())&&money(refunded)!==0)r.error('PLATFORM_REFUND','A refunded source transaction requires separate reviewed reversal history; do not import its gross amount as cash.','refunded')
 if(currency.toUpperCase()!=='USD')r.error('PLATFORM_CURRENCY','This door currently accepts USD history only.','currency')
 return {campaignId,campaignName,feeCents:feeCents??0}
}

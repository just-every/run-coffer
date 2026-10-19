import type { ImportSource } from './types'

/** Exact report labels plus documented, user-configurable export label variants. */
const common: Record<string, string[]> = {
 name: ['Name', 'Full Name', 'Constituent Name', 'Donor Name'], prefix: ['Prefix', 'Name Title'], firstName: ['First Name'], middleName: ['Middle Name'], lastName: ['Last Name'], suffix: ['Suffix', 'Name Suffix'],
 organization: ['Organization Name', 'Organisation Name', 'Org Name'], isOrg: ['Is Org', 'Is Organization', 'Is Organisation'], email: ['Email', 'Email Address', 'Primary Email', 'Primary Email Address', 'Preferred Email'],
 phone: ['Phone', 'Phone Number', 'Primary Phone', 'Primary Phone Number', 'Preferred Phone'],
 addressLine1: ['Address', 'Address Line 1', 'Address 1', 'Street Address', 'Street', 'Primary Street', 'Primary Street Address', 'Preferred Address'],
 addressLine2: ['Address Line 2', 'Address 2', 'Street Address 2', 'Primary Street 2'], city: ['City', 'Primary City'],
 region: ['State', 'Province', 'State/Province', 'Region', 'Primary State'], postalCode: ['ZIP', 'ZIP Code', 'Postal Code', 'Postcode', 'Primary Postal Code'], country: ['Country', 'Primary Country'],
 householdKey: ['Household ID', 'Household Account Number'], householdName: ['Household Name'],
 amount: ['Amount', 'Gift Amount', 'Transaction Amount', 'Pledge Amount'], date: ['Date', 'Gift Date', 'Transaction Date', 'Pledge Date'],
 type: ['Type', 'Gift Type', 'Transaction Type'], fund: ['Fund', 'Fund Name', 'Fund Description'], campaign: ['Campaign', 'Campaign Name'], appeal: ['Appeal', 'Appeal Name'], channel: ['Channel', 'Gift Channel', 'Solicitation Channel'],
 checkReference: ['Check No.', 'Check Number', 'Check/Reference No.', 'Check/Reference Number'],
 method: ['Method', 'Payment Type', 'Payment Method', 'Transaction Method', 'Pay Method'], giftNote: ['Gift Note', 'Gift Notes', 'Transaction Note', 'Gift Reference', 'Reference'],
 acknowledgmentStatus: ['Acknowledgment Status', 'Acknowledgement Status', 'Acknowledgment', 'Acknowledgement', 'Acknowledged'],
 acknowledgmentDate: ['Acknowledgment Date', 'Acknowledgement Date', 'Acknowledged Date', 'Acknowledged On'],
 acknowledgmentMethod: ['Acknowledgment Method', 'Acknowledgement Method'],
 acknowledgmentReason: ['Acknowledgment Reason', 'Acknowledgement Reason', 'Do Not Acknowledge Reason'],
 note: ['Note', 'Notes', 'Note Text', 'Description'], noteId: ['Note ID', 'Note Number'], noteDate: ['Note Date'], noteType: ['Note Type', 'Note Category'],
 relationshipId: ['Relationship ID'], relatedDonor: ['Related Constituent ID', 'Related Account Number', 'Relationship Constituent ID'], relationshipType: ['Relationship Type', 'Relationship'],
 softId: ['Soft Credit ID', 'Soft Credit Number'], softDonor: ['Soft Credit Constituent ID', 'Soft Credit Account Number', 'Soft Credit Recipient ID'],
 softAmount: ['Soft Credit Amount', 'Soft Credited Amount'], softGift: ['Original Gift ID', 'Original Transaction Number', 'Soft Credit Gift ID', 'Related Gift ID'],
 pledgeId: ['Pledge ID', 'Pledge Number', 'Pledge Transaction Number'], parentId: ['Parent Gift ID', 'LGL Parent Gift ID', 'Parent Transaction Number', 'Linked Pledge ID'],
 installmentId: ['Installment ID', 'Installment Number'], dueOn: ['Due Date', 'Installment Date', 'Installment Due Date'], installmentAmount: ['Installment Amount'],
 goodsDescription: ['Goods Description', 'Goods and Services Description', 'Benefit Description'],
 goodsAmount: ['Non-Deductible Amount', 'Nondeductible Amount', 'Goods and Services Amount', 'Benefit Amount'], deductible: ['Deductible', 'Deductible Amount', 'Receipt Amount'],
 controlCount: ['Gift Count', 'Total Number of Gifts', 'Total Gift Count', 'Transaction Count', 'TG Count', 'Total Giving Count'], controlAmount: ['Total Gift Amount', 'Total Amount of Gifts', 'Revenue Total', 'Total Revenue', 'TG Amount', 'Total Giving Amount', 'Lifetime Revenue'],
 controlYear: ['Year', 'Calendar Year'],
}
const vendor: Record<ImportSource, Record<string, string[]>> = {
 lgl: {
  donorId: ['LGL Constituent ID', 'Constituent ID'], giftId: ['LGL Gift ID', 'Gift ID'],
  sortName: ['Sort Name'], relatedName: ['Related Constituent Name'],
  deductible: ['Deductible', 'Deductible Amount', 'Tax Deductible Amt'],
 },
 bloomerang: { name: ['Name', 'Full Name', 'Constituent Name'], softName: ['Donor Name', 'Soft Credit Name(s)'], donorId: ['Account Number', 'Constituent ID'], giftId: ['Transaction Number', 'Transaction ID'] },
 're-nxt': { donorId: ['Constituent ID', 'Constituent System Record ID'], giftId: ['Gift ID', 'Gift System Record ID'] },
}
export function normalizeLabel(value: string) { return value.toLowerCase().replace(/\uFEFF/g, '').replace(/[^a-z0-9]/g, '') }
export function columnFields(source: ImportSource): Map<string, string> {
 const fields = new Map<string, string>()
 for (const [key, labels] of Object.entries({ ...common, ...vendor[source] })) for (const label of labels) fields.set(normalizeLabel(label), key)
 return fields
}

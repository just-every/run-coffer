import type { ImportSource } from './types'

/** Exact report labels plus documented, user-configurable export label variants. */
const common: Record<string, string[]> = {
 sourceEventId:['Source Event ID'],sourceEventName:['Source Event Name'],sourceEventStarts:['Source Event Starts'],sourceGuestId:['Source Guest ID'],sourceAttendeeAccount:['Source Attendee Account ID'],sourceEventGift:['Source Event Gift ID'],sourceRegistration:['Source Registration ID'],sourceTicket:['Source Ticket'],sourceAttendeeName:['Source Attendee Name'],sourceAttendeeEmail:['Source Attendee Email'],sourceAttended:['Source Attended'],sourceRegistrationStatus:['Source Registration Status'],
 membershipId:['Source Membership ID'],membershipLevelId:['Membership Level ID'],membershipLevel:['Membership Level'],membershipTerm:['Membership Term'],membershipStarts:['Membership Starts'],membershipEnds:['Membership Ends'],membershipStatus:['Membership Status'],membershipFee:['Membership Fee'],membershipGift:['Membership Gift ID'],membershipAuto:['Source Auto Renewal'],membershipActive:['Source Active'],
 planId:['Plan ID'],frequency:['Frequency'],planStatus:['Plan Status'],nextOn:['Next Charge Date'],customerReference:['Processor Customer Reference'],paymentMethodReference:['Processor Payment Method Reference'],
 campaignId:['Campaign ID'],fee:['Fees','Fee'],paymentStatus:['Payment Status'],refunded:['Refunded Amount'],currency:['Currency'],
 restrictionDate: ['Communication Restriction Date', 'Communication Tag Date', 'Solicit Code Date', 'Restriction Date'],
 name: ['Name', 'Full Name', 'Constituent Name', 'Donor Name'], prefix: ['Prefix', 'Name Title'], firstName: ['First Name'], middleName: ['Middle Name'], lastName: ['Last Name'], suffix: ['Suffix', 'Name Suffix'],
 organization: ['Organization Name', 'Organisation Name', 'Org Name'], isOrg: ['Is Org', 'Is Organization', 'Is Organisation'], email: ['Email', 'Email Address', 'Primary Email', 'Primary Email Address', 'Preferred Email'],
 phone: ['Phone', 'Phone Number', 'Primary Phone', 'Primary Phone Number', 'Preferred Phone'],
 addressLine1: ['Address', 'Address Line 1', 'Address 1', 'Street Address', 'Street', 'Primary Street', 'Primary Street Address', 'Preferred Address'],
 addressLine2: ['Address Line 2', 'Address 2', 'Street Address 2', 'Primary Street 2'], city: ['City', 'Primary City'],
 region: ['State', 'Province', 'State/Province', 'Region', 'Primary State'], postalCode: ['ZIP', 'ZIP Code', 'Postal Code', 'Postcode', 'Primary Postal Code'], country: ['Country', 'Primary Country'],
 householdKey: ['Household ID', 'Household Account Number'], householdName: ['Household Name'],
 householdHead: ['Head of Household', 'Is Head of Household', 'Household Head', 'Head of Household?'],
 householdHeadId: ['Head of Household ID', 'Household Head Constituent ID', 'Household Head Account Number'],
 householdAddressee: ['Household Addressee'], householdFormal: ['Household Formal Salutation', 'Household Formal Greeting'], householdInformal: ['Household Informal Salutation', 'Household Informal Greeting'],
 nickname: ['Nickname', 'Nick Name'], recognitionName:['Recognition Name'],
 informalName: ['Informal Name', 'Informal Salutation', 'Short Salutation', 'Salutation'], formalName: ['Formal Name', 'Formal Salutation', 'Long Salutation', 'Primary Salutation'], envelopeName: ['Envelope Name', 'Addressee', 'Primary Addressee'], constituentStatus: ['Constituent Status', 'Deceased', 'Is Deceased'],
 deceasedOn: ['Date of Death', 'Deceased Date', 'Date Deceased', 'Death Date', 'Deceased On'], statusReason: ['Inactive Reason', 'Reason Inactive', 'Status Reason', 'Constituent Inactive Reason'],
 amount: ['Amount', 'Gift Amount', 'Transaction Amount', 'Pledge Amount'], date: ['Date', 'Gift Date', 'Transaction Date', 'Pledge Date'],
 type: ['Type', 'Gift Type', 'Transaction Type'], fund: ['Fund', 'Fund Name', 'Fund Description'], campaign: ['Campaign', 'Campaign Name'], appeal: ['Appeal', 'Appeal Name'], channel: ['Channel', 'Gift Channel', 'Solicitation Channel'],
 checkReference: ['Check No.', 'Check Number', 'Check/Reference No.', 'Check/Reference Number'],
 method: ['Method', 'Payment Type', 'Payment Method', 'Transaction Method', 'Pay Method'], giftNote: ['Gift Note', 'Gift Notes', 'Transaction Note', 'Gift Reference', 'Reference'],
 acknowledgmentStatus: ['Acknowledgment Status', 'Acknowledgement Status', 'Acknowledgment', 'Acknowledgement', 'Acknowledged', 'Acknowledged?'],
 acknowledgmentDate: ['Acknowledgment Date', 'Acknowledgement Date', 'Acknowledged Date', 'Acknowledged On'],
 acknowledgmentMethod: ['Acknowledgment Method', 'Acknowledgement Method'],
 acknowledgmentReason: ['Acknowledgment Reason', 'Acknowledgement Reason', 'Do Not Acknowledge Reason'],
 acknowledgmentOptOut: ['Do Not Acknowledge', 'Do Not Acknowledge?'],
 acknowledgmentReference: ['Acknowledgment Reference', 'Acknowledgement Reference'],
 acknowledgmentInteraction: ['Acknowledgment Interaction ID', 'Acknowledgement Interaction ID', 'Acknowledgment Action ID', 'Acknowledgement Action ID'],
 note: ['Note', 'Notes', 'Note Text', 'Description'], noteId: ['Note ID', 'Note Number', 'Interaction ID', 'Action ID', 'Contact Report ID'], noteDate: ['Note Date', 'Interaction Date', 'Action Date', 'Contact Report Date'], noteType: ['Note Type', 'Note Category', 'Interaction Type', 'Action Type', 'Contact Report Type'],
 relationshipId: ['Relationship ID'], relatedDonor: ['Related Constituent ID', 'Related Account Number', 'Relationship Constituent ID'], relationshipType: ['Relationship Type', 'Relationship'],
 softId: ['Soft Credit ID', 'Soft Credit Number'], softDonor: ['Soft Credit Constituent ID', 'Soft Credit Account Number', 'Soft Credit Recipient ID'],
 softAmount: ['Soft Credit Amount', 'Soft Credited Amount'], softGift: ['Original Gift ID', 'Original Transaction Number', 'Soft Credit Gift ID', 'Related Gift ID'],
 pledgeId: ['Pledge ID', 'Pledge Number', 'Pledge Transaction Number'], parentId: ['Parent Gift ID', 'LGL Parent Gift ID', 'Parent Transaction Number', 'Linked Pledge ID'],
 paymentInstallment:['Payment Installment ID'],installmentId: ['Installment ID', 'Installment Number'], dueOn: ['Due Date', 'Installment Date', 'Installment Due Date'], installmentAmount: ['Installment Amount'],
 goodsDescription: ['Goods Description', 'Goods and Services Description', 'Benefit Description'],
 goodsAmount: ['Non-Deductible Amount', 'Nondeductible Amount', 'Goods and Services Amount', 'Benefit Amount'], deductible: ['Deductible', 'Deductible Amount', 'Receipt Amount'],
 controlCount: ['Gift Count', 'Total Number of Gifts', 'Total Gift Count', 'Transaction Count', 'TG Count', 'Total Giving Count'], controlAmount: ['Total Gift Amount', 'Total Amount of Gifts', 'Revenue Total', 'Total Revenue', 'TG Amount', 'Total Giving Amount', 'Lifetime Revenue'],
 controlYear: ['Year', 'Calendar Year'],
}
const vendor: Record<ImportSource, Record<string, string[]>> = {
 neon: {donorId:['Constituent ID'],giftId:['Gift ID'],communicationRestrictions:['Communication Restrictions'],tributeHonoree:['Tribute Honoree'],tributeType:['Tribute Type'],tributeGroup:['Tribute Group'],tributeNotifiedName:['Tribute Recipient Name'],tributeNotifiedEmail:['Tribute Recipient Email'],tributeNotifiedAddress:['Tribute Recipient Address'],emailPreference:['Email Preference'],mailPreference:['Mail Preference'],smsPreference:['SMS Preference'],phonePreference:['Phone Preference'],preferenceDate:['Preference Date']},
 givebutter: {}, zeffy: {},
 spreadsheet: {donorId:['Constituent ID'],giftId:['Gift ID'],communicationRestrictions:['Communication Restrictions'],tributeHonoree:['Tribute Honoree'],tributeType:['Tribute Type'],tributeGroup:['Tribute Group'],tributeNotifiedName:['Tribute Recipient Name'],tributeNotifiedEmail:['Tribute Recipient Email'],tributeNotifiedAddress:['Tribute Recipient Address'],emailPreference:['Email Preference'],mailPreference:['Mail Preference'],smsPreference:['SMS Preference'],phonePreference:['Phone Preference'],preferenceDate:['Preference Date']},
 lgl: {
  communicationRestrictions: ['Communication Tags', 'Communication Tag', 'Communication Preferences'],
  tributeHonoree: ['Tribute Hon./Mem. Name'], tributeGroup: ['Tribute Name'], tributeType: ['Tribute Dedication'],
  tributeNotifiedName: ['Tribute Recipient Name'], tributeNotifiedEmail: ['Tribute Recipient Email'], tributeNotifiedAddress: ['Tribute Recipient Address'],
  donorId: ['LGL Constituent ID', 'Constituent ID'], giftId: ['LGL Gift ID', 'Gift ID'],
  sortName: ['Sort Name'], relatedName: ['Related Constituent Name'],
  deductible: ['Deductible', 'Deductible Amount', 'Tax Deductible Amt'],
  acknowledgmentTemplate: ['Acknowledgment Template', 'Acknowledgement Template', 'Acknowledgment Template Name', 'Acknowledgement Template Name'],
  acknowledgmentOptOut: ['Do Not Acknowledge', 'Do Not Acknowledge?', 'Do Not Acknowledge via LGL'],
 },
 bloomerang: { communicationRestrictions: ['Communication Restrictions', 'Communication Restriction'], tributeHonoree: ['Tribute'], tributeType: ['Tribute Type'], hasTribute: ['Has Tribute'], name: ['Name', 'Full Name', 'Constituent Name'], softName: ['Donor Name', 'Soft Credit Name(s)'], donorId: ['Account Number', 'Constituent ID'], giftId: ['Transaction Number', 'Transaction ID'] },
 're-nxt': { communicationRestrictions: ['Solicit Codes', 'Solicit Code', 'Constituent Solicit Codes'], tributeHonoree: ['Tribute Honoree'], tributeType: ['Tribute Type'], donorId: ['Constituent ID', 'Constituent System Record ID'], giftId: ['Gift ID', 'Gift System Record ID'],
  acknowledgmentReference: ['Acknowledgment Reference', 'Acknowledgement Reference', 'Acknowledgment Letter', 'Acknowledgement Letter', 'Acknowledgment Letter ID', 'Acknowledgement Letter ID', 'Linked Acknowledgment Letter', 'Linked Acknowledgement Letter'],
 },
}
export function normalizeLabel(value: string) { return value.toLowerCase().replace(/\uFEFF/g, '').replace(/[^a-z0-9]/g, '') }
export function columnFields(source: ImportSource): Map<string, string> {
 const fields = new Map<string, string>()
 for(const kind of ['email','phone','address'])for(let n=1;n<=(source==='neon'?32:kind==='address'?2:3);n++){const key=kind+(n===1?'':n);for(const suffix of ['Type','Primary','From','Through'])fields.set(normalizeLabel(kind+' '+n+' '+suffix),key+suffix);if(n===1)for(const suffix of ['Type','Primary','From','Through'])fields.set(normalizeLabel(kind+' '+suffix),key+suffix);if(n>1&&kind!=='address')for(const label of [kind+' '+n,kind+' Address '+n])fields.set(normalizeLabel(label),key);if(n>1&&kind==='address')for(const [suffix,label] of [['Line1','Street'],['Line2','Street 2'],['City','City'],['Region','State'],['PostalCode','Postal Code'],['Country','Country']])fields.set(normalizeLabel('Address '+n+' '+label),key+suffix)}
 for (const [key, labels] of Object.entries({ ...common, ...(['givebutter','zeffy'].includes(source)?vendor.spreadsheet:{}), ...vendor[source] })) for (const label of labels) {
  fields.set(normalizeLabel(label), key)
  if (key.startsWith('acknowledgment')) fields.set(normalizeLabel(`Soft Credit ${label}`), `soft${key[0].toUpperCase()}${key.slice(1)}`)
 }
 return fields
}

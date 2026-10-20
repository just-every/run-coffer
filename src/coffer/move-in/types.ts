/** Normalized, source-referenced preview. No database writes or invented CRM IDs. */
export type ImportSource = 'lgl' | 'bloomerang' | 're-nxt'
export type ExportFile = { name: string; base64: string }
export type SourceLocation = { file: string; sheet: string; row: number }
export type Diagnostic = Partial<SourceLocation> & { severity: 'error' | 'warning'; code: string; message: string; column?: string }
export type UnmappedValue = SourceLocation & { column: string; value: string; reason: string }
export type Located = { location: SourceLocation }
export type ParsedDonor = Located & {
 externalId: string; name: string; email: string; phone: string; addressLine1: string; addressLine2: string
 city: string; region: string; postalCode: string; country: string; householdKey: string; householdName: string
 firstName: string; lastName: string; organization: boolean
}
export type ParsedGift = Located & {
 externalId: string; donorExternalId: string; receivedOn: string; amountCents: number; fund: string
 campaign: string; appeal?: string; channel?: string; checkReference?: string; method: string; note: string; pledgeExternalId: string; noGoodsOrServices: boolean; goodsCents: number | null; goodsDescription: string; tribute?: ParsedTribute; acknowledgment?: ParsedAcknowledgment
}
export type ParsedTribute = { kind: 'honor' | 'memory'; honoree: string; notifiedName?: string; notifiedEmail?: string; notifiedAddress?: string; sourceGroup?: string }
export type ParsedAcknowledgment = {
 status: 'acknowledged' | 'not acknowledged' | 'do not acknowledge'
 acknowledgedOn: string | null; method: string | null; reason: string | null; sourceReference: string | null
}
export type ParsedHousehold = Located & { externalId: string; name: string }
export type ParsedRelationship = Located & { externalId: string; donorExternalId: string; relatedDonorExternalId: string; type: string }
export type ParsedSoftCredit = Located & { externalId: string; donorExternalId: string; giftExternalId: string; amountCents: number; pledgeExternalId: string }
export type ParsedPledge = Located & { externalId: string; donorExternalId: string; pledgedOn: string; amountCents: number; fund: string; note: string }
export type ParsedInstallment = Located & { externalId: string; pledgeExternalId: string; dueOn: string; amountCents: number }
export type ParsedNote = Located & { externalId: string; donorExternalId: string; text: string; date: string; type: string }
export type Total = { giftCount: number; amountCents: number }
export type ImportTotals = Total & { byYear: Record<string, Total>; byFund: Record<string, Total>; byDonor: Record<string, Total>; complete: boolean }
export type ControlTotal = Located & {
 scope: 'all' | 'year' | 'fund' | 'donor'; key: string; giftCount: number | null; amountCents: number | null
 actual: Total; matches: boolean
}
export type ParsedImport = {
 source: ImportSource; donors: ParsedDonor[]; gifts: ParsedGift[]; households: ParsedHousehold[]
 relationships: ParsedRelationship[]; softCredits: ParsedSoftCredit[]; pledges: ParsedPledge[]
 installments: ParsedInstallment[]; notes: ParsedNote[]; unmapped: UnmappedValue[]; diagnostics: Diagnostic[]
 sourceTotals: ImportTotals; mappedTotals: ImportTotals; controlTotals: ControlTotal[]
 files: { name: string; bytes: number; sheets: string[]; rows: number }[]
}
export type ParseInput = { source: ImportSource; files: ExportFile[]; noGoodsOrServices?: boolean }
export type Cell = string | number | boolean | Date | null
export type Table = { file: string; sheet: string; rows: Cell[][] }

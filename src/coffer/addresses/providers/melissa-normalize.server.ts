import type { PostalAddress, SmartMoverAddressResult } from './types'
import { isUnitedStates, text } from './transport.server'

/** Codes are retained, never arbitrary provider text or the original response. */
export function resultCodes(value: unknown): string[] | undefined {
 if (typeof value !== 'string') return undefined
 const codes = value.split(',').map(code => code.trim()).filter(Boolean)
 if (codes.some(code => !/^[A-Z]{2}\d{2}$/.test(code))) return undefined
 return [...new Set(codes)]
}

function returnedAddress(record: Record<string, unknown>): PostalAddress | undefined {
 const address: PostalAddress = {
  street: text(record.AddressLine1), street2: text(record.AddressLine2), city: text(record.City),
  state: text(record.State), postalCode: text(record.PostalCode), country: text(record.CountryCode),
 }
 if (!isUnitedStates(address.country) || !address.street || !address.city || !/^[A-Z]{2}$/.test(address.state)) return undefined
 const plus4 = text(record.Plus4)
 if (!/^\d{5}(?:-\d{4})?$/.test(address.postalCode) || (plus4 && !/^\d{4}$/.test(plus4))) return undefined
 if (plus4 && address.postalCode.length === 5) address.postalCode += `-${plus4}`
 if (plus4 && !address.postalCode.endsWith(`-${plus4}`)) return undefined
 return { ...address, country: 'US' }
}

// https://docs.melissa.com/cloud-api/smartmover/result-codes.html
export function normalizeMoverRecord(record: Record<string, unknown>, id: string, codes: string[]): SmartMoverAddressResult {
 const moveCode = text(record.MoveReturnCode)
 const notes = text(record.DPVFootNotes)
 const safeMoveCode = /^(?:A|\d{2})$/.test(moveCode) ? moveCode : ''
 const safeNotes: string[] = /^(?:[A-Z0-9]{2})*$/.test(notes) && notes.length <= 40 ? notes.match(/.{2}/g) ?? [] : []
 const providerCodes = [...codes, ...(safeMoveCode ? [`MOVE:${safeMoveCode}`] : []), ...safeNotes.map(code => `DPV_NOTE:${code}`)]
 const result = (status: SmartMoverAddressResult['status'], reason: SmartMoverAddressResult['reason']): SmartMoverAddressResult => ({ id, status, reason, providerCodes })
 if (codes.some(code => ['CM03', 'CM04', 'AE04', 'AS16', 'AS17'].includes(code)) || ['02', '03'].includes(moveCode) || safeNotes.includes('R7')) return result('undeliverable', 'not_deliverable')
 if (codes.includes('CM02') || moveCode === '01') return result('needs_review', 'foreign_move')
 if (codes.some(code => code.startsWith('AE') || ['AS02', 'AS03', 'AS09', 'AS18', 'CS03', 'CS04', 'CS13'].includes(code) || (code.startsWith('CM') && code !== 'CM01'))) return result('needs_review', 'incomplete_move')
 if (moveCode && !['A', '00'].includes(moveCode)) return result('needs_review', 'incomplete_move')
 if (codes.includes('CS01') && codes.includes('CS02')) return result('needs_review', 'incomplete_move')
 const address = returnedAddress(record)
 if (codes.includes('CS01')) {
  const month = text(record.MoveEffectiveDate)
  if (!address || !codes.includes('AS01') || !/^[1-9]\d{3}(?:0[1-9]|1[0-2])$/.test(month) || moveCode === '00') return result('needs_review', 'incomplete_move')
  return { ...result('moved', 'move_confirmed'), address, moveEffectiveMonth: `${month.slice(0, 4)}-${month.slice(4)}` }
 }
 if (codes.includes('CS02')) {
  if (!address || !codes.includes('AS01') || moveCode === 'A') return result('needs_review', 'address_unconfirmed')
  return { ...result('standardized', 'standardized'), address }
 }
 if (moveCode === '00' && codes.includes('AS01') && address) return result('unchanged', 'no_move_match')
 return result('needs_review', 'address_unconfirmed')
}

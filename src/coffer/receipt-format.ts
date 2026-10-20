import type { Row } from './db'

export const receiptNumber = (letter: Row) => letter.receipt_sequence ? `${letter.receipt_year}-${letter.receipt_sequence}` : ''
export function receiptText(letter: Row): string {
 const number = receiptNumber(letter)
 return [number ? `Receipt ${number}` : '', letter.void_reason ? `VOID — ${letter.void_reason}. This document is retained as a historical copy.` : '', letter.body].filter(Boolean).join('\n\n')
}


import { fail, type Row } from './db'
const MAX = 100_000_000_00
/** Dollars as typed ("250", "1,250.50", "$1250") or exact integer cents from
 * the API (`<name>Cents`). Never a bare number, which would be ambiguous. */
export function amount(input: Row, name: string, label: string, { allowZero = false } = {}): number {
 let result: number
 const exact = input[`${name}Cents`]
 if (exact !== undefined && exact !== '') result = typeof exact === 'string' && /^\d+$/.test(exact) ? Number(exact) : exact
 else {
  const raw = typeof input[name] === 'string' ? input[name].trim().replace(/^\$/, '').replace(/,(?=\d{3}(\D|$))/g, '') : ''
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw)) fail('INPUT', `${label} must be a dollar amount like 250.00.`, 400)
  const [whole, fraction = ''] = raw.split('.')
  result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
 }
 if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < (allowZero ? 0 : 1) || result > MAX) fail('INPUT', `${label} must be ${allowZero ? 'zero or more' : 'more than zero'} and at most $100,000,000.`, 400)
 return result
}
export const usd = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((value ?? 0) / 100)

/** Exact decimal spelling for stored integer cents, including custom fields at
 * the safe-integer boundary. Division through Number can lose the last cent. */
export function centsDecimal(value:string):string {const cents=BigInt(value),absolute=cents<0n?-cents:cents;return `${cents<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`}
export function exactUsd(value:string):string {const cents=BigInt(value),absolute=cents<0n?-cents:cents;return `${cents<0n?'-':''}$${(absolute/100n).toLocaleString('en-US')}.${String(absolute%100n).padStart(2,'0')}`}

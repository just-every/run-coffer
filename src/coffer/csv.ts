// RFC 4180 with CRLF rows. Text that a spreadsheet would run as a formula is
// prefixed with an apostrophe; numbers are written as plain numbers.
const cell = (value: unknown) => {
 if (value === null || value === undefined) return ''
 let text = String(value)
 if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
 return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
export const csv = (header: string[], rows: unknown[][]) => [header, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'

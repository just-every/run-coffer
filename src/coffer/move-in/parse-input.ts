import readWorkbook from 'read-excel-file/universal'
import { inflateSync, unzipSync, zipSync } from 'fflate'
import type { Cell, ExportFile, ParsedImport, Table } from './types'

export const MAX_SOURCE_BYTES = 16 * 1024 * 1024
const MAX_ROWS = 100_000
const MAX_COLUMNS = 256

/** RFC 4180 quoting, escaped quotes, embedded CR/LF, BOM and empty cells. */
export function parseCsv(text: string): Cell[][] {
 const rows: string[][] = []; let row: string[] = [], value = '', quoted = false, closed = false
 text = text.replace(/^\uFEFF/, '')
 const cell = () => { row.push(value); value = ''; closed = false; if (row.length > MAX_COLUMNS) throw new Error('At most 256 columns are supported.') }
 const line = () => { cell(); rows.push(row); row = []; if (rows.length > MAX_ROWS + 1) throw new Error('At most 100,000 rows fit in one move-in. Split the gift export by year and upload constituents.csv again with each year’s file; donors already moved in are matched, not copied.') }
 for (let i = 0; i < text.length; i++) {
  const ch = text[i]
  if (quoted) {
   if (ch === '"') { if (text[i + 1] === '"') { value += '"'; i++ } else { quoted = false; closed = true } }
   else value += ch
  } else if (ch === ',') cell()
  else if (ch === '\r' || ch === '\n') { line(); if (ch === '\r' && text[i + 1] === '\n') i++ }
  else if (ch === '"' && !value && !closed) quoted = true
  else { if (closed || ch === '"') throw new Error(`Invalid CSV quoting at character ${i + 1}.`); value += ch }
 }
 if (quoted) throw new Error('Unclosed quoted CSV field.')
 if (value || row.length || closed) line()
 return rows
}

/** Reject large ZIP expansions, ZIP64, encryption, duplicate entries and invalid offsets before XLSX parsing. */
function checkWorkbookZip(bytes: Uint8Array) {
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
 let end = bytes.length - 22
 while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--
 if (end < Math.max(0, bytes.length - 65557)) throw new Error('Invalid XLSX ZIP directory.')
 const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true)
 if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count > 200 || count === 65535 || offset + size > end) throw new Error('Unsupported or oversized XLSX archive.')
 let cursor = offset, expanded = 0; const names = new Set<string>()
 for (let i = 0; i < count; i++) {
  if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Invalid XLSX entry.')
  const flags = view.getUint16(cursor + 8, true), compressed = view.getUint32(cursor + 20, true), raw = view.getUint32(cursor + 24, true)
  const length = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true), local = view.getUint32(cursor + 42, true)
  const next = cursor + 46 + length + extra + comment
  if (next > offset + size || flags & 1 || compressed === 0xffffffff || raw === 0xffffffff || local + 30 > offset) throw new Error('Unsupported XLSX entry.')
  const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + length))
  if (names.has(name) || /(^|\/)\.\.\//.test(name)) throw new Error('Duplicate or invalid XLSX entry name.')
  names.add(name); expanded += raw
  if (expanded > 64 * 1024 * 1024) throw new Error('This workbook is too large to open safely. Save each sheet as CSV and upload those instead.')
  if (view.getUint32(local, true) !== 0x04034b50 || local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true) + compressed > offset) throw new Error('Invalid XLSX compressed data bounds.')
  const dataOffset = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
  const compression = view.getUint16(cursor + 10, true), compressedData = bytes.subarray(dataOffset, dataOffset + compressed)
  if (![0, 8].includes(compression)) throw new Error('Unsupported XLSX compression method.')
  const unpacked = compression === 0 ? compressedData : inflateSync(compressedData, { out: new Uint8Array(raw + 1) })
  if (unpacked.byteLength !== raw) throw new Error('XLSX declared expansion size does not match its contents.')
  if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) {
   const xml = new TextDecoder().decode(unpacked)
   for (const match of xml.matchAll(/\br="([A-Z]*)([0-9]+)"/g)) {
    const column = [...match[1]].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0)
    if (Number(match[2]) > MAX_ROWS + 1 || column > MAX_COLUMNS) throw new Error('A sheet has more than 100,000 rows or 256 columns. Save it as CSV files split by year.')
   }
  }
  cursor = next
 }
 if (cursor !== offset + size || !names.has('xl/workbook.xml')) throw new Error('File is not an XLSX workbook.')
}

export async function readExports(files: ExportFile[], result: ParsedImport): Promise<Table[]> {
 const tables: Table[] = []; let bytesTotal = 0, rowTotal = 0
 if (!Array.isArray(files) || !files.length || files.length > 20) {
  result.diagnostics.push({ severity: 'error', code: 'FILES', message: 'Supply 1–20 CSV or XLSX exports.' }); return tables
 }
 const names = new Set<string>()
 for (const file of files) {
  try {
   if (!file || typeof file.name !== 'string' || !file.name.trim() || typeof file.base64 !== 'string') throw new Error('Each file needs a name and base64 contents.')
   if (names.has(file.name)) throw new Error('File names must be unique.')
   names.add(file.name)
   if (file.base64.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4 || file.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(file.base64) || /=/.test(file.base64.slice(0, -2))) throw new Error('Invalid or oversized base64 file.')
   const binary = atob(file.base64), bytes = Uint8Array.from(binary, c => c.charCodeAt(0)); bytesTotal += bytes.length
   if (bytesTotal > MAX_SOURCE_BYTES) throw new Error('All files together must be 16 MB or less. Split the gift export by year and upload constituents.csv again with each year’s file; donors already moved in are matched, not copied.')
   let loaded: Table[]
   if (/\.csv$/i.test(file.name)) loaded = [{ file: file.name, sheet: 'CSV', rows: parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }]
   else if (/\.xlsx$/i.test(file.name)) {
    checkWorkbookZip(bytes)
    // STORE entries make the universal reader stay synchronous inside fflate,
    // including large sheets: Cloudflare Workers cannot spawn Web Workers.
    const stored = zipSync(unzipSync(bytes), { level: 0 })
    const sheets = await readWorkbook(stored.buffer as ArrayBuffer)
    loaded = sheets.map(s => ({ file: file.name, sheet: s.sheet, rows: s.data.map(row => row.map(value => {
     if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || (value as unknown) instanceof Date) return value as unknown as Cell
     throw new Error('Unsupported spreadsheet cell type.')
    })) }))
   } else throw new Error('Only UTF-8 CSV and XLSX exports are supported. Convert legacy XLS files to XLSX first.')
   let fileRows = 0
   for (const table of loaded) {
    if (table.rows.some(row => row.length > MAX_COLUMNS)) throw new Error('At most 256 columns are supported.')
    fileRows += Math.max(0, table.rows.length - 1)
   }
   rowTotal += fileRows
   if (rowTotal > MAX_ROWS) throw new Error('At most 100,000 rows fit in one move-in. Split the gift export by year and upload constituents.csv again with each year’s file; donors already moved in are matched, not copied.')
   result.files.push({ name: file.name, bytes: bytes.length, sheets: loaded.map(s => s.sheet), rows: fileRows })
   tables.push(...loaded)
  } catch (error) {
   result.diagnostics.push({ severity: 'error', code: 'FILE_READ', file: file?.name, message: error instanceof Error ? error.message : 'Unable to read export.' })
   result.sourceTotals.complete = false
  }
 }
 return tables
}

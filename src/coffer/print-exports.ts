import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { fail, type Row } from './db'
import { receiptText } from './receipt-format'
import { printFontBytes } from './print-font'
import { download, postalLines, type PrintFormat } from './print-address'
export { mergeDocxResponse, mergePackageResponse } from './print-word'

const LETTER = [612, 792] as const
const ENVELOPE = [684, 297] as const
const FONT_SIZE = 11
const LINE_HEIGHT = 15
const LEFT = 57.6
const RIGHT = 554.4
const BOTTOM = 54

/** Wrap measured glyphs, including unbroken identifiers, without losing text. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
 const result: string[] = []
 for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
  if (!paragraph) { result.push(''); continue }
  let line = ''
  for (const token of paragraph.match(/\S+\s*|\s+/gu) ?? []) {
   if (line && font.widthOfTextAtSize(line + token, size) > width) {
    result.push(line.trimEnd()); line = ''
   }
   for (const character of token) {
    if (line && font.widthOfTextAtSize(line + character, size) > width) {
     result.push(line.trimEnd()); line = ''
    }
    line += character
   }
  }
  result.push(line.trimEnd())
 }
 return result
}

function drawLines(page: PDFPage, lines: string[], font: PDFFont, size: number, x: number, y: number, leading: number): number {
 for (const line of lines) {
  if (line) page.drawText(line, { x, y, size, font })
  y -= leading
 }
 return y
}

function validateFont(letters: Row[], organisation: string, font: PDFFont, format:PrintFormat) {
 const supported = new Set(font.getCharacterSet())
 const text = [organisation, ...letters.flatMap(letter => [...postalLines(letter), ...(format==='letters'?[String(letter.subject ?? ''),receiptText(letter)]:[])])].join('\n')
 const missing = [...new Set([...text].filter(char => !/[\n\r\t]/.test(char) && !supported.has(char.codePointAt(0)!)))]
 if (missing.length) fail('PDF_FONT_UNSUPPORTED', 'The PDF font cannot print every character in this mailing. Use the Word package or browser print to preserve the original text.', 422,
  { characters: missing.map(char => `U+${char.codePointAt(0)!.toString(16).toUpperCase()}`) })
}

function letterPages(pdf: PDFDocument, letters: Row[], organisation: string, font: PDFFont) {
 for (const letter of letters) {
  let page = pdf.addPage([...LETTER])
  const heading = wrap(organisation, font, 12, RIGHT - LEFT)
  if (heading.length > 5) fail('LETTERHEAD_TOO_LONG', 'The organisation name needs more than the letterhead area. Use the Word package or browser print.', 422)
  drawLines(page, heading, font, 12, LEFT, 738, 15)
  // Address starts two inches below the top, within the folded #10 window.
  const address = postalLines(letter).flatMap(line => wrap(line, font, 10, 288))
  const addressEnd = drawLines(page, address, font, 10, LEFT, 648, 13.5)
  let y = Math.min(570, addressEnd - 22)
  const subject = wrap(String(letter.subject ?? ''), font, FONT_SIZE, RIGHT - LEFT)
  const body = wrap(receiptText(letter), font, FONT_SIZE, RIGHT - LEFT)
  const lines = [...subject, '', ...body]
  // The first page keeps the addressee with the start of its own letter.
  if (y < BOTTOM + LINE_HEIGHT * 3) fail('ADDRESS_TOO_LONG', 'This address exceeds the letter window area. Review its postal lines before printing.', 422)
  for (const line of lines) {
   if (y < BOTTOM) {
    page = pdf.addPage([...LETTER])
    drawLines(page, heading, font, 12, LEFT, 738, 15)
    y = Math.min(708, 738 - heading.length * 15 - 12)
   }
   if (line) page.drawText(line, { x: LEFT, y, size: FONT_SIZE, font })
   y -= LINE_HEIGHT
  }
 }
}

function labelPages(pdf: PDFDocument, letters: Row[], font: PDFFont) {
 for (let offset = 0; offset < letters.length; offset += 30) {
  const page = pdf.addPage([...LETTER])
  letters.slice(offset, offset + 30).forEach((letter, index) => {
   // Avery 5160: .1875 side margins, .5 top margin, .125 column gutters.
   const x = 13.5 + (index % 3) * 198 + 7.2
   const top = 756 - Math.floor(index / 3) * 72
   const lines = postalLines(letter).flatMap(line => wrap(line, font, 10, 174.6))
   if (lines.length > 5) fail('LABEL_ADDRESS_OVERFLOW', 'An address needs more than five lines on an Avery 5160 label. Use envelopes or shorten the postal address before printing.', 422, { piece: offset + index + 1 })
   drawLines(page, lines, font, 10, x, top - 16, 11)
  })
 }
}

function envelopePages(pdf: PDFDocument, letters: Row[], organisation: string, font: PDFFont) {
 for (const letter of letters) {
  const page = pdf.addPage([...ENVELOPE])
  const returnName = wrap(organisation, font, 10, 252)
  if (returnName.length > 7) fail('ENVELOPE_RETURN_OVERFLOW', 'The organisation name exceeds the envelope return area.', 422)
  drawLines(page, returnName, font, 10, 36, 261, 13)
  const address = postalLines(letter).flatMap(line => wrap(line, font, 12, 288))
  if (address.length > 8) fail('ENVELOPE_ADDRESS_OVERFLOW', 'This postal address exceeds the #10 envelope address area.', 422)
  drawLines(page, address, font, 12, 270, 171, 15)
 }
}

/** A real downloadable PDF; long letters continue without sharing recipients. */
export async function lettersPdfResponse(letters: Row[], organisation: string, filename = 'letters.pdf', format: PrintFormat = 'letters'): Promise<Response> {
 if (!letters.length) fail('NO_PRINTABLE_LETTERS', 'There are no letters in this selection.', 409)
 const pdf = await PDFDocument.create()
 pdf.registerFontkit(fontkit)
 const font = await pdf.embedFont(printFontBytes(), { subset: true })
 validateFont(letters, organisation, font, format)
 pdf.setTitle(format === 'labels' ? 'Avery 5160 mailing labels' : format === 'envelopes' ? '#10 envelopes' : 'Acknowledgment letters')
 pdf.setAuthor(organisation)
 if (format === 'labels') labelPages(pdf, letters, font)
 else if (format === 'envelopes') envelopePages(pdf, letters, organisation, font)
 else letterPages(pdf, letters, organisation, font)
 return download(await pdf.save(), 'application/pdf', filename)
}

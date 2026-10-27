import { strToU8, zipSync } from 'fflate'
import { fail, type Row } from './db'
import { receiptText } from './receipt-format'
import { download, postalLines } from './print-address'

const WORD_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_R = 'http://schemas.openxmlformats.org/package/2006/relationships'
const FIELDS = ['Organisation', 'RecipientName', 'PostalAddress', 'Subject', 'ReceiptText'] as const
const xml = (value: unknown): string => {
 const text = String(value ?? '')
 if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text)) fail('WORD_TEXT_UNSUPPORTED', 'A letter contains a control character that Word cannot store. Review the original text before exporting.', 422)
 return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textRuns(text: string): string {
 return text.replace(/\r\n?/g, '\n').split('\n').map(line => `<w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join('<w:r><w:br/></w:r>')
}

function paragraph(content: string, properties = ''): string {
 return `<w:p><w:pPr>${properties.includes('<w:spacing') ? '' : '<w:spacing w:after="0" w:line="300" w:lineRule="auto"/>'}${properties}</w:pPr>${content}</w:p>`
}

function record(letter: Row, organisation: string): Record<typeof FIELDS[number], string> {
 const address = postalLines(letter)
 const nameLines = String(letter.recipient_name ?? '').replace(/\r\n?/g, '\n').split('\n').length
 return { Organisation: organisation, RecipientName: String(letter.recipient_name ?? ''), PostalAddress: address.slice(nameLines).join('\n'), Subject: String(letter.subject ?? ''), ReceiptText: receiptText(letter) }
}

const section = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1152" w:bottom="1080" w:left="1152" w:header="360" w:footer="360"/></w:sectPr>'

function documentBytes(body: string, mailMerge = false): Uint8Array {
 const types = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
 const settings = `<w:settings xmlns:w="${W}" xmlns:r="${R}">${mailMerge ? '<w:mailMerge><w:mainDocumentType w:val="formLetters"/><w:dataType w:val="native"/><w:dataSource r:id="recipients"/><w:activeRecord w:val="0"/><w:odso><w:src r:id="recipients"/><w:type w:val="document"/></w:odso></w:mailMerge>' : ''}<w:compat/></w:settings>`
 const files: Record<string, Uint8Array> = {
  '[Content_Types].xml': strToU8(types),
  '_rels/.rels': strToU8(`<Relationships xmlns="${PACKAGE_R}"><Relationship Id="document" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`),
  'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}${section}</w:body></w:document>`),
  'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${PACKAGE_R}"><Relationship Id="settings" Type="${R}/settings" Target="settings.xml"/><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/></Relationships>`),
  'word/settings.xml': strToU8(settings),
  'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`),
 }
 if (mailMerge) files['word/_rels/settings.xml.rels'] = strToU8(`<Relationships xmlns="${PACKAGE_R}"><Relationship Id="recipients" Type="${R}/mailMergeSource" Target="recipients.docx" TargetMode="External"/></Relationships>`)
 return zipSync(files, { level: 6 })
}

function letterBody(values: Record<typeof FIELDS[number], string>, merged: boolean): string {
 const field = (key: typeof FIELDS[number]) => merged
  ? `<w:fldSimple w:instr=" MERGEFIELD ${key} ">${textRuns(values[key])}</w:fldSimple>`
  : textRuns(values[key])
 return paragraph(field('Organisation'), '<w:keepNext/><w:spacing w:after="1440"/>')
  + paragraph(field('RecipientName'), '<w:keepNext/>')
  + paragraph(field('PostalAddress'), '<w:keepNext/><w:spacing w:after="360"/>')
  + paragraph(field('Subject'), '<w:keepNext/><w:spacing w:after="240"/>')
  + paragraph(field('ReceiptText'))
}

function template(letters: Row[], organisation: string): Uint8Array {
 if (!letters.length) fail('NO_PRINTABLE_LETTERS', 'There are no letters in this selection.', 409)
 return documentBytes(letterBody(record(letters[0], organisation), true), true)
}

/** Native OOXML main document with real MERGEFIELDs and a Word data-source link. */
export function mergeDocxResponse(letters: Row[], organisation: string, filename = 'letter-template.docx'): Response {
 return download(template(letters, organisation), WORD_TYPE, filename)
}

/** Keep the linked Word table next to the template after extracting the package. */
export function mergePackageResponse(letters: Row[], organisation: string, filename = 'word-merge.zip'): Response {
 const main = template(letters, organisation)
 const values = letters.map(letter => record(letter, organisation))
 const row = (cells: string[], header = false) => `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.map(cell => `<w:tc><w:tcPr><w:tcW w:w="1900" w:type="dxa"/></w:tcPr>${paragraph(textRuns(cell))}</w:tc>`).join('')}</w:tr>`
 const data = documentBytes(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${FIELDS.map(() => '<w:gridCol w:w="1900"/>').join('')}</w:tblGrid>${row([...FIELDS], true)}${values.map(value => row(FIELDS.map(key => value[key]))).join('')}</w:tbl>`)
 const frozen = documentBytes(values.map((value, index) => (index ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '') + letterBody(value, false)).join(''))
 const instructions = `Word mail merge\n\nExtract every file into the same folder before opening letter-template.docx.\n\nThe template contains native Word merge fields and links to recipients.docx. Allow Word to use that source when prompted. If Word asks you to locate the source, choose Mailings > Select Recipients > Use an Existing List, then select recipients.docx in this folder. The first table row contains the field names. Choose Finish & Merge > Edit Individual Documents to create the letters.\n\nrecipients.docx has ${letters.length} frozen mailing records. Each row is one piece using the addressee, address, subject and complete receipt text from this approved selection. Keep the files private.\n\nfrozen-letters.docx contains the same letters already merged, with each piece starting on a new page and long letters continuing naturally. The PDF download provides fixed US Letter and window-address geometry.\n`
 return download(zipSync({ 'letter-template.docx': main, 'recipients.docx': data, 'frozen-letters.docx': frozen, 'README.txt': strToU8(instructions) }, { level: 6 }), 'application/zip', filename)
}

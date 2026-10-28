import { strToU8, zipSync } from 'fflate'
const xml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'')
const column=(n:number):string=>n>=26?column(Math.floor(n/26)-1)+String.fromCharCode(65+n%26):String.fromCharCode(65+n)
/** Text is always inline text, never an Excel formula. Money stays numeric cents. */
export function workbook(headers:string[],rows:unknown[][]) {
 const sheet=[headers,...rows].map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>typeof v==='number'?`<c r="${column(j)}${i+1}"><v>${v}</v></c>`:`<c r="${column(j)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${xml(typeof v==='object'&&v!==null?JSON.stringify(v):v)}</t></is></c>`).join('')}</row>`).join('')
 const files:Record<string,string>={
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report records" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`
 }
 return zipSync(Object.fromEntries(Object.entries(files).map(([name,body])=>[name,strToU8(body)])))
}

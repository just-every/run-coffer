import assert from 'node:assert/strict'
import {unzipSync,strFromU8} from 'fflate'
import {readPrintPdf} from './print-formats-journey.mjs'

/** Exact known addressee sets must agree in every public output format. */
export async function groupedPrintExports(h,batchId,names){
 const expected=[...names].sort(),known=new Set(expected)
 for(const query of ['', '?labels=1','?envelopes=1']){
  const response=await h.request('/app/letters/'+batchId+'/letters.pdf'+query)
  assert.equal(response.status,200)
  const {pages}=await readPrintPdf(new Uint8Array(await response.arrayBuffer()))
  const actual=pages.flatMap(p=>p.text.filter(t=>known.has(t.text)).map(t=>t.text)).sort()
  assert.deepEqual(actual,expected,'PDF output retains exactly the selected postal pieces: '+query)
  if(query==='?envelopes=1')assert.equal(pages.length,names.length)
 }
 const response=await h.request('/app/letters/'+batchId+'/merge.zip');assert.equal(response.status,200)
 const files=unzipSync(new Uint8Array(await response.arrayBuffer()))
 const xml=strFromU8(unzipSync(files['recipients.docx'])['word/document.xml'])
 const rows=[...xml.matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)].map(row=>[...row[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map(cell=>[...cell[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(text=>text[1]).join('')))
 const column=rows[0].indexOf('RecipientName');assert.ok(column>=0)
 assert.deepEqual(rows.slice(1).map(row=>row[column]).sort(),expected,'Word merge data retains the same exact postal pieces')
}

import {donor} from './harness.mjs'
import {readFileSync} from 'node:fs'

export function agreement(){
 const stream='BT /F1 16 Tf 50 740 Td (Pledge agreement) Tj 0 -30 Td (Riverbend literacy project - signed by Avery Chen) Tj ET'
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
 let output='%PDF-1.4\n';const offsets=[0]
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${o}\nendobj\n`})
 const xref=Buffer.byteLength(output)
 output+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 return Buffer.from(output)
}

export function documentFormats(){
 return [
  {extension:'pdf',mediaType:'application/pdf',bytes:agreement()},
  {extension:'png',mediaType:'image/png',bytes:readFileSync(new URL('./fixtures/campaign-page/story.png',import.meta.url))},
  {extension:'txt',mediaType:'text/plain',bytes:Buffer.from('Riverbend Literacy Project\nSigned pledge: $1,000 for the reading room.\nAvery Chen — reviewed agreement.\n')},
 ]
}
export async function documentRecords(h,name){
 const constituent=await donor(h,name),owner=(await h.get('/auth/session')).operator
 const gift=await h.command('gift.record',{donorId:constituent.id,amount:'250',receivedOn:'2026-01-05',method:'check',fund:'Library',goods:'none'})
 const pledge=await h.command('pledge.create',{donorId:constituent.id,amount:'1000',pledgedOn:'2026-01-01',fund:'Library',installments:[{dueOn:'2026-12-31',amount:'1000'}]})
 const opportunity=await h.command('prospect.save',{donorId:constituent.id,ownerId:owner.id,label:'Reading room pledge',stage:'identify',askAmount:'1000',expectedCloseOn:'2026-12-31',nextStep:'Review signed pledge'})
 return {constituent,targets:[['donor',constituent.id],['gift',gift.id],['pledge',pledge.id],['opportunity',opportunity.id]]}
}
export const documentInput=(donorId,kind,recordId,format,title)=>({donorId,recordRef:`${kind}:${recordId}`,title,fileName:`agreement.${format.extension}`,mediaType:format.mediaType,contentBase64:format.bytes.toString('base64')})

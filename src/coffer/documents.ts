import { requireRole } from './auth'
import { all, commit, event, fail, guard, id, newId, one, sql, text, type Context, type Row } from './db'

const staff=(c:Context)=>requireRole(c.actor,['owner','admin','member'],'use record documents')
const live=`d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`
const definitions={donor:{table:'cf_donors',column:'id'},gift:{table:'cf_gifts',column:'donor_id'},pledge:{table:'cf_pledges',column:'donor_id'},opportunity:{table:'cf_prospects',column:'donor_id'}} as const
export async function documentState(c:Context,donorId:string) {
 staff(c)
 const donor=await one(c,`SELECT d.id,d.name FROM cf_donors d WHERE d.id=? AND ${live}`,donorId)
 if(!donor)fail('NOT_FOUND','Choose a current constituent record.',404)
 const [documents,gifts,pledges,prospects]=await Promise.all([
  all(c,`SELECT *,CASE WHEN gift_id IS NOT NULL THEN 'gift' WHEN pledge_id IS NOT NULL THEN 'pledge' WHEN prospect_id IS NOT NULL THEN 'opportunity' ELSE 'donor' END AS record_kind,COALESCE(gift_id,pledge_id,prospect_id,donor_id) AS record_id FROM cf_record_documents WHERE donor_id=? ORDER BY created_at,id`,donorId),
  all(c,'SELECT id,received_on,amount_cents FROM cf_gifts WHERE donor_id=? ORDER BY received_on DESC,id',donorId),
  all(c,'SELECT id,due_by,fund FROM cf_pledges WHERE donor_id=? ORDER BY due_by,id',donorId),
  all(c,'SELECT id,label FROM cf_prospects WHERE donor_id=? ORDER BY label,id',donorId),
 ])
 return {documents,targets:[{value:`donor:${donor.id}`,label:`Constituent · ${donor.name}`},...gifts.map(g=>({value:`gift:${g.id}`,label:`Gift · ${g.received_on} · $${(g.amount_cents/100).toFixed(2)}`})),...pledges.map(p=>({value:`pledge:${p.id}`,label:`Pledge · ${p.fund} · due ${p.due_by}`})),...prospects.map(p=>({value:`opportunity:${p.id}`,label:`Opportunity · ${p.label}`}))]}
}
export async function attachDocument(c:Context,p:Row) {
 staff(c)
 const donorId=id(p.donorId,'Constituent'),[kind,target,...rest]=String(p.recordRef??'').split(':')
 if(rest.length || !Object.hasOwn(definitions,kind))fail('INPUT','Choose the constituent, gift, pledge or opportunity for this file.',400)
 const ref=id(target,'Record'),definition=definitions[kind as keyof typeof definitions]
 const condition=`EXISTS(SELECT 1 FROM ${definition.table} r JOIN cf_donors d ON d.id=r.${definition.column} WHERE r.id=? AND d.id=? AND ${live})`
 if(!await one(c,`SELECT 1 WHERE ${condition}`,ref,donorId))fail('RECORD_CHANGED','That record is not on this current constituent.',409)
 const title=text(p.title,'Document title',200),fileName=text(p.fileName,'File name',150),mediaType=String(p.mediaType??'')
 if(/[\r\n\\/\x00-\x1f]/.test(fileName)||!['application/pdf','text/plain','image/png','image/jpeg'].includes(mediaType))fail('INPUT','Choose a PDF, text file, PNG or JPEG with a simple file name.',400)
 let bytes:Uint8Array
 try{bytes=Uint8Array.from(atob(String(p.contentBase64)),ch=>ch.charCodeAt(0))}catch{return fail('INPUT','The file encoding is invalid.',400)}
 if(!bytes.length||bytes.length>256000)fail('INPUT','Attach a nonempty file up to 256,000 bytes.',400)
 const starts=(values:number[])=>values.every((n,i)=>bytes[i]===n)
 if(mediaType==='application/pdf'&&!starts([37,80,68,70,45])||mediaType==='image/png'&&!starts([137,80,78,71,13,10,26,10])||mediaType==='image/jpeg'&&!starts([255,216,255]))fail('INPUT','The file does not match its selected type.',400)
 const bucket=c.env?.FILES;if(!bucket)fail('STORAGE','This installation has no file bucket.',503)
 const documentId=newId(),key=`record-documents/${documentId}`
 await commit(c,[guard(condition,'RECORD_CHANGED','That record changed before upload.',ref,donorId),sql('INSERT INTO cf_document_uploads(object_key,started_at) VALUES(?,?)',key,c.now)])
 try {
  await bucket.put(key,bytes,{httpMetadata:{contentType:mediaType}})
  await commit(c,[guard(condition,'RECORD_CHANGED','That record changed before attaching the file.',ref,donorId),guard('EXISTS(SELECT 1 FROM cf_document_uploads WHERE object_key=? AND discarded_at IS NULL)','UPLOAD_EXPIRED','That upload expired. Attach the file again.',key),
   sql('INSERT INTO cf_record_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',documentId,donorId,kind==='gift'?ref:null,kind==='pledge'?ref:null,kind==='opportunity'?ref:null,title,fileName,mediaType,key,bytes.length,c.now,c.actor.id),
   sql('DELETE FROM cf_document_uploads WHERE object_key=?',key),event(c,'document.attach',kind,ref,donorId,{documentId,bytes:bytes.length})])
 }catch(error){await bucket.delete(key);await c.db.prepare('DELETE FROM cf_document_uploads WHERE object_key=?').bind(key).run();throw error}
 return {id:documentId,donorId}
}
export async function documentDownload(c:Context,documentId:string,preview=false) {
 staff(c)
 const d=await one(c,`SELECT f.* FROM cf_record_documents f JOIN cf_donors d ON d.id=f.donor_id WHERE f.id=? AND ${live}`,id(documentId,'Document'))
 if(!d)fail('NOT_FOUND','That document is unavailable.',404)
 const object=await c.env!.FILES.get(d.object_key)
 if(!object)fail('DOCUMENT_MISSING','This document’s stored file is missing. Restore it from a complete backup.',409)
 const contentType=d.media_type==='text/plain'?'text/plain; charset=utf-8':d.media_type
 return new Response(object.body,{headers:{'content-type':contentType,'content-disposition':`${preview?'inline':'attachment'}; filename="${d.file_name.replace(/["\x00-\x1f\x7f-\uffff]/g,'_')}"`,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'",'referrer-policy':'no-referrer'}})
}
/** Durable erasure cleanup; repeatable after an interrupted object-store call. */
export async function purgeDocuments(c:Context) {
 for(;;){
 const rows=await all(c,'SELECT object_key FROM cf_document_purges ORDER BY object_key LIMIT 100')
 if(!rows.length)return
 await c.env!.FILES.delete(rows.map(r=>r.object_key))
 await c.db.batch(rows.map(r=>c.db.prepare('DELETE FROM cf_document_purges WHERE object_key=?').bind(r.object_key)))
 }
}
export async function cleanDocumentUploads(c:Context){
 const cutoff=new Date(Date.parse(c.now)-3600000).toISOString()
 const rows=await all(c,'SELECT object_key FROM cf_document_uploads WHERE started_at<? ORDER BY started_at LIMIT 100',cutoff)
 for(const row of rows){
  const claim=await c.db.prepare('UPDATE cf_document_uploads SET discarded_at=COALESCE(discarded_at,?) WHERE object_key=? AND NOT EXISTS(SELECT 1 FROM cf_record_documents WHERE object_key=?)').bind(c.now,row.object_key,row.object_key).run()
  if(!claim.meta.changes)continue
  await c.env!.FILES.delete(row.object_key)
  await c.db.prepare('DELETE FROM cf_document_uploads WHERE object_key=? AND discarded_at IS NOT NULL').bind(row.object_key).run()
 }
}

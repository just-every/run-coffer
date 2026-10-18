// Transport staging is excluded by Base's rer_portability_% archive policy.
// It holds authenticated, possibly out-of-order parts until the native importer
// can advance its ordered row cursor. Product data is published only by finalize.
import { canonicalJson, sha256 } from '@runeditrun/rer/modules/portability';
import { checkPart, MAX_LINE_BYTES } from '@runeditrun/rer/modules/portability/format';
import { all, statement, job, insist, transferTables, quote } from '@runeditrun/rer/modules/portability/storage';
import { base64, unbase64 } from '@runeditrun/rer/internal/modules/portability/hash.mjs';

export const FRAGMENT_BYTES = 256 * 1024;
const SEGMENT_BYTES = 24 * 1024;
const encoder = new TextEncoder();
export async function initializeUploads(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS rer_portability_uploads(job TEXT NOT NULL,idx INTEGER NOT NULL,sha256 TEXT NOT NULL,total INTEGER NOT NULL,ready INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(job,idx))'),
    db.prepare('CREATE TABLE IF NOT EXISTS rer_portability_upload_chunks(job TEXT NOT NULL,idx INTEGER NOT NULL,offset INTEGER NOT NULL,size INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(job,idx,offset))'),
  ]);
}
const upload = (db,id,index) => statement(db,'SELECT * FROM rer_portability_uploads WHERE job=? AND idx=?',id,index).first();
const chunks = (db,id,index) => all(db,'SELECT offset,size,data FROM rer_portability_upload_chunks WHERE job=? AND idx=? ORDER BY offset',id,index);
async function assembled(db,id,index,total) {
  const stored=await chunks(db,id,index),bytes=new Uint8Array(total);let offset=0;
  for(const chunk of stored) {
    insist(chunk.offset===offset,'fragment_gap',409);
    const value=unbase64(chunk.data);insist(value.length===chunk.size && offset+value.length<=total,'fragment_size',409);
    bytes.set(value,offset);offset+=value.length;
  }
  if(offset!==total)return null;
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{insist(false,'invalid_json');}
}
async function writeChunks(db,id,index,offset,bytes) {
  const queries=[];
  for(let start=0;start<bytes.length;start+=SEGMENT_BYTES) {
    const value=bytes.subarray(start,start+SEGMENT_BYTES),position=offset+start,data=base64(value);
    const overlaps=await all(db,'SELECT offset,size,data FROM rer_portability_upload_chunks WHERE job=? AND idx=? AND offset<? AND offset+size>?',id,index,position+value.length,position);
    insist(overlaps.every(x=>x.offset===position && x.size===value.length && x.data===data),'fragment_conflict',409);
    queries.push(statement(db,'INSERT OR IGNORE INTO rer_portability_upload_chunks VALUES(?,?,?,?,?)',id,index,position,value.length,data));
  }
  // Bound each SQL call independently from the original archive part size.
  for(let start=0;start<queries.length;start+=8)await db.batch(queries.slice(start,start+8));
  // Check lost-ACK/concurrent writes against the bytes, never just row counts.
  for(let start=0;start<bytes.length;start+=SEGMENT_BYTES) {
    const stored=await statement(db,'SELECT data FROM rer_portability_upload_chunks WHERE job=? AND idx=? AND offset=?',id,index,offset+start).first();
    insist(stored?.data===base64(bytes.subarray(start,start+SEGMENT_BYTES)),'fragment_conflict',409);
  }
}
export async function receivePart(db,service,id,index,input,partBytes) {
  const row=await job(db,id,'import');
  insist(Number.isSafeInteger(index) && index>=0 && index<row.metadata.manifest.partCount,'part_order',409);
  const fragment=input?.kind==='fragment';
  let part,bytes,offset=0,total,hash;
  if(fragment) {
    ({offset,total,sha256:hash}=input);
    insist(Number.isSafeInteger(offset) && offset>=0 && Number.isSafeInteger(total) && total>0 && total<=MAX_LINE_BYTES && typeof hash==='string' && /^[a-f0-9]{64}$/.test(hash) && typeof input.data==='string','fragment_shape');
    insist(input.data.length<=Math.ceil(FRAGMENT_BYTES/3)*4,'fragment_byte_limit',413);
    bytes=unbase64(input.data);
    insist(bytes.length>0 && bytes.length<=FRAGMENT_BYTES && offset+bytes.length<=total,'fragment_size');
  } else {
    await checkPart(input,index,partBytes);part=input;hash=part.sha256;
    bytes=encoder.encode(canonicalJson(part));total=bytes.length;
  }
  const native=await statement(db,'SELECT sha256 FROM rer_portability_parts WHERE job=? AND idx=?',id,index).first();
  if(native){insist(native.sha256===hash,'part_conflict',409);if(!fragment)return importStatus(db,service,id);}
  insist(row.phase==='staging' || native,'import_phase',409);
  let previous=await upload(db,id,index);
  if(previous)insist(previous.sha256===hash,'part_conflict',409);
  if(previous?.ready){
    if(fragment){insist(previous.total===total,'part_conflict',409);await writeChunks(db,id,index,offset,bytes);}
    return importStatus(db,service,id);
  }
  if(!fragment && index===row.completed) {
    await service.imports.uploadPart(id,index,part);
    return importStatus(db,service,id);
  }
  // A full authenticated part supersedes incomplete transport bytes for that
  // same digest, even if its JSON whitespace differs from earlier fragments.
  if(!fragment && previous) {
    await db.batch([statement(db,'DELETE FROM rer_portability_upload_chunks WHERE job=? AND idx=?',id,index),statement(db,'UPDATE rer_portability_uploads SET total=? WHERE job=? AND idx=?',total,id,index)]);
  } else {
    await statement(db,'INSERT OR IGNORE INTO rer_portability_uploads(job,idx,sha256,total) VALUES(?,?,?,?)',id,index,hash,total).run();
    previous=await upload(db,id,index);insist(previous.sha256===hash && previous.total===total,'part_conflict',409);
  }
  await writeChunks(db,id,index,offset,bytes);
  if(fragment) {
    const stored=await chunks(db,id,index);let end=0;
    for(const chunk of stored){if(chunk.offset!==end)return importStatus(db,service,id);end+=chunk.size;}
    if(end!==total)return importStatus(db,service,id);
    part=await assembled(db,id,index,total);await checkPart(part,index,partBytes);
    insist(part.sha256===hash,'part_checksum');
  }
  await statement(db,'UPDATE rer_portability_uploads SET ready=1 WHERE job=? AND idx=? AND sha256=?',id,index,hash).run();
  await drainUploads(db,service,id,1);
  return importStatus(db,service,id);
}
export async function drainUploads(db,service,id,limit=Infinity) {
  for(let count=0;count<limit;count++) {
    const state=await service.imports.status(id);
    if(state.phase!=='staging' || state.completed===state.total)return;
    const stored=await upload(db,id,state.completed);if(!stored?.ready)return;
    const part=await assembled(db,id,state.completed,stored.total);insist(part && part.sha256===stored.sha256,'part_checksum');
    await service.imports.uploadPart(id,state.completed,part);
  }
}
export async function importStatus(db,service,id) {
  const [status,row,received]=await Promise.all([
    service.imports.status(id),job(db,id,'import'),
    all(db,'SELECT idx FROM rer_portability_parts WHERE job=? UNION SELECT idx FROM rer_portability_uploads WHERE job=? AND ready=1 ORDER BY idx',id,id),
  ]);
  return {...status,received:received.map(x=>x.idx),manifestHash:await sha256(canonicalJson(row.metadata.manifest)),fragmentBytes:FRAGMENT_BYTES};
}
export async function cleanUploads(db,id,{copies=false}={}) {
  if(copies) {
    const row=await job(db,id,'import');
    await db.batch([...transferTables(row).map(name=>db.prepare(`DROP TABLE IF EXISTS ${quote(name)}`)),statement(db,'DELETE FROM rer_portability_segments WHERE job=?',id)]);
  }
  await db.batch([statement(db,'DELETE FROM rer_portability_upload_chunks WHERE job=?',id),statement(db,'DELETE FROM rer_portability_uploads WHERE job=?',id)]);
}

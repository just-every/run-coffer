import {test} from 'node:test'
import assert from 'node:assert/strict'
import {installation,archive,donor} from './harness.mjs'
import {makePart,canonicalJson,sha256} from '@runeditrun/rer/modules/portability'
import {ArchiveVerifier} from '@runeditrun/rer/modules/portability/format'

// Exercise the deployed HTTP ownership chain, using real D1 staging. The only
// direct SQL below injects a storage corruption, then restores the exact bytes.
test('hosted restore preserves gaps, authenticates fragments and retries, and verifies durable bytes before publication',async()=>{
 const source=await installation();let lines
 try{for(const name of ['Ada 🌱','Bea','Cora'])await donor(source,name);lines=await archive(source)}finally{await source.close()}
 const items=lines.filter(x=>x.kind==='part').flatMap(x=>x.items)
 assert.ok(items.length>=3)
 const parts=await Promise.all(Array.from({length:3},(_,i)=>makePart(i,items.slice(Math.floor(i*items.length/3),Math.floor((i+1)*items.length/3)))))
 const manifest={...lines[0],partCount:parts.length},verifier=new ArchiveVerifier(manifest)
 for(const part of parts)verifier.add(part)
 const closing={archiveHash:verifier.digest(),contentHash:lines.at(-1).contentHash}
 const target=await installation()
 try {
  const refused=await target.request('/api/portability/imports/missing/parts/0',{method:'PUT',as:'',raw:'x'.repeat(100_000)})
  assert.equal(refused.status,401,'large refused request keeps the authentication status')
  const {id}=await target.api('/api/portability/imports',{confirmed:true,manifest},{status:201})
  const path=`/api/portability/imports/${id}`,put=(index,body,options={})=>target.api(`${path}/parts/${index}`,body,{method:'PUT',...options})
  const gap=await put(2,parts[2]);assert.deepEqual(gap.received,[2]);assert.equal(gap.completed,0)
  assert.equal(gap.manifestHash,await sha256(canonicalJson(manifest)))
  assert.deepEqual((await target.get(path)).received,[2])
  await put(2,parts[2])
  const changed=await makePart(2,[...parts[2].items,parts[2].items[0]])
  const conflict=await put(2,changed,{status:409});assert.equal(conflict.error,'part_conflict');assert.match(conflict.message,/different part/i)
  await put(0,parts[0]);assert.deepEqual((await target.get(path)).received,[0,2])
  const bytes=Buffer.from(JSON.stringify(parts[1])),split=Math.floor(bytes.length/2)
  const fragment=(offset,end)=>({kind:'fragment',offset,total:bytes.length,sha256:parts[1].sha256,data:bytes.subarray(offset,end).toString('base64')})
  const latter=fragment(split,bytes.length)
  await put(1,latter);await put(1,latter)
  assert.deepEqual((await target.get(path)).received,[0,2],'incomplete fragments are not received parts')
  const changedBytes={...latter,data:Buffer.from(bytes.subarray(split)).fill(120).toString('base64')}
  assert.equal((await put(1,changedBytes,{status:409})).error,'fragment_conflict')
  await put(1,fragment(0,split));assert.deepEqual((await target.get(path)).received,[0,1,2])
  await put(0,parts[0])
  // A valid changed same-index part is refused after the native cursor advanced.
  assert.equal((await put(0,await makePart(0,[...parts[0].items,parts[0].items[0]]),{status:409})).error,'part_conflict')
  const db=await target.mf.getD1Database('DB')
  const stored=await db.prepare('SELECT data FROM rer_portability_segments WHERE job=? AND part=0 AND segment=0').bind(id).first()
  const corrupt=JSON.parse(stored.data);corrupt.sha256='0'.repeat(64)
  await db.prepare('UPDATE rer_portability_segments SET data=? WHERE job=? AND part=0 AND segment=0').bind(JSON.stringify(corrupt),id).run()
  assert.equal((await target.api(`${path}/finalize`,closing,{status:400})).error,'part_checksum')
  assert.equal((await target.get('/api/coffer/donors')).total,0,'invalid durable bytes never publish product rows')
  await db.prepare('UPDATE rer_portability_segments SET data=? WHERE job=? AND part=0 AND segment=0').bind(stored.data,id).run()
  assert.equal((await target.api(`${path}/finalize`,closing)).phase,'complete')
  assert.equal((await target.api(`${path}/finalize`,closing)).phase,'complete','lost final acknowledgement is safe to repeat')
  assert.equal((await target.get('/api/coffer/donors')).total,3)
  assert.deepEqual((await target.get(path)).received,[0,1,2])
  const staging=await db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'rer_portability_stage_*'").all()
  assert.equal(staging.results.length,0,'successful finalize releases staging tables')
 }finally{await target.close()}
})

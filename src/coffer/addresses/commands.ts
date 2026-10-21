import { requireRole } from '../auth'
import { all, commit, event, fail, guard, integer, newId, one, sql, text, type Context, type Row } from '../db'
import { verifyExistingAddress } from './entry'
import { addressFingerprint, addressProcessing } from './state'

export async function ncoaCandidates(c:Context) {
 const rows=await all(c,`SELECT * FROM cf_donors d WHERE erased_at IS NULL AND constituent_status='active' AND address_line1 IS NOT NULL AND city IS NOT NULL AND region IS NOT NULL AND postal_code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) AND upper(country) IN('US','USA','UNITED STATES','UNITED STATES OF AMERICA') ORDER BY id`)
 const groups=new Map<string,number>(),members=[]
 for(const d of rows){
  const fingerprint=await addressFingerprint(d),key=await addressFingerprint({...d,name:d.name.trim().toUpperCase(),...Object.fromEntries(Object.entries(d).filter(([k])=>['address_line1','address_line2','city','region','postal_code','country'].includes(k)).map(([k,v])=>[k,typeof v==='string'?v.trim().toUpperCase():v])),country:'US'})
  if(!groups.has(key))groups.set(key,groups.size)
  members.push({donorId:d.id,fingerprint,ordinal:groups.get(key)!})
 }
 return {members,total:groups.size}
}
export async function queueNcoa(c:Context) {
 const connection=await addressProcessing(c)
 if(!connection.enabled||!connection.paf_reference)fail('NCOA_NOT_CONNECTED','An owner must enable Smarty and the licensed NCOA account with its current signed PAF first.')
 const active=await one(c,"SELECT id,state FROM cf_ncoa_runs WHERE state IN('queued','processing') ORDER BY created_at DESC LIMIT 1")
 if(active)return {...active,queued:false}
 const {members,total}=await ncoaCandidates(c)
 if(total<100)fail('NCOA_LIST_TOO_SMALL','The NCOA licensee requires at least 100 genuine unique names and addresses. No records were submitted or fabricated.',409,{uniqueNamesAndAddresses:total})
 const runId=newId()
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_address_processing WHERE id=1 AND version=? AND enabled=1)','ADDRESS_CONNECTION_CHANGED','Address processing changed; prepare the pass again.',connection.version),guard("NOT EXISTS(SELECT 1 FROM cf_ncoa_runs WHERE state IN('queued','processing'))",'NCOA_ALREADY_QUEUED','Another pass was queued. Refresh.'),
 sql("INSERT INTO cf_ncoa_runs(id,state,total,processed,created_at,actor_id,actor_name,connection_version) VALUES(?,'queued',?,0,?,?,?,?)",runId,total,c.now,c.actor.id,c.actor.name,connection.version),
 sql("INSERT INTO cf_ncoa_members(run_id,donor_id,fingerprint,ordinal) SELECT ?,json_extract(value,'$.donorId'),json_extract(value,'$.fingerprint'),json_extract(value,'$.ordinal') FROM json_each(?)",runId,JSON.stringify(members)),event(c,'address.queueNcoa','ncoa_run',runId,null,{uniqueNamesAndAddresses:total})])
 return {id:runId,state:'queued',queued:true,total}
}
export async function addressCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(!['address.processing','address.verify','address.queueNcoa'].includes(command))return undefined
 if(command==='address.verify')return verifyExistingAddress(c,p)
 requireRole(c.actor,['owner','admin'],'manage address processing')
 if(command==='address.queueNcoa')return queueNcoa(c)
 const version=integer(Number(p.version),'Version',0),enabled=p.enabled===true||p.enabled==='yes'
 const reference=enabled?text(p.pafReference,'Signed current PAF reference',200):null
 if(enabled&&p.reviewed!=='yes')fail('INPUT','Confirm that this account has a current signed Processing Acknowledgement Form and authorize processing these constituents.',400)
 if(enabled&&(!c.env?.SMARTY_AUTH_ID||!c.env.SMARTY_AUTH_TOKEN||!c.env.MELISSA_SMARTMOVER_KEY))fail('ADDRESS_CREDENTIALS','Configure the private Smarty and Melissa SmartMover credentials before enabling address processing.',409)
 const current=await addressProcessing(c)
 if(current.version!==version)fail('VERSION','Address processing changed. Refresh.')
 await commit(c,[guard('COALESCE((SELECT version FROM cf_address_processing WHERE id=1),0)=?','VERSION','Address processing changed. Refresh.',version),
 sql('INSERT INTO cf_address_processing VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,enabled=excluded.enabled,paf_reference=excluded.paf_reference,reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by',version+1,enabled?1:0,reference,c.now,c.actor.id),
 sql("UPDATE cf_ncoa_runs SET state='cancelled',reason='Address processing configuration changed.' WHERE state IN('queued','processing')"),event(c,command,'address_processing','1',null,{enabled,version:version+1})])
 return {version:version+1,enabled}
}

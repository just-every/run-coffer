import { requireRole } from '../auth'
import { all, choice, commit, date, event, fail, guard, id, newId, one, optional, sha256, sql, text, type Context, type Row, type Stmt } from '../db'
import { likelyDuplicates } from '../duplicates'
import { donorCommand } from '../donors'
import { householdCommand } from '../households'
import { mergeDonor } from '../donor-merge'
import { personNames } from '../person-names'
import { withNameDefaults } from '../person-defaults'

const live = `d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`
export async function hygieneState(c:Context) {
 requireRole(c.actor,['owner','admin'],'review database hygiene')
 const [donors,proposals,evidence]=await Promise.all([
  all(c,`SELECT d.id,d.name FROM cf_donors d WHERE ${live} ORDER BY d.name`),
  all(c,`SELECT p.*,d.name AS donor_name,r.name AS related_name FROM cf_hygiene_proposals p JOIN cf_donors d ON d.id=p.donor_id LEFT JOIN cf_donors r ON r.id=p.related_donor_id WHERE d.erased_at IS NULL ORDER BY p.created_at DESC,p.id`),
  all(c,`SELECT e.*,d.name AS donor_name FROM cf_hygiene_evidence e JOIN cf_donors d ON d.id=e.donor_id WHERE ${live} ORDER BY e.recorded_at DESC,e.id`)
 ])
 return {donors,proposals:proposals.map(p=>({...p,input:JSON.parse(p.input_json)})),evidence:evidence.map(p=>({...p,correction:JSON.parse(p.correction)}))}
}

export async function recordHygieneEvidence(c:Context,p:Row) {
 requireRole(c.actor,['owner','admin'],'record forwarded hygiene evidence')
 const key=newId(),donorId=id(p.donorId,'Donor'),source=choice(p.source,['returned_mail','ncoa','family_note','obituary'] as const,'evidence source'),evidence=text(p.evidence,'Evidence',2000)
 const donor=await one(c,`SELECT d.* FROM cf_donors d WHERE d.id=? AND ${live}`,donorId)
 if(!donor)fail('NOT_FOUND','Choose a current donor.',404)
 const kind=choice(p.kind,['address','status'] as const,'proposed correction'),correction:Row={kind}
 if(kind==='address') {
  if(!['ncoa','returned_mail'].includes(source))fail('INPUT','Address corrections need an NCOA result or returned-mail evidence.',400)
  for(const key of ['addressLine1','city','region','postalCode'])correction[key]=text(p[key],key,key==='postalCode'?20:200)
  correction.addressLine2=optional(p.addressLine2,'Address line 2');correction.country=text(p.country??'United States','Country',100)
  correction.addressEffectiveOn=date(p.addressEffectiveOn,'Address effective date')
 }else {
  if(source==='ncoa')fail('INPUT','An address result cannot establish constituent status.',400)
  correction.constituentStatus=choice(p.constituentStatus,['inactive','deceased'] as const,'proposed status')
  if(correction.constituentStatus==='deceased') {
   if(source==='returned_mail')fail('INPUT','Returned mail alone cannot establish a death. Record the forwarded family or obituary notice.',400)
   correction.deceasedOn=date(p.deceasedOn,'Date of death')
  }
  correction.statusReason='Accepted hygiene evidence '+key
 }
 await commit(c,[guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.version=? AND ${live})`,'DONOR_CHANGED','This donor changed. Refresh.',donorId,donor.version),
  sql("UPDATE cf_hygiene_proposals SET status='stale' WHERE donor_id=? AND kind=? AND status='pending'",donorId,kind),
  sql('INSERT INTO cf_hygiene_evidence VALUES(?,?,?,?,?,?,?)',key,donorId,source,evidence,JSON.stringify(correction),c.now,c.actor.id),event(c,'hygiene.evidence','hygiene_evidence',key,donorId,{source,kind})])
 return {id:key}
}

export async function runHygiene(c:Context) {
 requireRole(c.actor,['owner','admin'],'prepare database hygiene proposals')
 const pending:Stmt[]=[sql("UPDATE cf_hygiene_proposals SET status='stale' WHERE status='pending' AND (NOT EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=cf_hygiene_proposals.donor_id AND d.version=json_extract(input_json,'$.version') AND d.erased_at IS NULL) OR (related_donor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=cf_hygiene_proposals.related_donor_id AND d.version=json_extract(input_json,'$.sourceVersion') AND d.erased_at IS NULL)))")]
 const propose=async(d:Row,kind:string,evidence:string,command:string,input:Row,related:string|null=null,evidenceId:string|null=null)=>{
  const fingerprint=await sha256(JSON.stringify([kind,input,evidence,evidenceId]))
  pending.push(sql(`INSERT OR IGNORE INTO cf_hygiene_proposals(id,donor_id,related_donor_id,evidence_id,kind,evidence,command,input_json,fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,newId(),d.id,related,evidenceId,kind,evidence,command,JSON.stringify(input),fingerprint,c.now))
 }
 const duplicates=await likelyDuplicates(c)
 for(let page=0;page*duplicates.pageSize<duplicates.count;page++) {
  const batch=page===0?duplicates:await likelyDuplicates(c,{page})
  for(const pair of batch.pairs)await propose(pair.target,'merge',pair.reasons.map((r:Row)=>r.label).join('; '),'donor.merge',{donorId:pair.target.id,version:pair.target.version,sourceDonorId:pair.source.id,sourceVersion:pair.source.version,reason:'duplicate_record'},pair.source.id)
 }
 const donors=await all(c,`SELECT d.* FROM cf_donors d WHERE ${live} ORDER BY d.id`),byId=new Map(donors.map(d=>[d.id,d]))
 for(const d of donors)if(!d.informal_salutation)await propose(d,'salutation','No explicit informal salutation is recorded. Suggested wording uses the existing recorded name only.','donor.profile',{donorId:d.id,version:d.version,informalSalutation:personNames(await withNameDefaults(c,d)).informal})
 for(const row of await all(c,`SELECT e.* FROM cf_hygiene_evidence e WHERE NOT EXISTS(SELECT 1 FROM cf_hygiene_evidence newer WHERE newer.donor_id=e.donor_id AND json_extract(newer.correction,'$.kind')=json_extract(e.correction,'$.kind') AND newer.rowid>e.rowid) ORDER BY e.rowid`)) {
  const d=byId.get(row.donor_id);if(!d)continue
  const {kind,...correction}=JSON.parse(row.correction)
  if(kind==='status'&&d.constituent_status===correction.constituentStatus)continue
  if(kind==='address'&&['addressLine1','addressLine2','city','region','postalCode','country'].every((key)=>String(correction[key]??'')===String(d[({addressLine1:'address_line1',addressLine2:'address_line2',postalCode:'postal_code'} as Row)[key]??key]??'')))continue
  const input=kind==='address'?{donorId:d.id,version:d.version,name:d.name,email:d.email,phone:d.phone,household:(await one(c,'SELECT name FROM cf_households WHERE id=?',d.household_id))?.name??null,...correction}:{donorId:d.id,version:d.version,...correction}
  await propose(d,kind,`${row.source}: ${row.evidence}`,kind==='address'?'donor.update':'donor.profile',input,null,row.id)
 }
 await commit(c,[...pending,event(c,'hygiene.run','hygiene','queue',null,{candidateChecks:pending.length-1})])
 return hygieneState(c)
}

export async function reviewHygiene(c:Context,p:Row) {
 requireRole(c.actor,['owner','admin'],'accept or reject hygiene proposals')
 const key=id(p.id,'Proposal'),decision=choice(p.decision,['accept','reject'] as const,'review decision')
 const proposal=await one(c,"SELECT * FROM cf_hygiene_proposals WHERE id=? AND status='pending'",key)
 if(!proposal)fail('PROPOSAL_CHANGED','This proposal was already reviewed. Refresh.',409)
 const tail=[guard("EXISTS(SELECT 1 FROM cf_hygiene_proposals WHERE id=? AND status='pending')",'PROPOSAL_CHANGED','This proposal was already reviewed.',key),
  sql('UPDATE cf_hygiene_proposals SET status=?,reviewed_at=?,reviewed_by=? WHERE id=?',decision==='accept'?'accepted':'rejected',c.now,c.actor.id,key),event(c,'hygiene.'+decision,'hygiene_proposal',key,proposal.donor_id,{kind:proposal.kind})]
 if(decision==='reject'){await commit(c,tail);return {id:key,status:'rejected'}}
 if(p.confirm!=='ACCEPT')fail('REVIEW_REQUIRED','Confirm acceptance of this exact proposed change.',400)
 const input=JSON.parse(proposal.input_json)
 if(proposal.command==='donor.merge')await mergeDonor(c,input,tail)
 else if(proposal.command==='donor.profile')await householdCommand(c,'donor.profile',input,tail)
 else if(proposal.command==='donor.update')await donorCommand(c,'donor.update',input,tail)
 else fail('PROPOSAL_CHANGED','This proposal cannot be applied. Run hygiene again.',409)
 return {id:key,status:'accepted'}
}

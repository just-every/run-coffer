import { requireRole } from './auth'
import { addDays, all, commit, date, event, fail, guard, id, integer, longText, newId, one, optional, sql, text, today, type Context, type Row } from './db'
import { settings } from './settings'

const staff = (c: Context) => requireRole(c.actor, ['owner','admin','member'], 'manage cultivation plans and proposals')
const current = (prospectId: string) => guard(`EXISTS(SELECT 1 FROM cf_prospects p JOIN cf_donors d ON d.id=p.donor_id WHERE p.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`, 'PROSPECT_CHANGED', 'Open a current opportunity before changing its plan.', prospectId)

export async function cultivationState(c: Context, prospectId: string) {
 staff(c)
 const prospect = await one(c, `SELECT p.*,d.name AS donor_name FROM cf_prospects p JOIN cf_donors d ON d.id=p.donor_id WHERE p.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`, id(prospectId,'Opportunity'))
 if (!prospect) fail('NOT_FOUND','That opportunity no longer exists.',404)
 const [templates,tasks,proposals,owners] = await Promise.all([
  all(c,'SELECT * FROM cf_cultivation_templates ORDER BY lower(name),id'),
  all(c,'SELECT t.*,o.display_name AS owner_name FROM cf_cultivation_tasks t LEFT JOIN oa_operators o ON o.id=t.owner_id WHERE prospect_id=? ORDER BY due_on,created_at,id',prospectId),
  all(c,'SELECT id,prospect_id,title,body,version,file_name,media_type,sent_on,sent_method,sent_evidence,response_on,response,updated_at FROM cf_proposals WHERE prospect_id=? ORDER BY updated_at,id',prospectId),
  all(c,"SELECT id,display_name FROM oa_operators WHERE status='active' AND role IN ('owner','admin','member') ORDER BY lower(display_name),id"),
 ])
 return {prospect,templates:templates.map(t=>({...t,steps:JSON.parse(t.steps)} as Row)),tasks,proposals,owners}
}

export async function cultivationCommand(c: Context, command: string, p: Row): Promise<Row|undefined> {
 if (!['cultivation.template','cultivation.apply','cultivation.complete','proposal.save','proposal.attach','proposal.sent','proposal.response'].includes(command)) return undefined
 staff(c)
 if (command === 'cultivation.template') {
  const templateId = optional(p.templateId,'Template') ?? newId(), name = text(p.name,'Plan name')
  const raw = typeof p.steps === 'string' ? p.steps.split(/\r?\n/).filter(s=>s.trim()).map(line=>{const split=line.indexOf('|');return {offsetDays:Number(line.slice(0,split)),title:line.slice(split+1)}}) : p.steps
  if (!Array.isArray(raw)||raw.length<1||raw.length>30) fail('INPUT','Add 1–30 steps with a day offset and title.',400)
  const steps = raw.map(s=>({offsetDays:integer(Number(s.offsetDays),'Days after start',0,3650),title:text(s.title,'Step title')}))
  const version = p.templateId ? integer(p.version,'Template version',1) : 0
  await commit(c,[...(p.templateId ? [guard('EXISTS(SELECT 1 FROM cf_cultivation_templates WHERE id=? AND version=?)','VERSION','This template changed. Refresh before saving.',templateId,version)] : []),
   sql(`INSERT INTO cf_cultivation_templates VALUES(?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,steps=excluded.steps,version=version+1,updated_at=excluded.updated_at`,templateId,name,JSON.stringify(steps),c.now),event(c,command,'cultivationTemplate',templateId,null,{steps:steps.length})])
  return {id:templateId,version:version+1}
 }
 const prospectId=id(p.prospectId,'Opportunity'), state=await cultivationState(c,prospectId), donorId=state.prospect.donor_id
 const statements=[current(prospectId)]
 if (command === 'cultivation.apply') {
  const templateId=id(p.templateId,'Template'),template=state.templates.find(t=>t.id===templateId)
  if(!template)fail('NOT_FOUND','Choose an existing plan template.',404)
  const version=integer(p.templateVersion,'Template version',1),start=date(p.startOn,'Plan start'),ownerId=id(p.ownerId,'Task owner'),planId=newId()
  statements.push(guard('EXISTS(SELECT 1 FROM cf_cultivation_templates WHERE id=? AND version=?)','VERSION','The template changed. Refresh before applying it.',templateId,version),guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin','member'))",'OWNER_CHANGED','Choose an active team member.',ownerId))
  for(const step of template.steps) statements.push(sql("INSERT INTO cf_cultivation_tasks VALUES(?,?,?,?,?,?,?,?, 'open',1,NULL,NULL,?)",newId(),prospectId,planId,templateId,template.name,step.title,addDays(start,step.offsetDays),ownerId,c.now))
  statements.push(event(c,command,'prospect',prospectId,donorId,{planId,templateId,templateVersion:version,tasks:template.steps.length}))
 } else if(command === 'cultivation.complete') {
  const taskId=id(p.taskId,'Task'),version=integer(p.version,'Task version',1),notes=longText(p.notes,'Completion notes',2000)
  statements.push(guard("EXISTS(SELECT 1 FROM cf_cultivation_tasks WHERE id=? AND prospect_id=? AND version=? AND status='open')",'VERSION','This task changed or is already complete.',taskId,prospectId,version),sql("UPDATE cf_cultivation_tasks SET status='done',version=version+1,completed_on=?,notes=? WHERE id=?",today((await settings(c)).timezone,new Date(c.now)),notes,taskId),event(c,command,'cultivationTask',taskId,donorId))
 } else if(command === 'proposal.save') {
  const proposalId=optional(p.proposalId,'Proposal')??newId(),title=text(p.title,'Proposal title'),body=longText(p.body,'Proposal draft',12000),version=p.proposalId?integer(p.version,'Proposal version',1):0
  if(p.proposalId) statements.push(guard('EXISTS(SELECT 1 FROM cf_proposals WHERE id=? AND prospect_id=? AND version=? AND sent_on IS NULL)','VERSION','This draft changed or was already recorded as sent.',proposalId,prospectId,version))
  statements.push(sql(`INSERT INTO cf_proposals(id,prospect_id,title,body,version,updated_at) VALUES(?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,version=version+1,updated_at=excluded.updated_at`,proposalId,prospectId,title,body,c.now),event(c,command,'proposal',proposalId,donorId))
  await commit(c,statements);return {id:proposalId,prospectId,version:version+1}
 } else {
  const proposalId=id(p.proposalId,'Proposal'),version=integer(p.version,'Proposal version',1),proposal=state.proposals.find(r=>r.id===proposalId)
  if(!proposal)fail('NOT_FOUND','That proposal no longer exists.',404)
  statements.push(guard('EXISTS(SELECT 1 FROM cf_proposals WHERE id=? AND prospect_id=? AND version=?)','VERSION','This proposal changed. Refresh before saving.',proposalId,prospectId,version))
  if(command === 'proposal.attach') {
   if(proposal.sent_on)fail('ALREADY_SENT','Keep the attachment recorded as sent. Create a new draft for a revision.')
   const fileName=text(p.fileName,'File name',150),mediaType=text(p.mediaType,'File type'),encoded=text(p.contentBase64,'Attachment',350000)
   if(!['application/pdf','text/plain'].includes(mediaType)||/[\r\n\\/]/.test(fileName))fail('INPUT','Attach a PDF or plain-text document with a simple file name.',400)
   let bytes:string;try{bytes=atob(encoded)}catch{fail('INPUT','The attachment is not valid base64.',400)}
   if(bytes!.length>256000||!bytes!.length)fail('INPUT','Attach a nonempty file up to 256,000 bytes.',400)
   if(mediaType==='application/pdf'&&!bytes!.startsWith('%PDF-'))fail('INPUT','That file does not have a PDF header.',400)
   statements.push(sql('UPDATE cf_proposals SET file_name=?,media_type=?,content_base64=?,version=version+1,updated_at=? WHERE id=? AND sent_on IS NULL',fileName,mediaType,encoded,c.now,proposalId))
  } else if(command === 'proposal.sent') {
   const sentOn=date(p.sentOn,'Sent on'),day=today((await settings(c)).timezone,new Date(c.now))
   if(sentOn>day)fail('INPUT','Sent on cannot be in the future.',400)
   statements.push(guard('EXISTS(SELECT 1 FROM cf_proposals WHERE id=? AND sent_on IS NULL AND content_base64 IS NOT NULL)','PROPOSAL_NOT_READY','Attach the actual document before recording how you sent it.',proposalId),sql('UPDATE cf_proposals SET sent_on=?,sent_method=?,sent_evidence=?,version=version+1,updated_at=? WHERE id=?',sentOn,text(p.method,'Sending method',100),longText(p.evidence,'Sending evidence',2000),c.now,proposalId))
  } else {
   const responseOn=date(p.responseOn,'Response on'),day=today((await settings(c)).timezone,new Date(c.now))
   if(!proposal.sent_on||responseOn<proposal.sent_on||responseOn>day)fail('INPUT','Response date must be between the recorded sending date and today.',400)
   statements.push(sql('UPDATE cf_proposals SET response_on=?,response=?,version=version+1,updated_at=? WHERE id=?',responseOn,longText(p.response,'Response',4000),c.now,proposalId))
  }
  statements.push(event(c,command,'proposal',proposalId,donorId))
 }
 await commit(c,statements);return {prospectId}
}

export async function proposalDownload(c:Context,proposalId:string) {
 staff(c)
 const p=await one(c,`SELECT r.* FROM cf_proposals r JOIN cf_prospects p ON p.id=r.prospect_id JOIN cf_donors d ON d.id=p.donor_id WHERE r.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`,id(proposalId,'Proposal'))
 if(!p?.content_base64)fail('NOT_FOUND','No attached document is available.',404)
 return new Response(Uint8Array.from(atob(p.content_base64),ch=>ch.charCodeAt(0)),{headers:{'content-type':p.media_type,'content-disposition':`attachment; filename="${p.file_name.replace(/["\x00-\x1f]/g,'_')}"`,'cache-control':'no-store','x-content-type-options':'nosniff'}})
}

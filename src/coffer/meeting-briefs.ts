import { manager, requireRole } from './auth'
import { all, commit, event, fail, guard, id, integer, newId, one, sql, text, type Context, type Row } from './db'
import { donorHistory } from './donors'
import { prospects } from './major-gifts'
import { researchState } from './research'
import { runtimeBindings, type Bindings } from '../auth.server'
import { systemContext } from './agent/activity'

const staff = (c: Context) => requireRole(c.actor, ['owner','admin','member'], 'schedule meetings and read meeting briefs')
const live = (donorId: string) => guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE id=? AND erased_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`, 'DONOR_CHANGED', 'Choose a current donor.', donorId)

export async function meetingCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['meeting.schedule','meeting.cancel'].includes(command)) return undefined
 staff(c)
 if (command === 'meeting.cancel') {
  const key = id(p.id,'Meeting'), version = integer(Number(p.version),'Meeting version',1)
  const meeting = await one(c,'SELECT * FROM cf_donor_meetings WHERE id=?',key)
  if (!meeting) fail('NOT_FOUND','That meeting does not exist.',404)
  await commit(c,[live(meeting.donor_id),
   guard('EXISTS(SELECT 1 FROM cf_donor_meetings WHERE id=? AND version=? AND cancelled_at IS NULL)', 'VERSION','This meeting changed. Refresh before cancelling.',key,version),
   sql('UPDATE cf_donor_meetings SET cancelled_at=?,version=version+1 WHERE id=?',c.now,key),
   event(c,command,'meeting',key,meeting.donor_id)])
  return {id:key,version:version+1,cancelled:true}
 }
 const donorId=id(p.donorId,'Donor'), starts=text(p.startsAt,'Meeting time',24)
 const parsed=Date.parse(starts)
 if (!Number.isFinite(parsed) || new Date(parsed).toISOString()!==starts || parsed<=Date.parse(c.now)) fail('INPUT','Meeting time must be a future UTC timestamp like 2030-02-02T12:00:00.000Z.',400)
 const key=newId(),prepareAt=new Date(parsed-86400000).toISOString()
 await commit(c,[live(donorId),sql('INSERT INTO cf_donor_meetings(id,donor_id,starts_at,prepare_at,created_at,created_by) VALUES(?,?,?,?,?,?)',key,donorId,starts,prepareAt,c.now,c.actor.id),event(c,command,'meeting',key,donorId,{startsAt:starts})])
 return {id:key,donorId,startsAt:starts,prepareAt,version:1}
}

/** Minute scheduler: idempotent readiness, with no model or outbound send. */
export async function advanceMeetingBriefs(original: Bindings, at=new Date()) {
 const env=runtimeBindings(original),c=systemContext(env.DB,env,at.toISOString())
 await commit(c,[sql(`UPDATE cf_donor_meetings SET ready_at=? WHERE cancelled_at IS NULL AND ready_at IS NULL AND prepare_at<=?
 AND EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=donor_id AND d.erased_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`,c.now,c.now)])
}

export async function meetings(c: Context) {
 staff(c)
 return all(c,`SELECT m.* FROM cf_donor_meetings m JOIN cf_donors d ON d.id=m.donor_id
 WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges a WHERE a.donor_id=d.id)
 ORDER BY starts_at,id`)
}

/** No stored brief can leak an earlier reader's research or stale donor facts.
 * Each line is an exact projection from an existing authorized public door. */
export async function meetingBrief(c: Context, key: string) {
 staff(c)
 const meeting=await one(c,`SELECT m.* FROM cf_donor_meetings m JOIN cf_donors d ON d.id=m.donor_id
 WHERE m.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges a WHERE a.donor_id=d.id)`,id(key,'Meeting'))
 if(!meeting)fail('NOT_FOUND','That meeting does not exist.',404)
 if(meeting.cancelled_at)fail('MEETING_CANCELLED','This meeting was cancelled.',409)
 if(!meeting.ready_at)fail('BRIEF_PENDING','The brief becomes available on the scheduler tick 24 hours before the meeting.',409)
 const history=await donorHistory(c,meeting.donor_id),href='/api/coffer/donors/'+encodeURIComponent(meeting.donor_id)
 const lastMeeting=history.depth.interactions.find(i=>i.kind==='meeting' && i.occurred_on<=meeting.starts_at.slice(0,10) && i.recorded_at<meeting.starts_at)
 const lines: Row[]=[{kind:'giving_summary',facts:history.summary,source:{href,pointer:'/summary'}}]
 const add=(kind:string,rows:Row[],sourceHref:string,pointer:string)=>rows.forEach(row=>lines.push({kind,facts:row,source:{href:sourceHref,pointer,id:row.id}}))
 add('interaction',history.depth.interactions.slice(0,10),href,'/depth/interactions')
 if(lastMeeting?.open_question&&!lastMeeting.question_resolved_at)add('open_question',[lastMeeting],href,'/depth/interactions')
 add('relationship',history.depth.relationships,href,'/depth/relationships')
 add('pledge',history.pledges.filter((p:Row)=>p.remaining_cents>0),href,'/pledges')
 add('opportunity',(await prospects(c)).filter(p=>p.donor_id===meeting.donor_id&&!p.closed_on),'/api/coffer/prospects','')
 if(manager(c.actor))add('stored_research',(await researchState(c,meeting.donor_id)).results,'/api/coffer/research?donorId='+encodeURIComponent(meeting.donor_id),'/results')
 return {meeting,donor:{id:history.donor.id,name:history.donor.name},generatedAt:c.now,delivery:'Available here and as a printable brief; no brief has been emailed.',lines}
}

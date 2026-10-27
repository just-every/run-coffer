import { meetings } from '../meeting-briefs'
import { bookingDonorPanel } from './calendars'
import type { Context } from '../db'
import type { DonorInteraction } from '../donor-depth'
import { area,box,e,field,form,moment } from './common'

export async function meetingsPanel(c:Context,donorId:string,interactions:DonorInteraction[],timezone:string) {
 const rows=(await meetings(c)).filter(m=>m.donor_id===donorId)
 const questions=interactions.filter(i=>i.open_question)
 return box('Meetings and briefs',`<p>Briefs become available on the scheduler tick 24 hours before a meeting. Open the brief here; no email is sent.</p>
 <details class="edit"><summary>Schedule a meeting</summary>${form('meeting.schedule',field('Meeting time (UTC)','startsAt','text','','required placeholder="2030-02-02T12:00:00.000Z"'),'Schedule meeting',{donorId})}</details>
 ${await bookingDonorPanel(c,donorId)}
 ${rows.length?`<ul class="list">${rows.map(m=>`<li>${moment(m.starts_at,timezone)} · ${m.cancelled_at?'Cancelled':m.ready_at?`<a href="/app/meetings/${e(m.id)}/brief">Open meeting brief</a>`:'Brief pending'}${!m.cancelled_at?form('meeting.cancel','', 'Cancel meeting',{id:m.id,version:m.version,donorId}):''}</li>`).join('')}</ul>`:'<p>No scheduled meetings.</p>'}
 <details class="edit"><summary>Record meeting questions</summary>${form('interaction.record',area('Meeting notes','notes','','required maxlength="8000"')+field('Meeting date','occurredOn','date','','required')+area('Questions left open','openQuestion','','required maxlength="2000"'),'Save meeting questions',{donorId,kind:'meeting',who:c.actor.name})}</details>
 ${questions.length?`<ul class="list">${questions.map(i=>`<li data-question-id="${e(i.id)}"><p>${e(i.open_question)}</p><p>${e(i.occurred_on)} · ${i.question_resolved_at?'Resolved':'Open'}</p>${form('meeting.question.set','',i.question_resolved_at?'Reopen question':'Resolve question',{donorId,interactionId:i.id,version:i.question_version,state:i.question_resolved_at?'open':'resolved'})}</li>`).join('')}</ul>`:'<p>No meeting questions recorded.</p>'}`, 'meetings')
}

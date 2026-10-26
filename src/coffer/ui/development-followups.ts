import { developmentFollowups } from '../development-followups'
import { settings } from '../settings'
import type { Context, Row } from '../db'
import { area, box, chip, e, empty, field, hidden, longDay, money, select, when } from './common'

const action = (name: string, content: string, button: string, values: Row = {}) =>
 `<form method="post" action="/app/agent/followups/${e(name)}">${Object.entries(values).map(([key,value])=>hidden(key,value)).join('')}${content}<button>${e(button)}</button></form>`

export async function developmentFollowupsPage(c: Context) {
 const [state,s]=await Promise.all([developmentFollowups(c),settings(c)])
 const render=(f: Row)=>{
  const reminders=state.reminders.filter(r=>r.followup_id===f.id),current=reminders.find(r=>r.version===f.version)
  const escalation=state.escalations.find(t=>t.source_key===`development:${f.id}:${f.version}`),values={id:f.id,version:f.version}
  const uncertain=reminders.some(r=>r.status==='uncertain'||r.status==='sending')
  const approval=!f.resolution&&!f.reply_at&&!current&&!uncertain&&!f.hold&&f.current_recipient_email===f.recipient_email
   ? `<details><summary>Review and approve reminder</summary>${action('approve',
    field('Exact recipient','recipientEmail','email',f.recipient_email,'required readonly')+
    area('Exact reminder to approve','body',f.body,'required readonly rows="4"')+
    area('Approval authority and purpose','authorityNote','','required maxlength="2000"'),
    'Approve this exact reminder',values)}</details>`:''
  const history=reminders.length?`<details><summary>Reminder and approval history</summary>${reminders.map(r=>`<article><h3>${chip(r.status)}</h3><p>${e(r.recipient_email)} · Approved ${when(r.approved_at,s.timezone)}</p><p>${e(r.body)}</p><p>Authority: ${e(r.authority_note)}</p>${r.submitted_at?`<p>Submitted ${when(r.submitted_at,s.timezone)}</p>`:''}</article>`).join('')}</details>`:''
  const reply=f.reply_at?`<p>${chip('Reply recorded','ok')} ${when(f.reply_at,s.timezone)} · ${e(f.reply_note)}</p>`
   :!f.resolution?`<details><summary>Record a reply</summary>${action('reply',area('Reply evidence','note','','required maxlength="4000"'),'Record reply',values)}</details>`:''
  const resolve=!f.resolution?`<details><summary>Record resolution</summary>${action('resolve',
   select('Resolution','resolution',[['paid',f.kind==='report'?'Report completed':'Paid from recorded gifts'],['revised','Revised deadline with approval'],['written_off','Written off follow-up only']])+
   `<p>Payment and report completion must already be recorded at the source. Writing off this follow-up leaves the financial balance unchanged.</p>`+
   area('Resolution evidence, approval or write-off reason','note','','required maxlength="4000"')+
   `<details><summary>Approve a revised deadline</summary>${field('New deadline','dueOn','date')}<label><input type="checkbox" name="approveRevision" value="1"> I approve this change to the source deadline.</label></details>`,
   'Record resolution',values)}</details>`:`<p>${chip(f.resolution==='written_off'?'Follow-up written off':f.resolution==='revised'?'Deadline revised':f.kind==='report'?'Report completed':'Paid','ok')} ${when(f.resolved_at,s.timezone)}</p><p>${e(f.resolution_note)}</p>${f.resolution==='written_off'?'<p>The source balance is unchanged. This is a recorded follow-up disposition.</p>':''}`
  return box(f.donor_name,`<p>${e(f.title??f.kind)} · Due ${longDay(f.due_on)}${f.kind!=='report'?` · ${money(f.source_remaining_cents??f.amount_cents)} remaining`:''}</p>
   <p><a href="/app/donors/${e(f.donor_id)}">Open constituent record</a>${escalation?` · <a href="/app/calls?owner=${e(escalation.owner_id)}">${escalation.status==='done'?'View completed escalation':'View relationship manager escalation'}</a>`:''}</p>
   ${f.hold&&!f.resolution?`<p>${chip('Reminder held','warn')} ${e(f.hold)}</p>`:''}
   ${uncertain?'<p>Submission needs investigation. Further sending is stopped.</p>':''}
   ${current?.status==='approved'?'<p>Approved. Run follow-ups to submit this reminder.</p>':''}
   ${current?.status==='submitted'?`<p>${chip('Reminder submitted','ok')} ${when(current.submitted_at,s.timezone)}</p>`:''}
   ${approval}${history}${reply}${resolve}`)
 }
 const open=state.findings.filter(f=>!f.resolution),closed=state.findings.filter(f=>f.resolution)
 return `<p>Review overdue commitments, approve their reminders, and record the outcome.</p>${action('run','','Run follow-ups')}
  ${open.length?open.map(render).join(''):empty('No open follow-ups. Run the agent to check overdue installments, grant reports and matching gifts.')}
  ${closed.length?`<details><summary>Resolved follow-ups (${closed.length})</summary>${closed.map(render).join('')}</details>`:''}`
}

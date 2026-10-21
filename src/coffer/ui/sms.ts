import type { Context } from '../db'
import { smsPreference, smsPreferenceHistory, smsState } from '../sms'
import { area, box, e, field, form, select, chip } from './common'

export async function smsPreferencePanel(c:Context,donorId:string,number=''):Promise<string>{
 const pref=await smsPreference(c,donorId),rows=await smsPreferenceHistory(c,donorId)
 const history=pref?`<p>${chip(pref.status==='granted'?'SMS permission granted':'SMS permission withdrawn',pref.status==='granted'?'ok':'warn')} ${e(pref.timezone)}. Source: ${e(pref.source)}, ${e(pref.captured_on)}. Recorded by ${e(pref.recorded_by)}.</p><details><summary>Permission history</summary><ul>${rows.map(r=>`<li>${e(r.status)}${r.donor_id!==donorId?' (original merged record)':''} · ${e(r.captured_on)} · ${e(r.source)} · ${e(r.recorded_by)}: ${e(r.evidence)}</li>`).join('')}</ul></details>`:'<p>No SMS permission recorded.</p>'
 return box('Text message permission',history+(['owner','admin','member'].includes(c.actor.role)?form('sms.preference',select('SMS permission','status',[['withdrawn','Withdrawn'],['granted','Granted']],pref?.status??'withdrawn')+field('Phone with country code','phone','tel',number||pref?.phone||'','required')+field('Donor time zone','timezone','text',pref?.timezone??'','required placeholder="America/New_York"')+area('Permission evidence','evidence','','required'), 'Save SMS permission',{donorId,version:pref?.id??0,returnDonorId:donorId}):''),'sms-permission')
}

export async function textsPage(c:Context,runId?:string):Promise<string>{
 const state=await smsState(c,runId),manager=['owner','admin'].includes(c.actor.role)
 const note='<p>Texts send only after a person approves this exact message and explicitly sends it. Outside 8 a.m.–9 p.m. in the donor’s time zone, texts wait for a person to send later. “Submitted” means Twilio accepted the request; delivery is not proven. A submission in progress or with an unknown result is never retried automatically.</p>'
 if(!runId)return box('Text messages',note+(manager?form('sms.prepare',field('Run name','name','text','','required')+select('Purpose','purpose',[['appeal','Appeal (ask)'],['thank-you','Thank-you (not an ask)'],['pledge-reminder','Pledge reminder (not an ask)']])+select('Choose donors','donorIds',state.donors.map((d:any)=>[d.id,d.name+(d.phone?' · '+d.phone:' · No phone')]),'', 'multiple required size="8"')+area('Exact message','body','','required maxlength="1600"'),'Prepare text run'):'')+`<ul>${state.runs.map((r:any)=>`<li><a href="/app/texts?runId=${e(r.id)}">${e(r.name)}</a> · ${e(r.purpose)} · ${e(r.state)}</li>`).join('')}</ul>`)
 const r=state.run,pending=state.recipients.some((d:any)=>['pending','held'].includes(d.state)),unclaimed=state.recipients.every((d:any)=>!d.claimed_at)
 return box(r.name,note+`<p>${chip(r.purpose==='appeal'?'Ask':'Not an ask')} ${chip(r.state)}</p><blockquote>${e(r.body)}</blockquote><p>Prepared by ${e(r.prepared_by)}${r.approved_by?`; approved by ${e(r.approved_by)}`:''}.</p>`+
  `<ul>${state.recipients.map((d:any)=>`<li>${e(d.name)} · ${e(d.timezone)} · ${e(d.state==='submitting'?'Submission in progress or uncertain':d.state)}${d.provider_status?` (${e(d.provider_status)})`:''}</li>`).join('')}</ul><h3>Excluded</h3><ul>${r.excluded.map((x:any)=>`<li>${e(x.name)}: ${e(x.reason)}</li>`).join('')}</ul>`+
  (manager&&['prepared','approved'].includes(r.state)?
   (r.state==='prepared'?form('sms.approve','','Approve exact message and recipients',{runId:r.id,version:r.version}):pending?form('sms.send','','Send approved texts now',{runId:r.id,version:r.version}):'<p>Every recipient has a saved submission result. No further texts are queued.</p>')+
   (unclaimed?form('sms.discard','','Discard unsent run',{runId:r.id,version:r.version},'secondary'):''):'') )
}

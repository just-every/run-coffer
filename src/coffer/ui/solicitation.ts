import type { Context, Row } from '../db'
import { solicitationState } from '../solicitation'
import { box, chip, e, field, form, select } from './common'

export function solicitationBadge(state:Row|undefined):string {
 if(!state||state.type==='none'||!state.active)return ''
 const label=state.type==='stop'?'Do not solicit':state.type==='channels'?`No ${state.channels.join(', ')} appeals`:`At most ${state.max_asks} ask${state.max_asks===1?'':'s'} per calendar year`
 return chip(label,'warn')
}

export async function solicitationPanel(c:Context,donorId:string):Promise<string> {
 const state=(await solicitationState(c,[donorId]))[0]
 const explanation='<p>Restrictions apply to asks. Receipts, statements, pledge reminders and other transactional messages still go. Annual limits count asks across every channel from January 1 through December 31 in the organization’s time zone.</p>'
 const current=state.version?`<p>${solicitationBadge(state)||e(state.type==='none'?'No solicitation restriction':'Restriction outside its active dates')}. From ${e(state.starts_on)}${state.ends_on?` through ${e(state.ends_on)}`:''}. Source: ${e(state.source)}${state.source_ref?` · ${e(state.source_ref)}`:''}, ${e(state.source_on)}. Recorded by ${e(state.recorded_by_name)}.</p>`:'<p>No solicitation restriction recorded.</p>'
 const editor=['owner','admin','member'].includes(c.actor.role)?form('solicitation.set',
  select('Restriction','type',[['none','No restriction'],['stop','Do not solicit'],['channels','No asks on chosen channels'],['limit','Limit asks per calendar year']],state.type)+
  field('Start date','startsOn','date',state.starts_on??state.asOf,'required')+
  field('End date (optional)','endsOn','date',state.ends_on??'')+
  field('Restricted channels (email, mail, sms, phone)','channels','text',state.channels.join(', '))+
  field('Maximum asks per calendar year','maxAsks','number',state.max_asks??1,'min="1" max="10000"')+
  select('Source','source',[['person','Recorded by a person'],['interaction','Donor request logged as an interaction']],'person')+
  field('Interaction ID (for a logged donor request)','sourceRef')+
  '<p>Only an owner, admin or assigned relationship manager can replace or clear an existing restriction.</p>',
  'Save restriction',{donorId,version:state.version,returnDonorId:donorId}):''
 return box('Solicitation restriction',explanation+current+editor,'solicitation')
}

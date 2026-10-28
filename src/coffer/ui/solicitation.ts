import { settings } from '../settings'
import { all, type Context, type Row } from '../db'
import { solicitationState } from '../solicitation'
import { SOLICITATION_PERIODS, SOLICITATION_PERIOD_LABELS, solicitationPeriodWindows, type SolicitationPeriod } from '../solicitation-periods'
import { box, chip, e, field, form, select } from './common'

export function solicitationBadge(state:Row|undefined):string {
 if(!state)return ''
 const inherited=(state.inherited??[]).filter((r:Row)=>r.active).map((r:Row)=>solicitationBadge(r)).join(' ')
 if(state.type==='none'||!state.active)return inherited
 const label=state.type==='stop'?'Do not solicit':state.type==='channels'?`No ${state.channels.join(', ')} appeals`:`At most ${state.max_asks} ask${state.max_asks===1?'':'s'} per ${SOLICITATION_PERIOD_LABELS[state.period as SolicitationPeriod].toLowerCase()}`
 return chip(label,'warn')+(state.type==='limit'&&state.lastAskOn?` <span class="muted">Last ask ${e(state.lastAskOn)}</span>`:'')+' '+inherited
}

export async function solicitationPanel(c:Context,donorId:string):Promise<string> {
 const state=(await solicitationState(c,[donorId]))[0]
 const interactions=await all(c,'SELECT id,kind,occurred_on,notes FROM cf_interactions WHERE donor_id=? ORDER BY occurred_on DESC,recorded_at DESC',donorId)
 const request=interactions.find(i=>i.id===state.source_ref)
 const sourceName=({person:'Recorded by a person',portal:'Donor portal',interaction:'Logged donor request',import:'CRM import'} as Record<string,string>)[state.source]??state.source
 const windows=solicitationPeriodWindows(state.asOf,(await settings(c)).fiscal_year_start)
 const explanation='<p>Restrictions apply to asks. Receipts, statements, pledge reminders and other transactional messages still go. Limits count asks across every channel in the organization’s time zone and use a rolling 12-month window or reset at the chosen calendar or fiscal boundary.</p>'+`<p>Current periods (both dates included): ${SOLICITATION_PERIODS.map(period=>`${e(SOLICITATION_PERIOD_LABELS[period])}: ${e(windows[period].start)} through ${e(windows[period].through)}`).join('; ')}.</p>`
 const current=state.version?`<p>${solicitationBadge(state)||e(state.type==='none'?'No solicitation restriction':'Restriction outside its active dates')}. From ${e(state.starts_on)}${state.ends_on?` through ${e(state.ends_on)}`:''}. Source: ${e(sourceName)}${state.source_ref?` · ${e(state.source==='interaction'?(request?request.kind+' request on '+request.occurred_on:'Earlier logged request'):state.source_ref)}`:''}, ${e(state.source_on||'Source date unknown')}. Recorded by ${e(state.recorded_by_name)}.</p>`:'<p>No solicitation restriction recorded.</p>'
 const editor=['owner','admin','member'].includes(c.actor.role)?form('solicitation.set',
  select('Restriction','type',[['none','No restriction'],['stop','Do not solicit'],['channels','No asks on chosen channels'],['limit','Limit asks per period']],state.type)+
  field('Start date','startsOn','date',state.starts_on??state.asOf,'required')+
  field('End date (optional)','endsOn','date',state.ends_on??'')+
  field('Restricted channels (email, mail, sms, phone)','channels','text',state.channels.join(', '))+
  select('Limit period','period',SOLICITATION_PERIODS.map(period=>[period,SOLICITATION_PERIOD_LABELS[period]] as [string,string]),state.period)+
  field('Maximum asks per period','maxAsks','number',state.max_asks??1,'min="1" max="10000"')+
  select('Source','source',[['person','Recorded by a person'],['interaction','Donor request logged as an interaction']],'person')+
  select('Logged donor request','sourceRef',[['','Choose a request when the source is an interaction'],...interactions.map(i=>[i.id,`${i.occurred_on} · ${i.kind} · ${String(i.notes).slice(0,80)}`] as [string,string])],state.source==='interaction'?state.source_ref:'')+
  field('Source date','sourceOn','date',state.source_on??state.asOf,'required')+
  '<p>Only an owner, admin or assigned relationship manager can replace or clear a restriction. Saving replaces the choices for all original records merged into this donor; their prior answers remain in history.</p>',
  'Save restriction',{donorId,version:state.version,returnDonorId:donorId}):''
 const lastAsk=`<p>Last ask across all channels: ${state.lastAskOn?e(state.lastAskOn):'None recorded'} (as of ${e(state.asOf)}).</p>`
 return box('Solicitation restriction',explanation+current+lastAsk+(state.inherited?.length?`<p>Restrictions retained from merged original records: ${solicitationBadge({...state,type:'none'})||'none active'}.</p>`:'')+editor+(['owner','admin','member'].includes(c.actor.role)?form('appeal.prepare',field('Appeal name','name','text','','required')+field('Reason for this one-run inclusion','includeReason','text','','required maxlength="1000"')+'<p>Only an owner, admin or this donor’s assigned relationship manager can deliberately include them. Channel consent is still required.</p>','Prepare one-run email appeal',{channel:'email',includeDonorId:donorId}):''),'solicitation')
}

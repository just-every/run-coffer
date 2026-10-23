import { choice, commit, event, fail, guard, integer, newId, one, sql, today } from '../db'
import { settings } from '../settings'
import { SOLICITATION_CHANNELS } from '../solicitation'
import { SOLICITATION_PERIODS, SOLICITATION_PERIOD_LABELS } from '../solicitation-periods'
import { box, e, field, hidden, select } from '../ui/common'
import { portalPage } from './portal-ui'
import type { GivingEnv } from './stripe'

import { portalContext as requestContext, type PortalDonor } from './portal-identity'
/** The self-service door only strengthens a choice, retaining all merged original restrictions.
 * It never clears a staff/imported/original choice or grants channel consent. */
export async function saveDonorRequest(env:GivingEnv,donor:PortalDonor,data:URLSearchParams){
 const c=await requestContext(env,donor)
 if(data.has('donorId')&&data.get('donorId')!==donor.id)fail('FORBIDDEN','Only your own donation request can be changed.',403)
 const type=choice(data.get('type'),['stop','channels','limit'] as const,'restriction')
 if(data.get('confirm')!=='yes')fail('confirmation_required','Confirm your donation-request restriction.',400)
 const channels=type==='channels'?[...new Set(data.getAll('channels').map(v=>choice(v,SOLICITATION_CHANNELS,'restricted channel')))].sort():[]
 if(type==='channels'&&!channels.length)fail('INPUT','Choose at least one channel.',400)
 const maxAsks=type==='limit'?integer(Number(data.get('maxAsks')),'Maximum asks',1,10000):null
 const period=type==='limit'?choice(data.get('period')||'rolling-12-months',SOLICITATION_PERIODS,'period'):'rolling-12-months'
 const version=integer(Number(data.get('version')),'Request version',0),current=await one(c,'SELECT * FROM cf_solicitation WHERE donor_id=?',donor.id)
 if((current?.version??0)!==version)fail('SOLICITATION_CHANGED','Your recorded choice changed. Reload this page before confirming.')
 if(type!=='stop'&&current&&current.type!=='none'&&(current.type!==type||(type==='channels'&&JSON.parse(current.channels).some((v:string)=>!channels.includes(v as typeof channels[number])))||(type==='limit'&&(period!==current.period||(maxAsks??0)>current.max_asks))))fail('RESTRICTION_WEAKENED','This would loosen an existing restriction. Keep its channels or choose a lower limit in the same period, or stop all asks.',409)
 const day=today((await settings(c)).timezone,new Date(c.now)),startsOn=current&&current.type!=='none'&&current.starts_on<day?current.starts_on:day,sourceRef=newId()
 const answer={type,startsOn,endsOn:null,channels,maxAsks,period:type==='limit'?period:null,source:'portal',sourceRef,sourceOn:day,actorId:c.actor.id,actorName:c.actor.name,at:c.now}
 await commit(c,[guard('COALESCE((SELECT version FROM cf_solicitation WHERE donor_id=?),0)=?','SOLICITATION_CHANGED','Your recorded choice changed. Reload this page before confirming.',donor.id,version),
 sql(`INSERT INTO cf_solicitation(donor_id,version,type,starts_on,ends_on,channels,max_asks,source,source_ref,source_on,recorded_at,recorded_by_id,recorded_by_name,period) VALUES(?,?,?,?,NULL,?,?,'portal',?,?,?,?,?,?)
 ON CONFLICT(donor_id) DO UPDATE SET version=excluded.version,type=excluded.type,starts_on=excluded.starts_on,ends_on=NULL,channels=excluded.channels,max_asks=excluded.max_asks,source='portal',source_ref=excluded.source_ref,source_on=excluded.source_on,recorded_at=excluded.recorded_at,recorded_by_id=excluded.recorded_by_id,recorded_by_name=excluded.recorded_by_name,period=excluded.period`,donor.id,version+1,type,startsOn,JSON.stringify(channels),maxAsks,sourceRef,day,c.now,c.actor.id,c.actor.name,period),
 sql('INSERT INTO cf_solicitation_history VALUES(?,?,?)',donor.id,version+1,JSON.stringify(answer)),event(c,'solicitation.set','donor',donor.id,donor.id,{...answer,version:version+1})])
}
export async function donorRequestPage(env:GivingEnv,donor:PortalDonor,saved=false){
 const c=await requestContext(env,donor);await commit(c,[])
 const current=await one(c,'SELECT * FROM cf_solicitation WHERE donor_id=?',donor.id)
 return portalPage('Donation requests',`<p>For ${e(donor.name)}.</p>${saved?'<p class="notice" role="status">Your donation-request restriction is saved.</p>':''}${box('Do not ask me for donations',`<p>This stops donation requests across every channel. Gift receipts, annual statements and reminders for pledges you already made can still reach you under their separate permissions.</p>${current?.type==='stop'?'<p>A do-not-solicit choice is already recorded.</p>':''}<form method="post" action="/giving/portal/preferences">${hidden('version',current?.version??0)}${hidden('type','stop')}<label><input type="checkbox" name="confirm" value="yes" required> Do not ask me for donations.</label><button>Save do not solicit</button></form><p>This page only strengthens restrictions and never grants channel permission. Contact the organization to resume asks or loosen a restriction.</p>`)}${box('No asks on chosen channels',`<form method="post" action="/giving/portal/preferences">${hidden('version',current?.version??0)}${hidden('type','channels')}${hidden('confirm','yes')}${SOLICITATION_CHANNELS.map(channel=>`<label><input type="checkbox" name="channels" value="${channel}" ${JSON.parse(current?.channels??'[]').includes(channel)?'checked':''}> No ${channel} appeals</label>`).join('')}<button>Save channel restrictions</button></form>`)}${box('Limit donation requests',`<form method="post" action="/giving/portal/preferences">${hidden('version',current?.version??0)}${hidden('type','limit')}${hidden('confirm','yes')}${field('Maximum asks','maxAsks','number',current?.max_asks??1,'min="1" max="10000" required')}${select('Period','period',SOLICITATION_PERIODS.map(period=>[period,SOLICITATION_PERIOD_LABELS[period]] as [string,string]),current?.period??'rolling-12-months')}<p>Limits count across all ask channels. An existing limit can only be lowered in the same period.</p><button>Save ask limit</button></form>`)}<p><a href="/giving/portal">Back to your giving account</a></p>`)
}

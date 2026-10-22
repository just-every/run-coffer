import { commit, event, fail, guard, integer, newId, one, sql, today } from '../db'
import { settings } from '../settings'
import { box, e, hidden } from '../ui/common'
import { portalPage } from './portal-ui'
import type { GivingEnv } from './stripe'

type PortalDonor={id:string;name:string;email:string|null;sessionHash:string}
const unambiguous=`(SELECT COUNT(*) FROM cf_donors x WHERE x.email=? AND x.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=x.id))=1`
async function requestContext(env:GivingEnv,donor:PortalDonor){
 if(!donor.email||!await one({db:env.DB},`SELECT 1 WHERE ${unambiguous}`,donor.email))fail('portal_identity_ambiguous','Please ask the organization to record this request. This email address does not identify one current donor.',403)
 const now=Date.now()
 return {db:env.DB,now:new Date(now).toISOString(),actor:{id:'donor:'+donor.id,name:'Authenticated donor portal',role:'donor'},authority:{sql:`EXISTS(SELECT 1 FROM cf_donor_tokens t JOIN cf_donors d ON d.id=t.donor_id WHERE t.token_hash=? AND t.donor_id=? AND t.kind='session' AND t.used_at IS NULL AND t.expires_at>? AND d.erased_at IS NULL AND d.email=? AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)) AND ${unambiguous}`,params:[donor.sessionHash,donor.id,now,donor.email,donor.email]}}
}
/** The self-service door only strengthens a choice to an indefinite full stop.
 * It never clears a staff/imported/original choice or grants channel consent. */
export async function saveDonorRequest(env:GivingEnv,donor:PortalDonor,data:URLSearchParams){
 const c=await requestContext(env,donor)
 if(data.has('donorId')&&data.get('donorId')!==donor.id)fail('FORBIDDEN','Only your own donation request can be changed.',403)
 if(data.get('type')!=='stop'||data.get('confirm')!=='yes')fail('confirmation_required','Confirm that you do not want donation requests.',400)
 const version=integer(Number(data.get('version')),'Request version',0),current=await one(c,'SELECT * FROM cf_solicitation WHERE donor_id=?',donor.id)
 if((current?.version??0)!==version)fail('SOLICITATION_CHANGED','Your recorded choice changed. Reload this page before confirming.')
 const day=today((await settings(c)).timezone,new Date(c.now)),startsOn=current?.type==='stop'&&current.starts_on<day?current.starts_on:day,sourceRef=newId()
 const answer={type:'stop',startsOn,endsOn:null,channels:[],maxAsks:null,period:null,source:'portal',sourceRef,sourceOn:day,actorId:c.actor.id,actorName:c.actor.name,at:c.now}
 await commit(c,[guard('COALESCE((SELECT version FROM cf_solicitation WHERE donor_id=?),0)=?','SOLICITATION_CHANGED','Your recorded choice changed. Reload this page before confirming.',donor.id,version),
 sql(`INSERT INTO cf_solicitation(donor_id,version,type,starts_on,ends_on,channels,max_asks,source,source_ref,source_on,recorded_at,recorded_by_id,recorded_by_name,period) VALUES(?,?,'stop',?,NULL,'[]',NULL,'portal',?,?,?,?,?,'calendar-year')
 ON CONFLICT(donor_id) DO UPDATE SET version=excluded.version,type='stop',starts_on=excluded.starts_on,ends_on=NULL,channels='[]',max_asks=NULL,source='portal',source_ref=excluded.source_ref,source_on=excluded.source_on,recorded_at=excluded.recorded_at,recorded_by_id=excluded.recorded_by_id,recorded_by_name=excluded.recorded_by_name,period='calendar-year'`,donor.id,version+1,startsOn,sourceRef,day,c.now,c.actor.id,c.actor.name),
 sql('INSERT INTO cf_solicitation_history VALUES(?,?,?)',donor.id,version+1,JSON.stringify(answer)),event(c,'solicitation.set','donor',donor.id,donor.id,{...answer,version:version+1})])
}
export async function donorRequestPage(env:GivingEnv,donor:PortalDonor,saved=false){
 const c=await requestContext(env,donor);await commit(c,[])
 const current=await one(c,'SELECT version,type FROM cf_solicitation WHERE donor_id=?',donor.id)
 return portalPage('Donation requests',`<p>For ${e(donor.name)}.</p>${saved?'<p class="notice" role="status">Your do-not-solicit request is saved.</p>':''}${box('Do not ask me for donations',`<p>This stops donation requests across every channel. Gift receipts, annual statements and reminders for pledges you already made can still reach you under their separate permissions.</p>${current?.type==='stop'?'<p>A do-not-solicit choice is already recorded.</p>':''}<form method="post" action="/giving/portal/preferences">${hidden('version',current?.version??0)}${hidden('type','stop')}<label><input type="checkbox" name="confirm" value="yes" required> Do not ask me for donations.</label><button>Save do not solicit</button></form><p>To change another choice or resume donation requests, contact the organization. This page does not grant email, mail, phone or text permission.</p>`)}<p><a href="/giving/portal">Back to your giving account</a></p>`)
}

import { commit, event, fail, guard, newId, one, sql, today } from '../db'
import { settings } from '../settings'
import { box, e, hidden } from '../ui/common'
import { portalContext, type PortalDonor } from './portal-identity'
import { portalPage } from './portal-ui'
import type { GivingEnv } from './stripe'

export async function communicationPage(env:GivingEnv,donor:PortalDonor,saved=false,requested=false){
 const c=await portalContext(env,donor),current=await one(c,"SELECT * FROM cf_consents WHERE donor_id=? AND channel='email' ORDER BY id DESC LIMIT 1",donor.id)
 return portalPage('Email preferences',`${requested?'<p class="notice" role="status">Your request is with staff. Email permission stays unchanged until staff record your consent evidence.</p>':saved?'<p class="notice" role="status">Your email consent was withdrawn.</p>':''}${box('Email communications',`<p>For ${e(donor.name)}. Your current email permission is ${current?.status==='granted'?'granted':current?.status==='withdrawn'?'withdrawn':'not recorded'}.</p><p>Withdraw permission for email appeals and marketing. Gift receipts and copies you request are transactional and use their separate delivery rules.</p><form method="post" action="/giving/portal/communications">${hidden('version',current?.id??0)}${hidden('status','withdrawn')}${hidden('confirm','yes')}<button>Withdraw email consent</button></form>${current?.status!=='granted'?`<details><summary>Request email permission again</summary><p>Staff will review this request and record who agreed, when and how before enabling email appeals and marketing. Existing donation-request restrictions stay in place.</p><form method="post" action="/giving/portal/communications">${hidden('version',current?.id??0)}${hidden('status','regrant-request')}<label><input type="checkbox" name="confirm" value="yes" required> I want to receive email news and appeals again.</label><button>Request email regrant</button></form></details>`:''}`)}<p><a href="/giving/portal">Back to your giving account</a></p>`)
}
export async function withdrawEmail(env:GivingEnv,donor:PortalDonor,data:URLSearchParams){
 const c=await portalContext(env,donor)
 if(data.get('status')!=='withdrawn'||data.get('confirm')!=='yes'||(data.has('donorId')&&data.get('donorId')!==donor.id))fail('FORBIDDEN','This page only withdraws your own email permission.',403)
 const version=Number(data.get('version')),current=await one(c,"SELECT id,status FROM cf_consents WHERE donor_id=? AND channel='email' ORDER BY id DESC LIMIT 1",donor.id)
 if(!Number.isSafeInteger(version)||version!==(current?.id??0))fail('CONSENT_CHANGED','Your consent changed. Reload before confirming.',409)
 if(current?.status==='withdrawn')return
 const day=today((await settings(c)).timezone,new Date(c.now))
 await commit(c,[guard("COALESCE((SELECT MAX(id) FROM cf_consents WHERE donor_id=? AND channel='email'),0)=?",'CONSENT_CHANGED','Your consent changed. Reload before confirming.',donor.id,version),sql("INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by) VALUES(?,'email','withdrawn','portal','Explicit withdrawal in the authenticated donor portal',?,?,?)",donor.id,day,c.now,c.actor.name),event(c,'consent.record','donor',donor.id,donor.id,{channel:'email',status:'withdrawn',method:'portal'})])
}

/** A verified donor requests review; only the existing staff consent door grants permission. */
export async function requestEmailRegrant(env:GivingEnv,donor:PortalDonor,data:URLSearchParams){
 const c=await portalContext(env,donor)
 if(data.get('confirm')!=='yes')fail('CONFIRMATION_REQUIRED','Confirm your request for email news and appeals.',400)
 if(data.has('donorId')&&data.get('donorId')!==donor.id)fail('FORBIDDEN','Only your own email permission can be requested.',403)
 const version=Number(data.get('version')),current=await one(c,"SELECT id,status FROM cf_consents WHERE donor_id=? AND channel='email' ORDER BY id DESC LIMIT 1",donor.id)
 if(!Number.isSafeInteger(version)||version!==(current?.id??0))fail('CONSENT_CHANGED','Your consent changed. Reload before confirming.',409)
 if(current?.status==='granted')fail('CONSENT_CHANGED','Email permission is already granted.',409)
 const key='portal-consent-regrant:'+donor.id+':'+version
 if(await one(c,'SELECT id FROM cf_call_tasks WHERE source_key=?',key))return
 const taskId=newId(),day=today((await settings(c)).timezone,new Date(c.now)),owner="(SELECT id FROM oa_operators WHERE role='owner' AND status='active' ORDER BY id LIMIT 1)"
 await commit(c,[guard("COALESCE((SELECT MAX(id) FROM cf_consents WHERE donor_id=? AND channel='email'),0)=?",'CONSENT_CHANGED','Your consent changed. Reload before confirming.',donor.id,version),guard(owner+' IS NOT NULL','OWNER_CHANGED','Staff review is unavailable. Please contact the organization.'),
 sql(`INSERT OR IGNORE INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask) VALUES(?,?,?,'recovery',?,0,${owner},?,?,0)`,taskId,donor.id,key,'Verified donor requested email news and appeals again at '+c.now+'. Review their timeline request and record consent with who agreed, when and how. This task does not grant permission or authorize a solicitation.',day,c.now),
 sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) SELECT ?,?,?,?,'portal.consentRegrantRequested','donor',donor_id,donor_id,? FROM cf_call_tasks WHERE id=?`,c.now,c.actor.id,c.actor.name,c.actor.role,JSON.stringify({channel:'email',status:'pending',consentVersion:version,method:'verified email-link session',requestedBy:donor.id,requestedAt:c.now}),taskId)])
}

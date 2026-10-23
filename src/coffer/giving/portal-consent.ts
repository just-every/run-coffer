import { commit, event, fail, guard, one, sql, today } from '../db'
import { settings } from '../settings'
import { box, e, hidden } from '../ui/common'
import { portalContext, type PortalDonor } from './portal-identity'
import { portalPage } from './portal-ui'
import type { GivingEnv } from './stripe'

export async function communicationPage(env:GivingEnv,donor:PortalDonor,saved=false){
 const c=await portalContext(env,donor),current=await one(c,"SELECT * FROM cf_consents WHERE donor_id=? AND channel='email' ORDER BY id DESC LIMIT 1",donor.id)
 return portalPage('Email preferences',`${saved?'<p class="notice" role="status">Your email consent was withdrawn.</p>':''}${box('Email communications',`<p>For ${e(donor.name)}. Your current email permission is ${current?.status==='granted'?'granted':current?.status==='withdrawn'?'withdrawn':'not recorded'}.</p><p>Withdraw permission for email appeals and marketing. Gift receipts and copies you request are transactional and use their separate delivery rules.</p><form method="post" action="/giving/portal/communications">${hidden('version',current?.id??0)}${hidden('status','withdrawn')}${hidden('confirm','yes')}<button>Withdraw email consent</button></form><p>Contact the organization if you want to grant permission again.</p>`)}<p><a href="/giving/portal">Back to your giving account</a></p>`)
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

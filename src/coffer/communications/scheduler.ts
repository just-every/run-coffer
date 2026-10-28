import type { Bindings } from '../../auth.server'
import { type Context } from '../db'
import { emailConnection } from './connection'
import { syncPreferences } from './preferences'
import { releaseCompletedConstantContactLists } from './constant-contact-lists'
import { refreshMessages } from './outbound'
export async function runMarketingSync(env:Bindings,at:Date){
 const {connection,unavailable}=await emailConnection({db:env.DB,env})
 if(unavailable)return {unavailable}
 // Bound the automatic workload; explicit checks and send guards remain immediate.
 if(connection?.provider==='constant-contact'&&at.getUTCMinutes()%15!==0)return {skipped:true}
 const c:Context={db:env.DB,env,now:at.toISOString(),actor:{id:'coffer-scheduler',name:'Email preference sync',role:'owner'},authority:{sql:'EXISTS(SELECT 1 FROM cf_settings WHERE id=1)',params:[]}}
 const preferences=await syncPreferences(c,undefined,true)
 if(connection?.provider==='constant-contact')await releaseCompletedConstantContactLists(c,connection)
 return {preferences,results:await refreshMessages(c,undefined,true)}
}

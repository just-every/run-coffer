import type { Bindings } from '../../auth.server'
import { type Context } from '../db'
import { emailConnection } from './connection'
import { syncPreferences } from './preferences'
import { refreshMessages } from './outbound'
export async function runMarketingSync(env:Bindings,at:Date){
 const {unavailable}=await emailConnection({db:env.DB,env})
 if(unavailable)return {unavailable}
 const c:Context={db:env.DB,env,now:at.toISOString(),actor:{id:'coffer-scheduler',name:'Email preference sync',role:'owner'},authority:{sql:'EXISTS(SELECT 1 FROM cf_settings WHERE id=1)',params:[]}}
 return {preferences:await syncPreferences(c),results:await refreshMessages(c)}
}

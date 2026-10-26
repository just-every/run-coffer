import { commit, type Context } from '../db'
import { runGiftRules } from '../gift-rules'
import { syncPreferences } from '../communications/preferences'
import type { WriteOperation } from './writes'

/** Use the same post-commit doors as native commands. The atomic receipt owns
 * the record; replay reconciles current preferences or the durable once-only
 * gift-rule claim, never a second ledger insertion or an uncertain notice. */
export async function completeNativeEffects(c:Context,operation:WriteOperation,id:string){
 if(operation.command==='gift.record'){
  await commit(c,[])
  await runGiftRules(c.env!,id)
 }else if(operation.command==='consent.record'&&operation.input.channel==='email'){
  await commit(c,[])
  await syncPreferences(c,[id])
 }
}

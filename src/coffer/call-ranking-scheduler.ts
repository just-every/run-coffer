import { runtimeBindings, type Bindings } from '../auth.server'
import { automationContext } from './automation-grants'
import { rankCalls } from './call-ranking'
import { action } from './agent/activity'

export async function runCallRankingJob(original:Bindings,at:Date){
 const env=runtimeBindings(original),c=await automationContext(env,'calls',at.toISOString())
 if(!c)return
 try{await rankCalls(c)}catch(error){
  try{await action(c,{kind:'agent.job_held',subjectId:'calls',summary:'Weekly calls need attention.',why:error instanceof Error?error.message:'Review the call grant and source records.'})}catch{ /* A revoked grant also stops audit writes. */ }
 }
}

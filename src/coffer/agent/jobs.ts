import { runtimeBindings, type Bindings } from '../../auth.server'
import { action } from './activity'
import { automationContext, claimAutomation } from '../automation-grants'
import { runRecovery } from './recovery'
import { runReconciliation } from './reconciliation'
import { queueMissingReceipts } from './receipts'

/** Daily deterministic work needs no AI credential. Drafting is always person-triggered. */
export async function runAgentJobs(original:Bindings,at=new Date()) {
 const env=runtimeBindings(original)
 const jobs=[['reconciliation',runReconciliation],['recovery',runRecovery],['receipts',queueMissingReceipts]] as const
 await Promise.all(jobs.map(async ([name,run])=>{
  const c=await automationContext(env,name,at.toISOString())
  if(!c)return
  try {
   if(name==='reconciliation')await claimAutomation(c,'reconciliation.run')
   await run(c,env)
  } catch(error) {
   try { await action(c,{kind:'agent.job_held',subjectId:name,summary:'Scheduled job needs attention.',why:error instanceof Error?error.message:'Review the job before running it again.'}) } catch { /* Revocation also prevents further agent audit writes. */ }
  }
 }))
}

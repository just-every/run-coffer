import { runtimeBindings, type Bindings } from '../../auth.server'
import { action, systemContext } from './activity'
import { runRecovery } from './recovery'
import { runReconciliation } from './reconciliation'
import { queueMissingReceipts } from './receipts'

/** Daily deterministic work needs no AI credential. Drafting is always person-triggered. */
export async function runAgentJobs(original:Bindings,at=new Date()) {
 const env=runtimeBindings(original),c=systemContext(env.DB,env,at.toISOString())
 const results=await Promise.allSettled([
  runReconciliation(c,env),runRecovery(c,env),queueMissingReceipts(c),
 ])
 for(let i=0;i<results.length;i++) {
  const result=results[i]
  if(result.status==='rejected')await action(c,{kind:'agent.job_held',subjectId:['reconciliation','recovery','receipts'][i],summary:'Scheduled job needs attention.',why:typeof result.reason?.code==='string'?String(result.reason.message):'The job could not complete. Review its page before running it again.'})
 }
}

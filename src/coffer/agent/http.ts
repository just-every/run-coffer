import { manager } from '../auth'
import { commit, fail, id, one, sql, type Context, type Row } from '../db'
import { page, box, e, empty, hidden } from '../ui/common'
import type { GivingEnv } from '../giving/stripe'
import { managed } from '../giving/stripe'
import { activity, action } from './activity'
import { recoveryData, recoveryAction, runRecovery } from './recovery'
import { recoveryPage } from './recovery-ui'
import { reconciliationData, runReconciliation, applyReconciliation, undoReconciliation } from './reconciliation'
import { reconciliationPage } from './reconciliation-ui'
import { missingReceipts, queueMissingReceipts, receiptAgentPage, undoReceiptQueue } from './receipts'
import { stewardshipState, stewardshipCommand } from './stewardship'
import { setupPage, stewardshipPage } from './stewardship-ui'

const json=(v:unknown)=>Response.json(v,{headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}})
const redirect=(path:string)=>new Response(null,{status:303,headers:{location:path,'cache-control':'no-store'}})
export async function agentResponse(request:Request,c:Context,env:GivingEnv,body:()=>Promise<Row>):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname,api=path.startsWith('/api/')
 if (!/^\/(app|api\/coffer)\/agent(?:\/|$)/.test(path)) return null
 if (!manager(c.actor)) fail('FORBIDDEN','Only the owner or an admin can use the development agent.',403)
 const prefix=api?'/api/coffer/agent':'/app/agent',tail=path.slice(prefix.length)
 if (request.method==='GET' || request.method==='HEAD') {
  if(api) {
   if(tail==='/stewardship')return json(await stewardshipState(c,url.searchParams.get('donorId')??undefined))
   if(tail==='')return json({reconciliation:await reconciliationData(c),recovery:await recoveryData(c),missingReceipts:await missingReceipts(c),activity:await activity(c)})
   fail('NOT_FOUND','That agent page does not exist.',404)
  }
  let content:string,title:string
  if(tail==='/setup'){title='Agent AI setup';content=await setupPage(c)}
  else if(tail==='/stewardship'){title='Draft stewardship';content=await stewardshipPage(c,url)}
  else if(tail==='/reconcile'){title='Reconcile gifts';content=await reconciliationPage(c)}
  else if(tail==='/recovery'){title='Recover monthly gifts';content=await recoveryPage(c)}
  else if(tail==='/receipts'){title='Find missing receipts';content=await receiptAgentPage(c)}
  else if(tail==='') {title='Development agent';content=await overview(c,env)}
  else return fail('NOT_FOUND','That agent page does not exist.',404)
  return page(title,nav()+content,c.actor,200,'/app/agent')
 }
 if(request.method!=='POST')fail('METHOD','Use the agent page buttons.',405)
 const p=await body();let result:any,back='/app/agent'
 if(tail==='/reconcile/run'){result=await runReconciliation(c,env);back='/app/agent/reconcile'}
 else if(tail==='/reconcile/apply'){result=await applyReconciliation(c,env,p);back='/app/agent/reconcile'}
 else if(tail==='/reconcile/undo'){result=await undoReconciliation(c,p);back='/app/agent/reconcile'}
 else if(tail==='/recovery/run'){result=await runRecovery(c,env);back='/app/agent/recovery'}
 else if(tail==='/recovery/action'){result=await recoveryAction(c,env,p);back='/app/agent/recovery'}
 else if(tail==='/receipts/queue'){result=await queueMissingReceipts(c);back=result.id?'/app/letters/'+result.id:'/app/agent/receipts'}
 else if(tail==='/activity/undo'){result=await undoActivity(c,env,p)}
 else if(tail.startsWith('/stewardship/')) {
  const command=tail.split('/').at(-1)!
  if(!['setup','test','draft','save','send','discard','restore'].includes(command))fail('NOT_FOUND','Unknown stewardship action.',404)
  result=await stewardshipCommand(c,command as any,p)
  back=['setup','test'].includes(command)?'/app/agent/setup':'/app/agent/stewardship'+(p.donorId?'?donorId='+encodeURIComponent(p.donorId):'')
 } else fail('NOT_FOUND','Unknown agent action.',404)
 return api?json(result):redirect(back)
}
const nav=()=>`<p class="actions"><a href="/app/agent">Activity</a><a href="/app/agent/reconcile">Reconcile</a><a href="/app/agent/recovery">Monthly recovery</a><a href="/app/agent/receipts">Missing receipts</a><a href="/app/agent/stewardship">Stewardship</a><a href="/app/agent/setup">AI setup</a></p>`
async function overview(c:Context,env:GivingEnv) {
 const records=await activity(c)
 return `<p>Reconcile gifts, follow failed monthly plans, prepare missing receipts and draft personal stewardship. Every proposal keeps its sources and reason. People approve corrections, receipts and messages.</p>${managed(env)?'<p class="notice">Provider integrations are not available yet on RER Managed.</p>':''}<ul class="tiles"><li><a href="/app/agent/reconcile"><strong>Reconcile gifts</strong><span>Compare Stripe, the gift ledger and Pantry; review, apply and undo corrections.</span></a></li><li><a href="/app/agent/recovery"><strong>Recover monthly gifts</strong><span>Private card-update email, Stripe retry schedule and recovered or lapsed outcomes.</span></a></li><li><a href="/app/agent/receipts"><strong>Find missing receipts</strong><span>Prepare missing and bounced receipts for a person to approve.</span></a></li><li><a href="/app/agent/stewardship"><strong>Draft from donor history</strong><span>Gifts, funds, conversations and tributes, with sources to review before sending.</span></a></li></ul>${box('Agent activity',records.length?`<ul class="list">${records.map(a=>`<li><strong>${e(a.summary)}</strong><br>${e(a.actor_name)} · ${e(a.at)}<p>${e(a.why)}</p><code>${e(a.subject_id)}</code>${a.undone_at?'<p class="muted">Undone '+e(a.undone_at)+'</p>':a.undo_kind?`<form method="post" action="/app/agent/activity/undo">${hidden('id',a.id)}<button class="secondary">Undo this action</button></form>`:''}</li>`).join('')}</ul>`:empty('No agent actions yet. Start with one of the jobs above.'))}`
}
async function undoActivity(c:Context,env:GivingEnv,p:Row) {
 const key=id(p.id,'Activity'),a=await one(c,'SELECT * FROM cf_agent_activity WHERE id=?',key)
 if(!a?.undo_kind || a.undone_at)fail('UNDO_UNAVAILABLE','This action has no pending undo. External emails and settled charges cannot be recalled.')
 const data=JSON.parse(a.undo_data??'{}')
 if(a.undo_kind==='recovery.schedule')await recoveryAction(c,env,{...data,why:'Undo requested for activity '+key})
 else if(a.undo_kind==='receipts.discard')await undoReceiptQueue(c,data.batchId)
 else if(a.undo_kind==='stewardship.discard'||a.undo_kind==='stewardship.restore')await stewardshipCommand(c,a.undo_kind.split('.')[1],data)
 else if(a.undo_kind==='reconciliation')await undoReconciliation(c,{id:a.subject_id})
 else fail('UNDO_UNAVAILABLE','Open the source record to use its current undo controls.')
 await commit(c,[sql('UPDATE cf_agent_activity SET undone_at=? WHERE id=? AND undone_at IS NULL',c.now,key)])
 await action(c,{kind:'agent.undo',subjectId:key,summary:'Undid the selected agent action.',why:'An owner or admin requested its compensating action.'})
 return {undone:key}
}

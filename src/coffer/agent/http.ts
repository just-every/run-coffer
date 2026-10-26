import { developmentFollowups, runDevelopmentFollowups, approveDevelopmentReminder, recordDevelopmentReply, resolveDevelopmentFollowup } from '../pledge-followups'
import { developmentFollowupsPage } from '../ui/development-followups'
import { recoveryNoticeState, recoveryNoticeAction } from './recovery-policy'
import { receiptAutonomyState, saveReceiptAutonomy, runReceiptAutonomy, recoverReceiptStatement } from './receipt-autonomy'
import { receiptAutonomyPanel } from './receipts-ui'
import { automationGrants, saveAutomationGrant } from '../automation-grants'
import { automationGrantPanel } from './grants-ui'
import { reconcileJourney, prepareJourneyResend } from './journey-delivery'
import { appealDelivery, deliveryState, reconcileAppeal, prepareResend } from './appeals'
import { appealAgentPage } from './appeals-ui'
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
import { missingReceipts, queueMissingReceipts, undoReceiptQueue } from './receipts'
import { receiptAgentPage } from './receipts-ui'
import { activityTable } from './activity-ui'
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
   if(tail==='/followups')return json(await developmentFollowups(c))
   if(tail==='/recovery/notices')return json(await recoveryNoticeState(c))
   if(tail==='/receipts/settings')return json(await receiptAutonomyState(c))
   if(tail==='/grants')return json(await automationGrants(c))
   if(tail==='/appeals')return json(url.searchParams.get('appealId')?await appealDelivery(c,url.searchParams.get('appealId')!):await deliveryState(c))
   if(tail==='/stewardship')return json(await stewardshipState(c,url.searchParams.get('donorId')??undefined))
   if(tail==='')return json({reconciliation:await reconciliationData(c),recovery:await recoveryData(c),missingReceipts:await missingReceipts(c),activity:await activity(c)})
   fail('NOT_FOUND','That agent page does not exist.',404)
  }
  let content:string,title:string
  if(tail==='/followups'){title='Follow commitments';content=await developmentFollowupsPage(c)}
  else if(tail==='/grants'){title='Background agent grants';content=await automationGrantPanel(c)}
  else if(tail==='/setup'){title='Agent AI setup';content=await setupPage(c)}
  else if(tail==='/stewardship'){title='Draft stewardship';content=await stewardshipPage(c,url)}
  else if(tail==='/reconcile'){title='Reconcile gifts';content=await reconciliationPage(c)}
  else if(tail==='/recovery'){title='Recover monthly gifts';content=await recoveryPage(c)}
  else if(tail==='/appeals'){title='Check appeal delivery';content=await appealAgentPage(c,url)}
  else if(tail==='/receipts'){title='Find missing receipts';content=await receiptAgentPage(c,url)+await receiptAutonomyPanel(c)}
  else if(tail==='/receipts/settings'){title='Receipt standing approval';content=await receiptAutonomyPanel(c)}
  else if(tail==='') {title='Development agent';content=await overview(c,env,url)}
  else return fail('NOT_FOUND','That agent page does not exist.',404)
  return page(title,nav()+content,c.actor,200,'/app/agent')
 }
 if(request.method!=='POST')fail('METHOD','Use the agent page buttons.',405)
 const p=await body();let result:any,back='/app/agent'
 if(tail==='/followups/run'){result=await runDevelopmentFollowups(c);back='/app/agent/followups'}
 else if(tail==='/followups/approve'){result=await approveDevelopmentReminder(c,p);back='/app/agent/followups'}
 else if(tail==='/followups/reply'){result=await recordDevelopmentReply(c,p);back='/app/agent/followups'}
 else if(tail==='/followups/resolve'){result=await resolveDevelopmentFollowup(c,p);back='/app/agent/followups'}
 else if(tail==='/recovery/notice-action'){result=await recoveryNoticeAction(c,p);back='/app/agent/recovery'}
 else if(tail==='/receipts/settings'){result=await saveReceiptAutonomy(c,p);back='/app/agent/receipts'}
 else if(tail==='/receipts/run'){result=await runReceiptAutonomy(c);back='/app/agent/receipts'}
 else if(tail==='/receipts/statements/recover'){result=await recoverReceiptStatement(c,p);back='/app/agent/receipts'}
 else if(tail==='/grants'){result=await saveAutomationGrant(c,p);back='/app/agent/grants'}
 else if(tail==='/appeals/run'){result=await reconcileAppeal(c,p);back='/app/agent/appeals?appealId='+encodeURIComponent(p.appealId)}
 else if(tail==='/appeals/journey/run'){result=await reconcileJourney(c,p);back='/app/agent/appeals'}
 else if(tail==='/appeals/journey/prepare'){result=await prepareJourneyResend(c,p);back='/app/appeals/'+result.id}
 else if(tail==='/appeals/prepare'){result=await prepareResend(c,p);back='/app/appeals/'+result.id}
 else if(tail==='/reconcile/run'){result=await runReconciliation(c,env);back='/app/agent/reconcile'}
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
const nav=()=>`<p class="actions"><a href="/app/agent">Activity</a><a href="/app/agent/reconcile">Reconcile</a><a href="/app/agent/recovery">Monthly recovery</a><a href="/app/agent/followups">Commitments</a><a href="/app/agent/receipts">Missing receipts</a><a href="/app/agent/appeals">Appeal delivery</a><a href="/app/agent/stewardship">Stewardship</a><a href="/app/agent/setup">AI setup</a><a href="/app/agent/grants">Background grants</a></p>`
async function overview(c:Context,env:GivingEnv,url:URL) {
  return `<p>Reconcile gifts, follow failed monthly plans, prepare missing receipts and draft personal stewardship. Every proposal keeps its sources and reason. People approve corrections, receipts and messages.</p>${managed(env)?'<p class="notice">Provider integrations are not available yet on RER Managed.</p>':''}<ul class="tiles"><li><a href="/app/agent/followups"><strong>Follow commitments</strong><span>Approve overdue installment, grant report and matching-gift reminders; record their outcomes.</span></a></li><li><a href="/app/agent/reconcile"><strong>Reconcile gifts</strong><span>Compare Stripe, the gift ledger and Pantry; review, apply and undo corrections.</span></a></li><li><a href="/app/agent/recovery"><strong>Recover monthly gifts</strong><span>Private card-update email, Stripe retry schedule and recovered or lapsed outcomes.</span></a></li><li><a href="/app/agent/receipts"><strong>Find missing receipts</strong><span>Prepare missing and bounced receipts for a person to approve.</span></a></li><li><a href="/app/agent/stewardship"><strong>Draft from donor history</strong><span>Gifts, funds, conversations and tributes, with sources to review before sending.</span></a></li></ul>${await activityTable(c,url)}`
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

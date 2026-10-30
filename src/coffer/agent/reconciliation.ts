import { manager } from '../auth'
import { automated } from '../automation-grants'
import { all, commit, event, fail, guard, newId, one, sql, text, type Context, type Row, type Stmt, today } from '../db'
import { available, managed, stripe } from '../giving/stripe'
import { stripePages } from '../payments/stripe-data'
import { syncCharge } from '../payments/charges'
import { settings } from '../settings'
import { payoutDetail } from '../payments/payouts'
import { payoutJournal } from '../payments/exports'
import { reconciliationPosting, type PaymentsEnv } from '../payments/pantry'
import { activityStatement } from './activity'
import { quickbooksKinds, scanQuickbooks } from './reconcile-quickbooks'
import { chargeFinding, fingerprint, type Correction, type Finding } from './reconcile-scan'

function authorize(c: Context, scheduled = false) {
 if (!manager(c.actor) && !(scheduled && automated(c) && c.automation.id === 'reconciliation')) fail('FORBIDDEN','Only the owner or an admin can reconcile giving.',403)
}
export async function reconciliationData(c: Context) {
 const rows = await all(c,`SELECT * FROM cf_agent_issues WHERE (?=1 OR kind NOT LIKE 'quickbooks_%') ORDER BY CASE state WHEN 'open' THEN 0 ELSE 1 END,found_at DESC,id DESC LIMIT 100`,c.actor.role==='owner'?1:0)
 return { quickbooksRun:c.actor.role==='owner'?await one(c,"SELECT * FROM cf_agent_runs WHERE job='reconciliation.quickbooks'"):null, lastRun:await one(c,"SELECT * FROM cf_agent_runs WHERE job='reconciliation'"), issues:rows.map((r):Row=>({...r,evidence:JSON.parse(r.evidence),proposed:JSON.parse(r.proposed)})) }
}
async function save(c: Context, finding: Finding) {
 const hash=await fingerprint(finding)
 await commit(c,[sql(`INSERT INTO cf_agent_issues(id,source_id,kind,state,summary,why,evidence,proposed,fingerprint,found_at)
  VALUES(?,?,?,'open',?,?,?,?,?,?) ON CONFLICT(source_id,kind) WHERE state='open' DO UPDATE SET
  summary=excluded.summary,why=excluded.why,evidence=excluded.evidence,proposed=excluded.proposed,fingerprint=excluded.fingerprint,found_at=excluded.found_at`,
  newId(),finding.sourceId,finding.kind,finding.summary,finding.why,JSON.stringify(finding.evidence),JSON.stringify(finding.proposed),hash,c.now)])
}
async function observed(c: Context, sourceId:string, kinds:string[], findings:Finding[]) {
 await commit(c,[sql(`UPDATE cf_agent_issues SET state='resolved' WHERE state='open' AND source_id=? AND kind IN (SELECT value FROM json_each(?)) AND kind NOT IN (SELECT value FROM json_each(?))`,sourceId,JSON.stringify(kinds),JSON.stringify(findings.map(f=>f.kind)))])
 for(const finding of findings) await save(c,finding)
}
const review=(sourceId:string,kind:string,summary:string,why:string,evidence:Row,detail:string):Finding=>({sourceId,kind,summary,why,evidence,proposed:{action:'review',detail}})

async function* authorizedPages(c:Context,env:PaymentsEnv,path:string) {
 const pages=stripePages(env,path)[Symbol.asyncIterator]()
 for(;;) { await commit(c,[]);const next=await pages.next();if(next.done)return;yield next.value }
}

/** Rules are useful without AI. An incomplete provider read never claims a clean run. */
export async function runReconciliation(c:Context,env:PaymentsEnv) {
 authorize(c,true)
 let checkedCharges=0,checkedPayouts=0
 const unavailable:string[]=[],errors:string[]=[]
 if (available(env)) {
  try {
   for await(const charge of authorizedPages(c,env,'/charges')) {
    const finding=await chargeFinding(c,charge,env)
    await observed(c,charge.id,['contribution','missing_gift','currency','invalid_charge'],finding?[finding]:[])
    checkedCharges++
   }
  } catch { errors.push('Stripe charge enumeration was incomplete; run again after checking the connection.') }
  try {
   for await(const remote of authorizedPages(c,env,'/payouts')) {
    const local=await one(c,'SELECT * FROM cf_payouts WHERE id=?',remote.id), findings:Finding[]=[]
    if (!local) findings.push(review(remote.id,'missing_payout','Stripe payout is missing from Coffer.','Provider payout facts have no saved payout record.',{stripe:{id:remote.id,amount:remote.amount,currency:remote.currency,status:remote.status}},'Sync this payout in Payments; exact balance transaction membership is required before any deposit posting.'))
    else if(local.amount_cents!==remote.amount || local.currency!==remote.currency || local.status!==remote.status) findings.push(review(remote.id,'payout_provider','Saved payout differs from Stripe.','Provider amount, currency or status changed.',{saved:{id:local.id,amount:local.amount_cents,currency:local.currency,status:local.status},stripe:{amount:remote.amount,currency:remote.currency,status:remote.status}},'Review Stripe and refresh Payments. An immutable deposit must never be replaced with a guessed amount.'))
    await observed(c,remote.id,['missing_payout','payout_provider'],findings); checkedPayouts++
   }
  } catch { errors.push('Stripe payout enumeration was incomplete; run again after checking the connection.') }
 } else unavailable.push(managed(env)?'Stripe and Pantry are not available yet on RER Managed.':'Stripe is not connected. Cached ledger and payout consistency checks still ran.')
 for(const payout of await all(c,'SELECT id FROM cf_payouts ORDER BY id')) {
  const view=await payoutDetail(c,payout.id),findings:Finding[]=[],p=view.payout
  if(!p.complete || p.matched_cents!==p.amount_cents) findings.push(review(p.id,'payout_balance','Payout membership does not reconcile.','Exact saved balance transaction net amounts must equal the provider payout.',{payoutId:p.id,amount:p.amount_cents,matched:p.matched_cents,complete:p.complete,entryIds:view.lines.map(l=>l.id)},'Review exact Stripe balance IDs in Payments. No balancing deposit will be invented.'))
  const invalid=view.lines.filter(l=>l.amount_cents-l.fee_cents!==l.net_cents)
  if(invalid.length) findings.push(review(p.id,'fee_balance','Payout fees and net amounts do not balance.','Each processor entry must satisfy gross less fees equals net.',{payoutId:p.id,entryIds:invalid.map(l=>l.id)},'Review the processor facts; an accounting discrepancy cannot change immutable Stripe money.'))
  if(p.complete && p.matched_cents===p.amount_cents && p.status==='paid') {
   try { payoutJournal(view,env) } catch { findings.push(review(p.id,'posting_mapping','Payout accounting needs review.','The payout cannot form a valid journal with the current account mapping.',{payoutId:p.id,entryIds:view.lines.map(l=>l.id)},'Set the deposit, fee and fund accounts in Payments, then submit the evidence-backed journal for Pantry approval.')) }
  }
  if(!view.posting && p.complete && p.status==='paid') findings.push(review(p.id,'pantry_posting','Payout has no saved Pantry submission.','A reconciled Stripe payout is not proof of a posted Pantry journal.',{payoutId:p.id,entryIds:view.lines.map(l=>l.id)},'Upload exact payout evidence and submit the mapped journal through Payments, then approve it in Pantry.'))
  if(view.posting && !managed(env)) {
   try {
    const posting=await reconciliationPosting(c,env,p.id)
    if(posting && posting.state!=='posted') findings.push(review(p.id,'pantry_posting','Pantry payout is awaiting resolution.',`Saved submission is ${posting.state}; a proposal is not a posted deposit.`,{payoutId:p.id,proposalId:posting.proposal_id,state:posting.state},'Review and approve the exact proposal in Pantry. Coffer will refresh its status without submitting it again.'))
   } catch { findings.push(review(p.id,'pantry_posting','Pantry posting could not be verified.','The saved proposal payload, status or journal could not be confirmed against Pantry.',{payoutId:p.id,proposalId:view.posting.proposal_id,externalId:view.posting.external_id},'Review this exact proposal in Pantry; do not create another deposit.')) }
  }
  await observed(c,p.id,['payout_balance','fee_balance','posting_mapping','pantry_posting'],findings)
 }
 const summary={checkedCharges,checkedPayouts,unavailable,errors}
 const activity=activityStatement(c,{kind:'reconciliation.run',subjectId:'reconciliation',summary:`Checked ${checkedCharges} Stripe charges and ${checkedPayouts} Stripe payouts; ${errors.length} provider reads incomplete.`,why:[...unavailable,...errors,'Cached payout, fee and accounting checks require no AI key.'].join(' ')})
 await commit(c,[sql("INSERT INTO cf_agent_runs(job,at,summary) VALUES('reconciliation',?,?) ON CONFLICT(job) DO UPDATE SET at=excluded.at,summary=excluded.summary",c.now,JSON.stringify(summary)),activity.statement])
 return {...summary,...await reconciliationData(c)}
}
/** Owner review is distinct from existing scheduled checks and accounting writes. */
export async function runQuickbooksReconciliation(c: Context, env: PaymentsEnv) {
 const { observations, ...summary } = await scanQuickbooks(c, env)
 for (const observation of observations) {
  if (observation.complete) await observed(c, observation.sourceId, quickbooksKinds, observation.findings)
  else for (const finding of observation.findings) await save(c, finding)
 }
 const activity = activityStatement(c, { kind: 'reconciliation.quickbooks', subjectId: 'quickbooks', summary: `Checked ${summary.checkedSources} QuickBooks sources and ${summary.checkedDocuments} documents; comparison ${summary.complete ? 'complete' : 'incomplete'}.`, why: 'Independent reads only. Existing accounting approvals and uncertain-result recovery remain in Payments.' })
 await commit(c, [sql("INSERT INTO cf_agent_runs(job,at,summary) VALUES('reconciliation.quickbooks',?,?) ON CONFLICT(job) DO UPDATE SET at=excluded.at,summary=excluded.summary", c.now, JSON.stringify(summary)), activity.statement])
 return { ...summary, ...await reconciliationData(c) }
}
function contribution(c:Context,proposal:Row,change:Correction,id:string):Stmt {
 return sql(`INSERT INTO cf_payment_entries(id,source_id,charge_id,kind,amount_cents,fee_cents,net_cents,fund,gift_id,contribution_cents,currency,received_on,created_at)
  VALUES(?,?,?,'reconciliation',0,0,0,?,?,?,'usd',?,?)`,id,id,proposal.chargeId,change.fund,proposal.giftId,change.cents,proposal.receivedOn,c.now)
}
export async function applyReconciliation(c:Context,env:PaymentsEnv,input:Row) {
 authorize(c)
 const id=text(input.id,'Issue ID',100),issue=await one(c,'SELECT * FROM cf_agent_issues WHERE id=?',id)
 if(!issue || issue.state!=='open') fail('ISSUE_CHANGED','This issue is no longer open. Run reconciliation again.')
 if(!['contribution','missing_gift'].includes(issue.kind)) fail('REVIEW_REQUIRED','This discrepancy requires review in Payments, QuickBooks or Pantry; no safe automatic correction is available.')
 const current=await chargeFinding(c,await stripe(env,'/charges/'+encodeURIComponent(issue.source_id)),env)
 if(!current || current.proposed.action==='review' || await fingerprint(current)!==issue.fingerprint) fail('ISSUE_CHANGED','Stripe or the contribution ledger changed. Run reconciliation again before applying.')
 if(issue.kind==='missing_gift') {
  const existing=new Set((await all(c,"SELECT id FROM cf_gifts WHERE source='stripe' AND kind='gift'")).map(row=>row.id))
  const linked=await syncCharge(env,issue.source_id,c)
  if(!linked) fail('ISSUE_CHANGED','This charge is no longer a successful gift.')
  const created=!existing.has(linked.gift_id)
  const activity=activityStatement(c,{kind:'reconciliation.applied',subjectId:id,summary:created?'Recorded the verified missing Stripe gift.':'Linked Stripe to the existing gift; no contribution was created.',why:current.why,...(created?{undoKind:'reconciliation',undoData:{issueId:id,type:'missing_gift',giftId:linked.gift_id}}:{})})
  await commit(c,[guard("EXISTS(SELECT 1 FROM cf_agent_issues WHERE id=? AND state='open' AND fingerprint=?)",'ISSUE_CHANGED','This issue changed. Refresh reconciliation.',id,issue.fingerprint),activity.statement,sql("UPDATE cf_agent_issues SET state=?,applied_at=?,activity_id=? WHERE id=?",created?'applied':'resolved',c.now,activity.id,id),event(c,'reconciliation.applied','agent',id,null)])
  return {id,state:created?'applied':'resolved',activityId:activity.id,giftId:linked.gift_id}
 }
 const p=current.proposed,entries=(p.changes as Correction[]).map(change=>({id:newId(),...change}))
 const activity=activityStatement(c,{kind:'reconciliation.applied',subjectId:id,summary:issue.summary,why:current.why,undoKind:'reconciliation',undoData:{issueId:id,proposal:p,entries}})
 await commit(c,[guard("EXISTS(SELECT 1 FROM cf_agent_issues WHERE id=? AND state='open' AND fingerprint=?)",'ISSUE_CHANGED','This issue changed. Refresh reconciliation.',id,issue.fingerprint),
  guard('(SELECT COUNT(*) FROM cf_payment_entries WHERE gift_id=?)=? AND (SELECT COUNT(*) FROM cf_gifts WHERE reverses=?)=?','ISSUE_CHANGED','The contribution ledger changed. Run reconciliation again.',p.giftId,current.evidence.entries.length,p.giftId,current.evidence.reversals.length),
  guard('EXISTS(SELECT 1 FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=? AND d.erased_at IS NULL)','ISSUE_CHANGED','This donor is no longer available.',p.giftId),
  ...entries.map(entry=>contribution(c,p,entry,entry.id)),activity.statement,
  sql("UPDATE cf_agent_issues SET state='applied',applied_at=?,activity_id=? WHERE id=?",c.now,activity.id,id),event(c,'reconciliation.applied','agent',id,null)])
 return {id,state:'applied',activityId:activity.id}
}
export async function undoReconciliation(c:Context,input:Row) {
 authorize(c)
 const id=text(input.id,'Issue ID',100),issue=await one(c,'SELECT * FROM cf_agent_issues WHERE id=?',id)
 if(!issue || issue.state!=='applied') fail('ISSUE_CHANGED','Only an applied reconciliation correction can be undone.')
 const original=await one(c,"SELECT * FROM cf_agent_activity WHERE id=? AND undo_kind='reconciliation' AND undone_at IS NULL",issue.activity_id)
 if(!original) fail('ISSUE_CHANGED','This correction has already been undone.')
 const saved=JSON.parse(original.undo_data),activity=activityStatement(c,{kind:'reconciliation.undone',subjectId:id,summary:'Undid contribution reconciliation with compensating entries.',why:'The original correction and all provider money remain in the immutable ledger.'})
 let compensation:Stmt[]
 if(saved.type==='missing_gift') {
  const gift=await one(c,"SELECT * FROM cf_gifts WHERE id=? AND kind='gift'",saved.giftId)
  if(!gift) fail('ISSUE_CHANGED','The recorded gift is no longer available.')
  const on=today((await settings(c)).timezone)
  compensation=[guard('NOT EXISTS(SELECT 1 FROM cf_gifts WHERE reverses=?)','ALREADY_REVERSED','This gift has already been reversed.',gift.id),
   guard('NOT EXISTS(SELECT 1 FROM cf_payment_entries WHERE gift_id=? AND contribution_cents<>0)','PROCESSOR_ADJUSTMENT','Stripe has adjusted this gift. Review its contribution corrections before reversing it.',gift.id),
   guard("NOT EXISTS(SELECT 1 FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.gift_id=? AND a.live=1 AND b.status IN ('prepared','approved'))",'IN_ACKNOWLEDGEMENT','Discard the acknowledgement batch holding this gift before reversing it.',gift.id),
   sql("INSERT INTO cf_gifts VALUES(?,1,?,'reversal',?,?,?,?,NULL,?,?,'none',0,NULL,?,'manual',?,?)",newId(),gift.donor_id,gift.id,on,-gift.amount_cents,gift.method,gift.fund,gift.pledge_id,'Undo missing Stripe gift reconciliation',c.now,c.actor.name)]
 } else compensation=saved.entries.map((entry:Correction)=>contribution(c,saved.proposal,{fund:entry.fund,cents:-entry.cents},newId()))
 await commit(c,[guard("EXISTS(SELECT 1 FROM cf_agent_issues WHERE id=? AND state='applied') AND EXISTS(SELECT 1 FROM cf_agent_activity WHERE id=? AND undone_at IS NULL)",'ISSUE_CHANGED','This correction has already changed.',id,original.id),
  ...compensation,activity.statement,
  sql('UPDATE cf_agent_activity SET undone_at=? WHERE id=?',c.now,original.id),sql("UPDATE cf_agent_issues SET state='undone' WHERE id=?",id),event(c,'reconciliation.undone','agent',id,null)])
 return {id,state:'undone'}
}

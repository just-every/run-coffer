import { communicationReasons } from './communications/preference-rules'
import { requireRole } from './auth'
import { automated, automationRecords, claimAutomation } from './automation-grants'
import { addDays, all, CofferError, commit, daysBetween, event, fail, guard, id, integer, newId, one, sql, today, type Context, type Row, type Stmt } from './db'
import { fiscalPeriod } from './giving-summary'
import { usd } from './money'
import { settings } from './settings'
import { prepareSolicitationRun, solicitationRunGuards, solicitationState } from './solicitation'
import { phoneHolds } from './solicitation-tasks'

const activeOwner = "(SELECT id FROM oa_operators WHERE status='active' AND role='owner' ORDER BY id LIMIT 1)"
const relationshipManager = `COALESCE((SELECT p.manager_id FROM cf_portfolio_members m JOIN cf_portfolios p ON p.id=m.portfolio_id WHERE m.donor_id=d.id),${activeOwner})`
const scoring = { reply:100, pledge:80, lapse:70, upgrade:60, silent:40, anniversary:30 }
const countReason = (counts:Row,why:string) => { counts[why]=(counts[why]??0)+1 }
const restricted = (r:Row) => r.active || r.inherited?.some((s:Row)=>s.active)
const policy = (c:Context) => one(c,'SELECT call_rank_policy_version AS version,call_outcome_days AS windowDays FROM cf_settings WHERE id=1').then(r=>r!)
export async function callRankPolicy(c:Context) {
 requireRole(c.actor,['owner','admin'],'read call ranking settings')
 return policy(c)
}
export async function saveCallRankPolicy(c:Context,p:Row) {
 requireRole(c.actor,['owner','admin'],'change call ranking settings')
 const version=integer(Number(p.version),'Version',1),windowDays=integer(Number(p.windowDays),'Outcome window days',1,3650)
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND call_rank_policy_version=?)','VERSION','Call ranking settings changed. Refresh before saving.',version),
  sql('UPDATE cf_settings SET call_outcome_days=?,call_rank_policy_version=call_rank_policy_version+1 WHERE id=1',windowDays),event(c,'calls.policy','settings','call-ranking',null,{windowDays,version:version+1})])
 return policy(c)
}

/** One ordered, scoped source projection is read again inside the write batch.
 * New gifts, replies, payments, assignments, contacts and consent all invalidate
 * stale scores. No source notes, research, message bodies or inferred wealth. */
function sourceQuery(c:Context,managerId:string,day:string) {
 const scope=automationRecords(c,'d.id')
 return {query:`SELECT json_object('id',d.id,'name',d.name,'version',d.version,'status',d.constituent_status,
  'permissionId',k.id,'permission',k.status,'manager',${relationshipManager},
  'ledger',json((SELECT json_group_array(json_object('id',id,'on',received_on,'cents',amount_cents)) FROM
   (SELECT id,received_on,amount_cents FROM cf_contribution_ledger WHERE donor_id=d.id AND received_on<=? AND kind IN ('gift','reversal') ORDER BY received_on,id))),
  'gifts',json((SELECT json_group_array(json_object('id',id,'on',received_on,'cents',net_cents)) FROM
   (SELECT id,received_on,net_cents FROM cf_gift_balances WHERE donor_id=d.id AND received_on<=? AND net_cents>0 ORDER BY received_on,id))),
  'contacts',json((SELECT json_group_array(json_object('id',id,'on',occurred_on)) FROM
   (SELECT id,occurred_on FROM cf_interactions WHERE donor_id=d.id AND meaningful=1 AND occurred_on<=? ORDER BY occurred_on,id))),
  'replies',json((SELECT json_group_array(json_object('id',id,'at',received_at,'status',status)) FROM
   (SELECT id,received_at,status FROM cf_reply_tasks WHERE donor_id=d.id AND automatic=0 AND status NOT IN ('done','filed') AND received_at<=? ORDER BY received_at,id))),
  'pledges',json((SELECT json_group_array(json_object('id',id,'pledgeId',pledge_id,'dueOn',due_on,'cents',amount_cents-paid_cents)) FROM
   (SELECT i.id,i.pledge_id,i.due_on,i.amount_cents,i.paid_cents FROM cf_pledge_balances i JOIN cf_pledges p ON p.id=i.pledge_id
    WHERE p.donor_id=d.id AND i.due_on<? AND i.paid_cents<i.amount_cents ORDER BY i.due_on,i.id))),
  'restrictions',json((SELECT json_group_array(json_object('id',donor_id,'version',version,'type',type,'startsOn',starts_on,'endsOn',ends_on)) FROM
   (SELECT s.* FROM cf_solicitation s WHERE COALESCE((SELECT into_id FROM cf_donor_merges WHERE donor_id=s.donor_id),s.donor_id)=d.id ORDER BY s.donor_id)))) AS row
  FROM cf_donors d LEFT JOIN cf_consents k ON k.id=(SELECT MAX(id) FROM cf_consents WHERE donor_id=d.id AND channel='phone')
  WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) AND ${relationshipManager}=? AND ${scope.sql} ORDER BY d.id`,
  params:[day,day,day,c.now,day,managerId,...scope.params]}
}

function scored(source:Row,day:string,week:string,start:string):Row {
 const period=fiscalPeriod(day,start),ledger=source.ledger as Row[],gifts=source.gifts as Row[]
 const prior=ledger.filter(g=>g.on>=period.previousStart&&g.on<period.start).reduce((n,g)=>n+g.cents,0)
 const current=ledger.filter(g=>g.on>=period.start).reduce((n,g)=>n+g.cents,0)
 const first=gifts[0],last=gifts.at(-1),lastContact=source.contacts.at(-1)
 const silent=!!first&&ledger.reduce((n,g)=>n+g.cents,0)>0&&daysBetween(lastContact?.on??first.on,day)>=90
 const lapse=prior>0&&current<=0||!!last&&daysBetween(last.on,day)>=365
 const upgrade=prior>0&&current>prior
 const anniversary=first&&Array.from({length:7},(_,n)=>addDays(week,n)).find(on=>{
  const year=Number(on.slice(0,4)),monthDay=first.on.slice(5)
  const target=monthDay==='02-29'&&new Date(`${year}-03-01T00:00:00Z`).getUTCDate()===1
   &&new Date(Date.parse(`${year}-03-01T00:00:00Z`)-86400000).getUTCDate()===28?'02-28':monthDay
  return on.slice(5)===target&&on.slice(0,4)>first.on.slice(0,4)
 })
 const flags={reply:source.replies.length>0,pledge:source.pledges.length>0,lapse,upgrade,silent,anniversary:!!anniversary}
 const score=Object.entries(flags).reduce((n,[key,yes])=>n+(yes?scoring[key as keyof typeof scoring]:0),0)
 const parts:string[]=[]
 if(flags.reply)parts.push(`Unanswered donor reply received ${source.replies[0].at.slice(0,10)} (${source.replies.length} open).`)
 if(flags.pledge)parts.push(`Unpaid pledge installment due ${source.pledges[0].dueOn}, ${usd(source.pledges.reduce((n:number,p:Row)=>n+p.cents,0))} overdue in total.`)
 if(lapse)parts.push(`Lapse risk: prior fiscal giving ${usd(prior)}, current fiscal giving ${usd(current)}; last net gift ${last?`on ${last.on}`:'not recorded'}.`)
 if(upgrade)parts.push(`Giving increased: ${usd(current)} this fiscal year versus ${usd(prior)} in the prior fiscal year.`)
 if(silent)parts.push(`No meaningful contact in 90 days; ${lastContact?`last contact on ${lastContact.on}`:`none recorded since first net gift on ${first.on}`}.`)
 if(anniversary)parts.push(`First-gift anniversary ${anniversary}: first gift received ${first.on}.`)
 const hasRestriction=source.restrictions.some((r:Row)=>r.type!=='none'&&r.startsOn<=day&&(!r.endsOn||r.endsOn>=day))
 return {...source,score,isAsk:!hasRestriction&&(lapse||upgrade),restricted:hasRestriction,reason:parts.join(' '),amount:Math.max(0,current,prior,source.pledges.reduce((n:number,p:Row)=>n+p.cents,0)),
  facts:{asOf:day,fiscalStart:period.start,priorFiscalStart:period.previousStart,priorCents:prior,currentCents:current,
   signals:flags,weights:scoring,gifts,ledger,contacts:source.contacts,replies:source.replies,pledges:source.pledges,anniversary:anniversary??null}}
}

async function rankingState(c:Context,managerId:string,runId?:string) {
 const runs=await all(c,'SELECT * FROM cf_call_rank_runs WHERE manager_id=? ORDER BY week_on DESC,id',managerId)
 const run=runId?runs.find(r=>r.id===runId):runs[0]??null
 if(runId&&!run)fail('NOT_FOUND','That call ranking does not belong to this manager.',404)
 if(!run)return {runs,run:null,entries:[],overflow:[],excluded:{},scoring}
 const scope=automationRecords(c,'d.id'),rows=await all(c,`SELECT e.*,d.name AS donor_name,d.constituent_status,t.status AS task_status
  FROM cf_call_rank_entries e JOIN cf_donors d ON d.id=e.donor_id AND d.erased_at IS NULL
  LEFT JOIN cf_call_tasks t ON t.id=e.task_id WHERE e.run_id=? AND ${scope.sql}
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) ORDER BY e.rank_num,e.id`,run.id,...scope.params)
 const [holds,restrictions,preferences]=await Promise.all([phoneHolds(c,rows.map(r=>r.donor_id),false),solicitationState(c,rows.map(r=>r.donor_id)),communicationReasons(c,rows.map(r=>r.donor_id),'phone')])
 const restrictedIds=new Set(restrictions.filter(restricted).map(r=>r.donor_id)),excluded:Row=JSON.parse(run.excluded)
 const entries:Row[]=[],overflow:Row[]=[]
 for(const row of rows){
  const why=holds.get(row.donor_id)??(row.is_ask&&restrictedIds.has(row.donor_id)?'solicitation restriction changed':row.is_ask&&row.task_status!=='done'?preferences.get(row.donor_id):null)
  if(why){countReason(excluded,why);continue}
  const entry={...row,facts:JSON.parse(row.facts),solicitation:restrictions.find(r=>r.donor_id===row.donor_id)}
  if(row.state==='held'){countReason(excluded,'held');continue}
  if(row.state==='overflow')overflow.push(entry);else entries.push(entry)
 }
 return {runs,run,entries,overflow,excluded,scoring}
}
export async function callRanking(c:Context,managerId?:string,runId?:string) {
 requireRole(c.actor,['owner','admin'],'read call rankings')
 if(runId&&!managerId){const run=await one(c,'SELECT manager_id FROM cf_call_rank_runs WHERE id=?',id(runId,'Call run'));if(!run)fail('NOT_FOUND','That call ranking no longer exists.',404);managerId=run.manager_id}
 return rankingState(c,id(managerId??c.actor.id,'Relationship manager'),runId)
}

async function rankManager(c:Context,managerId:string) {
 const [s,config,operator]=await Promise.all([settings(c),policy(c),one(c,`SELECT o.id,o.version,COALESCE(t.weekly_call_capacity,10) AS capacity,COALESCE(t.version,0) AS team_version
  FROM oa_operators o LEFT JOIN cf_task_team t ON t.operator_id=o.id WHERE o.id=? AND o.status='active' AND o.role IN ('owner','admin','member')`,managerId)])
 if(!operator)fail('OWNER_CHANGED','Choose an active relationship manager.',409)
 const day=today(s.timezone,new Date(c.now)),weekday=new Date(day+'T12:00:00Z').getUTCDay(),week=addDays(day,-((weekday+6)%7))
 const saved=await one(c,'SELECT id FROM cf_call_rank_runs WHERE manager_id=? AND week_on=?',managerId,week)
 if(saved)return rankingState(c,managerId,saved.id)
 const source=sourceQuery(c,managerId,day),raw=await all(c,source.query,...source.params),excluded:Row={}
 const preferences=await communicationReasons(c,raw.map(r=>JSON.parse(r.row).id),'phone')
 const candidates=raw.map(r=>scored(JSON.parse(r.row),day,week,s.fiscal_year_start)).filter(r=>r.score>0).filter(r=>{
  const why=r.status!=='active'?r.status:r.permission==='withdrawn'?'phone consent withdrawn':r.isAsk?preferences.get(r.id):null
  if(why){countReason(excluded,why);return false}return true
 }).sort((a,b)=>b.score-a.score||b.amount-a.amount||(a.name.toLowerCase()<b.name.toLowerCase()?-1:a.name.toLowerCase()>b.name.toLowerCase()?1:0)||(a.id<b.id?-1:a.id>b.id?1:0))
 const runId=newId(),period=fiscalPeriod(day,s.fiscal_year_start),taskCount=Math.min(operator.capacity,candidates.length)
 const statements:Stmt[]=[sql('INSERT OR IGNORE INTO cf_call_rank_runs(id,week_on,manager_id,capacity,window_days,fiscal_year,fiscal_start,created_at,created_by,excluded) VALUES(?,?,?,?,?,?,?,?,?,?)',runId,week,managerId,operator.capacity,config.windowDays,Number(period.start.slice(0,4)),s.fiscal_year_start,c.now,c.actor.id,JSON.stringify(excluded)),
  guard('EXISTS(SELECT 1 FROM cf_call_rank_runs WHERE id=?)','RANK_EXISTS','This week was already ranked.',runId),
  guard(`EXISTS(SELECT 1 FROM oa_operators o LEFT JOIN cf_task_team t ON t.operator_id=o.id WHERE o.id=? AND o.version=? AND o.status='active' AND o.role IN ('owner','admin','member') AND COALESCE(t.version,0)=? AND COALESCE(t.weekly_call_capacity,10)=?)`,'OWNER_CHANGED','The manager or weekly call capacity changed. Rank again.',managerId,operator.version,operator.team_version,operator.capacity),
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND call_rank_policy_version=? AND call_outcome_days=? AND fiscal_year_start=? AND timezone=?)','VERSION','Call or fiscal settings changed. Rank again.',config.version,config.windowDays,s.fiscal_year_start,s.timezone),
  guard(`COALESCE((SELECT group_concat(row,char(10)) FROM (${source.query})),'')=?`,'SOURCE_CHANGED','Call source records changed. Rank again.',...source.params,raw.map(r=>r.row).join('\n'))]
 for(const [index,candidate] of candidates.entries()){
  const taskId=index<taskCount?newId():null,reason=(candidate.restricted?'Thank-you or stewardship call only; active solicitation restriction. ':'')+candidate.reason
  if(taskId){
   const classification=await prepareSolicitationRun(c,{kind:'call-task',id:taskId,channel:'phone',isAsk:candidate.isAsk,donorIds:[candidate.id]})
   if(classification.excluded.length)fail('SOURCE_CHANGED','Solicitation eligibility changed. Rank again.')
   statements.push(...classification.statements,...await solicitationRunGuards(c,'call-task',taskId,[candidate.id],classification),
    sql(`INSERT INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask,task_kind)
     SELECT ?,? ,?,'ranked',?,?,?,?,?,?,'call' WHERE EXISTS(SELECT 1 FROM cf_call_rank_runs WHERE id=?)`,taskId,candidate.id,`weekly:${runId}:${candidate.id}`,reason,candidate.amount,managerId,addDays(day,Math.min(index%5,daysBetween(day,addDays(week,6)))),c.now,candidate.isAsk?1:0,runId))
  }
  statements.push(sql(`INSERT INTO cf_call_rank_entries(id,run_id,donor_id,rank_num,score,is_ask,reason,task_id,state,created_at,facts)
   SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cf_call_rank_runs WHERE id=?)`,newId(),runId,candidate.id,index+1,candidate.score,candidate.isAsk?1:0,reason,taskId,taskId?'task':'overflow',c.now,JSON.stringify(candidate.facts),runId))
 }
 statements.push(event(c,'calls.rank','call-ranking',runId,null,{managerId,week,capacity:operator.capacity,tasks:taskCount,overflow:candidates.length-taskCount,excluded}))
 await claimAutomation(c,'calls.rank',taskCount)
 try{await commit(c,statements)}catch(error){if(!(error instanceof CofferError)||error.code!=='RANK_EXISTS')throw error}
 const winner=await one(c,'SELECT id FROM cf_call_rank_runs WHERE manager_id=? AND week_on=?',managerId,week)
 return rankingState(c,managerId,winner!.id)
}
export async function rankCalls(c:Context,p:Row={}) {
 if(!automated(c))requireRole(c.actor,['owner','admin'],'rank weekly calls')
 if(automated(c)&&!p.managerId){
  const managers=await all(c,`SELECT DISTINCT o.id FROM oa_operators o WHERE o.status='active' AND o.role IN ('owner','admin','member')
   AND (EXISTS(SELECT 1 FROM cf_portfolios p WHERE p.manager_id=o.id) OR o.id=${activeOwner}) ORDER BY o.id`),runs=[]
  for(const operator of managers)runs.push(await rankManager(c,operator.id))
  return {runs}
 }
 return rankManager(c,id(p.managerId??c.actor.id,'Relationship manager'))
}

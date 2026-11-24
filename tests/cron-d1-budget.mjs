import assert from 'node:assert/strict'
import {run} from './harness.mjs'

// Cloudflare Workers Free gives one account 5,000,000 D1 rows read a day, shared by every tool on it. The minute Cron is
// 1,440 runs a day, so a run that reads whole tables (every gift, every task) spends that allowance on a small charity's
// stored history alone. This holds each tick to rows that do not grow with history.
const idleTickCeiling=300,dayTurnCeiling=30000
const fab=async(db,table,n,over)=>{
 const columns=(await db.prepare(`PRAGMA table_info(${table})`).all()).results,names=[],values=[]
 for(const c of columns){
  const type=(c.type||'').toUpperCase()
  if(c.name in over){names.push(c.name);values.push(over[c.name]);continue}
  if(c.pk&&/INT/.test(type)&&columns.filter(x=>x.pk).length===1)continue
  if(c.hidden||(!c.notnull&&c.dflt_value===null)||(c.dflt_value!==null&&!c.pk))continue
  names.push(c.name);values.push(/INT|REAL|NUM/.test(type)?'0':`'${c.name}-'||i`)
 }
 await db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${n}) INSERT INTO ${table}(${names.join(',')}) SELECT ${values.join(',')} FROM n`)
}

export async function cronBudgetJourney(){
 await run(async h=>{
  const db=await h.mf.getD1Database('DB'),owner=(await h.get('/auth/session')).operator.id,donors=400,t0=Date.parse('2026-11-25T08:00:00Z')
  // A month at defaults: 400 donors, 1,200 gifts, 80 four-instalment pledges, 400 call tasks (a fifth open and overdue), 4,000 audit events.
  await db.exec('PRAGMA foreign_keys=OFF')
  await fab(db,'cf_donors',donors,{id:`'d'||i`,version:'1',name:`'Donor '||i`,email:`'d'||i||'@example.org'`,source:`'manual'`,created_at:`'2026-11-01T00:00:00Z'`,constituent_status:`'active'`})
  // Withdrawn email consent: welcome enrolment still sweeps every gift, but no step is ever sent through the (absent) provider.
  await fab(db,'cf_consents',donors,{donor_id:`'d'||i`,channel:`'email'`,status:`'withdrawn'`})
  await fab(db,'cf_preference_sync',donors,{donor_id:`'d'||i`,email:`'d'||i||'@example.org'`,state:`'suppressed'`,checked_at:`'2026-11-25T07:30:00Z'`})
  await fab(db,'cf_gifts',3*donors,{id:`'g'||i`,version:'1',donor_id:`'d'||(1+i%${donors})`,kind:`'gift'`,received_on:`date('2026-11-25','-'||(i%30)||' day')`,amount_cents:'5000',method:`'card'`,fund:`'General'`,goods:`'none'`,goods_cents:'0',source:`'manual'`,created_at:`strftime('%Y-%m-%dT%H:%M:%fZ','2026-11-25','-'||(i%30)||' day')`,created_by:`'seed'`,reference:`'ref'||i`})
  await fab(db,'cf_pledges',80,{id:`'p'||i`,donor_id:`'d'||i`,amount_cents:'40000',pledged_on:`'2026-10-01'`,fund:`'General'`,created_at:`'2026-10-01T00:00:00Z'`,created_by:`'seed'`})
  await fab(db,'cf_pledge_installments',320,{id:`'pi'||i`,pledge_id:`'p'||(1+(i-1)%80)`,position:'1+(i-1)/80',due_on:`date('2026-10-20','+'||(((i-1)/80)*20)||' day')`,amount_cents:'10000',remind_on:`date('2026-10-15','+'||(((i-1)/80)*20)||' day')`})
  await fab(db,'cf_call_tasks',400,{id:`'t'||i`,donor_id:`'d'||i`,source_key:`'manual:t'||i`,source_kind:`'manual'`,reason:`'Call about gift'`,owner_id:`'${owner}'`,due_on:`date('2026-11-25','-'||(i%30)||' day')`,status:`CASE WHEN i%5=0 THEN 'open' ELSE 'done' END`,created_at:`'2026-11-01T00:00:00Z'`,amount_cents:'0'})
  await fab(db,'cf_events',4000,{at:`'2026-11-'||printf('%02d',1+i%25)||'T00:00:00Z'`,actor_id:`'a'`,actor_name:`'A'`,actor_role:`'owner'`,action:`'gift.record'`,subject_kind:`'gift'`,subject_id:`'g'||i`,donor_id:`'d'||(1+i%${donors})`,detail:`'{}'`})
  await fab(db,'cf_journeys',2,{id:`'j'||i`,name:`'Journey '||i`,trigger:`CASE i WHEN 1 THEN 'lapse' ELSE 'anniversary' END`,owner_id:`'${owner}'`,published_at:`'2026-10-31T00:00:00Z'`,published_by:`'${owner}'`})
  await fab(db,'cf_email_connection',1,{id:'1',provider:`'mango'`,origin:`'http://127.0.0.1:9'`,credential:`'x'`,saved_at:`'2026-10-31T00:00:00Z'`,saved_by:`'o'`,list_id:`'l'`})
  await fab(db,'cf_welcome',1,{id:`'welcome'`,published_at:`'2026-10-31T00:00:00Z'`,published_by:`'${owner}'`,impact_days:'7',ask_days:'30'})
  await db.exec('PRAGMA foreign_keys=ON')
  const tick=async minute=>{const r=await h.mf.dispatchFetch(h.origin+'/cdn-cgi/local/scheduled?time='+(t0+minute*60000)+'&format=json');assert.equal(r.status,200,await r.text())}
  const meter=async()=>(await h.mf.dispatchFetch(h.origin+'/__cron-meter')).json()
  // The first ticks do the day's work (open tasks get their notices, overdue instalments their tasks, journeys their sweep).
  await tick(0);await tick(1);await tick(2)
  const day=24*60
  for(let minute=3;minute<13;minute++)await tick(minute)
  await tick(day+3)
  const ticks=await meter(),idle=ticks.slice(3,13),turn=ticks[13]
  if(process.env.COFFER_CRON_DEBUG)console.log(JSON.stringify(ticks,null,1))
  assert.deepEqual(ticks.map(t=>t.unmetered),ticks.map(()=>0),'every D1 statement supplies row-access metadata')
  for(const t of idle)assert.ok(t.rowsRead<=idleTickCeiling,`an unchanged minute read ${t.rowsRead} rows; the ceiling is ${idleTickCeiling}. Heaviest: ${t.top.join(' | ')}`)
  assert.ok(turn.rowsRead<=dayTurnCeiling,`the first tick of a new day read ${turn.rowsRead} rows; the ceiling is ${dayTurnCeiling}. Heaviest: ${turn.top.join(' | ')}`)
  // Over a day: 1,439 unchanged minutes and one day turn must stay well inside the shared 5,000,000-row allowance.
  assert.ok(1439*Math.max(...idle.map(t=>t.rowsRead))+turn.rowsRead<=1_000_000,'a day of Cron stays under a fifth of the free D1 read allowance')
 },{entry:'tests/cron-budget-worker.ts',triggerHandlers:true})
}

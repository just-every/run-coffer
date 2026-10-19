import { requireRole } from './auth'
import { all, choice, commit, fail, guard, integer, sql, text, event, object, type Context, type Row } from './db'
import { amount } from './money'
import { CHANNELS } from './attribution'
import { settings } from './settings'

export const DASHBOARD_DIMENSIONS = ['organization','fund','campaign','appeal','form','channel','month'] as const
export type DashboardDimension = typeof DASHBOARD_DIMENSIONS[number]

export async function dashboardGoals(c: Context, year: number, start: string) {
 return all(c, 'SELECT * FROM cf_dashboard_goals WHERE year=? AND fiscal_start=? ORDER BY dimension,dimension_key', year, start)
}

export async function dashboardCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'dashboard.goal') return undefined
 requireRole(c.actor, ['owner','admin'], 'save fundraising goals')
 if (p.goalTarget !== undefined) {
  let selected: Row
  try { selected = object(JSON.parse(text(p.goalTarget, 'Goal', 1000))) } catch { fail('INPUT', 'Choose a goal from this dashboard.', 400) }
  p = { ...p, dimension: selected.dimension, key: selected.key, version: selected.version }
 }
 const year = integer(Number(p.year), 'Fiscal start year', 1000, 9998)
 const dimension = choice(p.dimension, DASHBOARD_DIMENSIONS, 'goal dimension')
 const key = dimension === 'organization' ? '' : text(p.key, 'Goal group', 100)
 const cents = amount(p, 'amount', 'Goal', { allowZero: true }), version = integer(Number(p.version ?? 0), 'Goal version')
 const s = await settings(c)
 if (p.fiscalStart !== s.fiscal_year_start) fail('VERSION', 'The fiscal calendar changed. Refresh before saving.')
 if (dimension === 'channel') choice(key, CHANNELS, 'channel')
 if (dimension === 'month' && !/^(0[1-9]|1[0-2])$/.test(key)) fail('INPUT', 'Choose a calendar month from 01 to 12.', 400)
 const reference = dimension === 'campaign' || dimension === 'form' ? guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=?)','INPUT','Choose an existing campaign or giving form.',key) : dimension === 'appeal' ? guard('EXISTS(SELECT 1 FROM cf_appeal_codes WHERE code=?)','INPUT','Choose an existing appeal.',key) : null
 await commit(c, [
  ...(reference ? [reference] : []),
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND fiscal_year_start=?)', 'VERSION', 'The fiscal calendar changed. Refresh before saving.', s.fiscal_year_start),
  guard('COALESCE((SELECT version FROM cf_dashboard_goals WHERE year=? AND fiscal_start=? AND dimension=? AND dimension_key=?),0)=?', 'VERSION', 'This goal changed. Refresh before saving.', year, s.fiscal_year_start, dimension, key, version),
  sql(`INSERT INTO cf_dashboard_goals VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(year,fiscal_start,dimension,dimension_key)
   DO UPDATE SET amount_cents=excluded.amount_cents,version=version+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`, year, s.fiscal_year_start, dimension, key, cents, c.now, c.actor.id),
  event(c, command, 'dashboard-goal', `${year}:${s.fiscal_year_start}:${dimension}:${key}`, null, {year, fiscalStart:s.fiscal_year_start, dimension, key, amountCents:cents, version:version+1}),
 ])
 return {year, fiscalStart:s.fiscal_year_start, dimension, key, amountCents:cents, version:version+1}
}

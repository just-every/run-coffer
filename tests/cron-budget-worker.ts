// The minute Cron as the deployed Worker runs it, with D1 row-access metadata summed per tick.
// Test-only: GET /__cron-meter returns the rows each scheduled tick read, so a test can hold the Cron to a budget.
import worker from './worker'
import { runScheduledJourneys } from '../src/coffer/communications/journey-runner'
import { runWelcome } from '../src/coffer/communications/welcome'
import { runMarketingSync } from '../src/coffer/communications/scheduler'
const ticks: { time: number; rowsRead: number; rowsWritten: number; unmetered: number; top: string[] }[] = []
let current = { rowsRead: 0, rowsWritten: 0, unmetered: 0 }, statements = new Map<string, number>()
const count = (meta: any, text: string) => {
 if (!Number.isFinite(meta?.rows_read)) current.unmetered++
 else { current.rowsRead += meta.rows_read; current.rowsWritten += meta.rows_written ?? 0; statements.set(text, (statements.get(text) ?? 0) + meta.rows_read) }
}
const meterStatement = (statement: any, text: string): any => ({
 bind: (...values: unknown[]) => meterStatement(statement.bind(...values), text),
 raw_: statement,
 text,
 run: async () => { const r = await statement.run(); count(r.meta, text); return r },
 all: async () => { const r = await statement.all(); count(r.meta, text); return r },
 raw: async (options?: unknown) => { const r = await statement.all(); count(r.meta, text); return options ? [Object.keys(r.results[0] ?? {}), ...r.results.map((x: any) => Object.values(x))] : r.results.map((x: any) => Object.values(x)) },
 first: async (column?: string) => { const r = await statement.all(); count(r.meta, text); const row = r.results[0]; return !row ? null : column === undefined ? row : row[column] },
})
const meterDatabase = (db: any): any => ({
 prepare: (text: string) => meterStatement(db.prepare(text), text.replace(/\s+/g, ' ').slice(0, 140)),
 batch: async (batch: any[]) => { const results = await db.batch(batch.map(s => s.raw_)); results.forEach((r: any, i: number) => count(r.meta, batch[i].text)); return results },
 exec: (text: string) => db.exec(text),
})
export default {
 async scheduled(controller: ScheduledController, rawEnv: any) {
  current = { rowsRead: 0, rowsWritten: 0, unmetered: 0 }
  statements = new Map()
  const env = { ...rawEnv, DB: meterDatabase(rawEnv.DB) }, at = new Date(controller.scheduledTime)
  await Promise.all([runMarketingSync(env, at), runScheduledJourneys(env, at), runWelcome(env, at)])
  await worker.scheduled(controller, env)
  ticks.push({ time: controller.scheduledTime, ...current, top: [...statements].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([text, rows]) => `${rows} ${text}`) })
 },
 async fetch(request: Request, env: any) {
  if (new URL(request.url).pathname === '/__cron-meter') return Response.json(ticks)
  return worker.fetch(request, env)
 },
}

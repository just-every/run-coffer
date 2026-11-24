import { commit, one, sql, today, type Context } from './db'
import { settings } from './settings'

/** The minute Cron revisits a whole-table sweep only when the organisation's own day has turned, the
 * sweep's inputs (`key`) changed, or the audit trail has grown since the sweep last began. An unchanged
 * minute therefore reads a few cursor rows instead of every stored gift, task or donor. Every change a
 * person makes through Coffer writes an audit event, so no change waits longer than the next day turn. */
export async function sweepGate(c: Context, name: string, key = '') {
 const [config, state, last] = await Promise.all([
  settings(c),
  one(c, 'SELECT day,event_id,key FROM cf_scheduler_state WHERE name=?', name),
  one(c, 'SELECT COALESCE(MAX(id),0) AS id FROM cf_events'),
 ])
 const day = today(config.timezone, new Date(c.now)), eventId = Number(last!.id)
 const due = !state || state.day !== day || state.event_id !== eventId || state.key !== key
 return {
  day, due,
  /** Record the audit position read before the sweep, so the sweep's own events trigger one more, quiet pass. */
  done: () => commit(c, [sql('INSERT INTO cf_scheduler_state(name,day,event_id,key) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET day=excluded.day,event_id=excluded.event_id,key=excluded.key', name, day, eventId, key)]),
 }
}

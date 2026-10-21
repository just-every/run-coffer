import { date, fail, guard, sql, today, type Context, type Stmt } from './db'
import { settings } from './settings'

/** The organization-calendar day a changed address takes effect: the stated
 * move date, or today. Earlier addresses are kept by cf_donor_address_change. */
export async function addressMove(c: Context, value: unknown) {
 const day = today((await settings(c)).timezone, new Date(c.now))
 if (value === undefined || value === null || value === '') return day
 const moved = date(value, 'Moved on')
 if (moved > day) fail('INPUT', 'A move date cannot be in the future.', 400)
 return moved
}

/** Stage the move for the trigger in this batch; the writer clears it after its update. */
export function stageAddressMove(donorId: string, effectiveOn: string, source: 'staff' | 'merge' | 'smarty' | 'ncoa'): Stmt[] {
 return [
  guard('NOT EXISTS(SELECT 1 FROM cf_donor_address_history WHERE donor_id=? AND until_on>?)', 'ADDRESS_ORDER', 'A move date cannot be before this donor’s last recorded move.', donorId, effectiveOn),
  sql('INSERT OR REPLACE INTO cf_address_moves(donor_id,effective_on,source) VALUES(?,?,?)', donorId, effectiveOn, source),
 ]
}

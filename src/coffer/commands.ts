import { digest, requireRole, type Role } from './auth'
import { commit, event, fail, newId, object, sql, text, type Context, type Row } from './db'
import { donorCommand } from './donors'
import { giftCommand } from './gifts'
import { ackCommand } from './acknowledgements'
import { appealCommand } from './appeals'
import { settingsCommand } from './settings'
import { deliveryCommand } from './letter-delivery'
import { prepareStatements } from './year-end'

const STAFF: Role[] = ['owner', 'admin', 'member'], MANAGERS: Role[] = ['owner', 'admin'], PREPARERS: Role[] = ['owner', 'admin', 'agent']
// Who may run each command. Agents prepare letters and appeal audiences; a
// person approves, exports and records them. Members do data entry only.
export const ACCESS: Record<string, Role[]> = {
 'donor.create': STAFF, 'donor.update': STAFF, 'gift.record': STAFF, 'consent.record': STAFF, 'pledge.create': STAFF,
 'gift.reverse': MANAGERS, 'gift.classify': MANAGERS, 'settings.update': MANAGERS,
 'ack.prepareStatements': MANAGERS, 'ack.send': MANAGERS, 'ack.checkDelivery': MANAGERS, 'ack.printed': MANAGERS, 'ack.prepare': PREPARERS, 'ack.approve': MANAGERS, 'ack.discard': MANAGERS, 'ack.export': MANAGERS, 'ack.markSent': MANAGERS,
 'appeal.prepare': PREPARERS, 'appeal.approve': MANAGERS, 'appeal.discard': MANAGERS, 'appeal.export': MANAGERS, 'appeal.markSent': MANAGERS,
 'agent.create': MANAGERS, 'agent.revoke': MANAGERS,
}

export async function execute(c: Context, command: string, input: unknown): Promise<Row> {
 const allowed = ACCESS[command]
 if (!allowed) fail('COMMAND', 'Unknown Coffer command.', 400)
 requireRole(c.actor, allowed, `run ${command}`)
 const p = object(input)
 if (command === 'ack.prepareStatements') return prepareStatements(c, p)
 if (command === 'settings.update') return settingsCommand(c, p)
 if (command.startsWith('agent.')) return agentKey(c, command, p)
 for (const handler of [donorCommand, giftCommand, deliveryCommand, ackCommand, appealCommand]) {
  const result = await handler(c, command, p)
  if (result !== undefined) return result
 }
 return fail('COMMAND', 'Unknown Coffer command.', 400)
}

/** Preparation keys: shown once, stored as a hash, 30-day expiry, bound to
 * the creating person's current account version. */
async function agentKey(c: Context, command: string, p: Row) {
 if (command === 'agent.revoke') {
  const keyId = text(p.id, 'Key', 100)
  await commit(c, [sql('UPDATE cf_agent_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL', Date.now(), keyId), event(c, 'agent.revoke', 'agent', keyId, null)])
  return { revoked: true }
 }
 const label = text(p.label, 'Agent label', 100)
 const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
 const keyId = newId(), now = Date.now(), expiresAt = now + 30 * 86400000
 await commit(c, [sql('INSERT INTO cf_agent_keys SELECT ?,?,?,id,version,?,NULL,? FROM oa_operators WHERE id=?', keyId, await digest(token), label, expiresAt, now, c.actor.id), event(c, 'agent.create', 'agent', keyId, null, { expiresAt })])
 return { id: keyId, label, token, expiresAt }
}

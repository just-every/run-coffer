import { commit, type Context, type Stmt } from '../db'
import type { GivingEnv } from '../giving/stripe'
/** Webhooks have provider authority; operator-triggered sync rechecks its
 * session in every transaction, including after a slow provider response. */
export async function paymentWrite(env: GivingEnv, statements: Stmt[], c?: Context) {
 if (c) return commit(c, statements)
 await env.DB.batch(statements.map(s => env.DB.prepare(s.sql).bind(...s.params)))
}

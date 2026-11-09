import { CofferError, commitResults, one, sql, type Context } from '../db'

// Installation protection only; grant budgets and receipt limits are separate.
export const MCP_REQUEST_CAPACITY = 120
export const MCP_REQUEST_WINDOW_MS = 60_000

/** One guarded D1 transaction reserves a slot, rather than reading then writing.
 * Every MCP path uses the authenticated key ID, never a path or client header. */
export async function reserveMcpRequest(c: Context): Promise<void> {
 const now = Date.parse(c.now)
 const results = await commitResults(c, [sql(`INSERT INTO cf_mcp_request_capacity(key_id,expires_at,requests) VALUES(?,?,1)
 ON CONFLICT(key_id) DO UPDATE SET
 requests=CASE WHEN expires_at<=? THEN 1 ELSE requests+1 END,
 expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
 WHERE expires_at<=? OR requests<?
 RETURNING expires_at`, c.actor.id, now + MCP_REQUEST_WINDOW_MS, now, now, now, MCP_REQUEST_CAPACITY)])
 if (results?.[1].results.length) return
 const window = await one<{ expires_at: number }>(c, 'SELECT expires_at FROM cf_mcp_request_capacity WHERE key_id=?', c.actor.id)
 const retryAfter = Math.max(1, Math.ceil(((window?.expires_at ?? now + MCP_REQUEST_WINDOW_MS) - now) / 1000))
 throw new CofferError('MCP_CAPACITY', 'This agent key has used its MCP request capacity. Try again after Retry-After.', 429, null, retryAfter)
}

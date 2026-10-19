import { one } from '../db'

/** GIFT-003: a giving page reached by `/give/<slug>?appeal=<code>` attributes the gift
 * to that defined appeal. An unknown or malformed code attributes no appeal; the gift
 * itself still proceeds, and nothing claims an appeal that was not defined. */
export async function trackedAppeal(c: { db: D1Database }, value: unknown): Promise<string | null> {
 const code = typeof value === 'string' ? value.trim() : ''
 if (!code || code.length > 200) return null
 return (await one<{ code: string }>(c, 'SELECT code FROM cf_appeal_codes WHERE code=?', code))?.code ?? null
}

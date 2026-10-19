import { requireRole } from './auth'
import { csv } from './csv'
import { all, commit, date, event, fail, guard, id, integer, one, optional, sql, text, type Context, type Row, type Stmt } from './db'

type ReadContext = Pick<Context, 'db'>
export type Recognition = { anonymous: number; recognitionName: string | null; wallOptIn: number }
export type RecognitionLevel = { name: string; minimumCents: number }
export type RecognitionRow = { name: string; amountCents: number; giftCount: number; level: string | null }

function flag(value: unknown, label: string): number {
 if (value === true || value === 1 || value === 'yes') return 1
 if (value === undefined || value === false || value === 0 || value === 'no' || value === '') return 0
 return fail('INPUT', `${label} must be yes or no.`, 400)
}

function name(value: unknown): string | null {
 const result = optional(value, 'Recognition name', 200)
 if (result && /[\r\n\t]/.test(result)) fail('INPUT', 'Recognition name must be one line.', 400)
 return result
}

/** Only explicit choices publish a gift. Never derive a public name from PII. */
export function intentRecognition(p: Row): Recognition {
 return { anonymous: flag(p.anonymous, 'Anonymous gift'), recognitionName: name(p.recognitionName), wallOptIn: flag(p.wallOptIn, 'Show on donor wall') }
}

export async function donorRecognition(c: ReadContext, donorId: string) {
 const row = await one(c, 'SELECT * FROM cf_donor_recognition WHERE donor_id=?', donorId)
 return row ?? { donor_id: donorId, anonymous: 0, recognition_name: null, honor_roll_opt_in: 0, version: 0 }
}

export async function giftRecognition(c: ReadContext, giftId: string) {
 return await one(c, 'SELECT * FROM cf_gift_recognition WHERE gift_id=?', giftId)
  ?? { gift_id: giftId, anonymous: 0, wall_opt_in: 0, recognition_name: null }
}

export async function recognitionCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'recognition.donor' && command !== 'recognition.gift') return undefined
 requireRole(c.actor, ['owner', 'admin', 'member'], 'change recognition preferences')
 const recognition = intentRecognition(p)
 if (command === 'recognition.donor') {
  const donorId = id(p.donorId, 'Donor'), version = integer(Number(p.version), 'Recognition version', 0)
  const honorRoll = flag(p.honorRollOptIn, 'Include recognition name on honor rolls')
  await commit(c, [
   guard('EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))', 'NOT_FOUND', 'That donor no longer exists or was merged.', donorId),
   guard('COALESCE((SELECT version FROM cf_donor_recognition WHERE donor_id=?),0)=?', 'VERSION', 'Recognition preferences changed. Refresh before saving.', donorId, version),
   sql(`INSERT INTO cf_donor_recognition(donor_id,anonymous,recognition_name,honor_roll_opt_in,version) VALUES(?,?,?,?,1)
    ON CONFLICT(donor_id) DO UPDATE SET anonymous=excluded.anonymous,recognition_name=excluded.recognition_name,honor_roll_opt_in=excluded.honor_roll_opt_in,version=cf_donor_recognition.version+1`, donorId, recognition.anonymous, recognition.recognitionName, honorRoll),
   event(c, command, 'donor', donorId, donorId, { version: version + 1, anonymous: recognition.anonymous, honorRollOptIn: honorRoll }),
  ])
  return { donorId, version: version + 1 }
 }
 const giftId = id(p.giftId, 'Gift')
 const gift = await one(c, "SELECT donor_id FROM cf_contribution_ledger WHERE id=? AND kind IN ('gift','in_kind')", giftId)
 if (!gift) fail('NOT_FOUND', 'That gift does not exist.', 404)
 await commit(c, [
  guard(`EXISTS(SELECT 1 FROM cf_contribution_ledger g JOIN cf_donors d ON d.id=g.donor_id
   WHERE g.id=? AND g.kind IN ('gift','in_kind') AND g.donor_id=? AND d.erased_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`, 'GIFT_CHANGED', 'The gift or its donor changed. Refresh before saving.', giftId, gift.donor_id),
  ...(recognition.wallOptIn?[guard('EXISTS(SELECT 1 FROM cf_gift_recognition WHERE gift_id=? AND wall_opt_in=1)','WALL_OPT_IN','Only the donor’s explicit checkout choice can publish a gift. Staff can withdraw it.',giftId)]:[]),
  sql(`INSERT INTO cf_gift_recognition(gift_id,anonymous,wall_opt_in,recognition_name) VALUES(?,?,?,?)
   ON CONFLICT(gift_id) DO UPDATE SET anonymous=excluded.anonymous,wall_opt_in=excluded.wall_opt_in,recognition_name=excluded.recognition_name`, giftId, recognition.anonymous, recognition.wallOptIn, recognition.recognitionName),
  event(c, command, 'gift', giftId, gift.donor_id, { anonymous: recognition.anonymous, wallOptIn: recognition.wallOptIn }),
 ])
 return { id: giftId, donorId: gift.donor_id }
}

/** Append to recordGift's existing batch. Replayed webhooks cannot replace a
 * staff correction or restore a name after erasure. Values come from the
 * persisted intention, never from the legal donor name or email address. */
export function giftRecognitionStatement(giftId: string, intent: Row): Stmt {
 return sql(`INSERT OR IGNORE INTO cf_gift_recognition(gift_id,anonymous,wall_opt_in,recognition_name)
  SELECT g.id,?,?,? FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id
  WHERE g.id=? AND g.kind='gift' AND d.erased_at IS NULL`,
  intent.anonymous === 1 ? 1 : 0, intent.wall_opt_in === 1 ? 1 : 0, name(intent.recognition_name), giftId)
}

/** A merge cannot widen either record's publication permission. The parent
 * journals both recognition tables before/after this runs for exact undo. */
export function mergeStatements(source: string, target: string): Stmt[] {
 return [
  sql(`INSERT INTO cf_donor_recognition(donor_id,anonymous,recognition_name,honor_roll_opt_in,version)
   SELECT d.id,MAX(COALESCE(a.anonymous,0),COALESCE(b.anonymous,0)),
    CASE WHEN a.recognition_name=b.recognition_name THEN b.recognition_name ELSE NULL END,
    MIN(COALESCE(a.honor_roll_opt_in,0),COALESCE(b.honor_roll_opt_in,0)),COALESCE(b.version,0)+1
   FROM cf_donors d LEFT JOIN cf_donor_recognition a ON a.donor_id=?
    LEFT JOIN cf_donor_recognition b ON b.donor_id=d.id
   WHERE d.id=? AND (a.donor_id IS NOT NULL OR b.donor_id IS NOT NULL)
   ON CONFLICT(donor_id) DO UPDATE SET anonymous=excluded.anonymous,recognition_name=excluded.recognition_name,
    honor_roll_opt_in=excluded.honor_roll_opt_in,version=excluded.version`, source, target),
  sql('DELETE FROM cf_donor_recognition WHERE donor_id=?', source),
 ]
}

/** Public projection: no donor/gift IDs, legal names, email or gift dates. */
export async function campaignWall(c: ReadContext, campaignId: string) {
 const rows = await all(c, `SELECT CASE WHEN COALESCE(d.anonymous,0)=1 OR r.anonymous=1
   THEN 'Anonymous' ELSE COALESCE(NULLIF(TRIM(r.recognition_name),''),'Anonymous') END AS name,
  SUM(g.net_cents) AS amountCents,COUNT(*) AS giftCount
  FROM cf_campaign_gifts cg JOIN cf_campaigns campaign ON campaign.id=cg.campaign_id AND campaign.active=1
  JOIN cf_gift_balances g ON g.id=cg.gift_id AND g.net_cents>0
  JOIN cf_donors owner ON owner.id=g.donor_id AND owner.erased_at IS NULL
  JOIN cf_gift_recognition r ON r.gift_id=g.id AND r.wall_opt_in=1
  LEFT JOIN cf_donor_recognition d ON d.donor_id=g.donor_id
  WHERE cg.campaign_id=? GROUP BY 1 ORDER BY amountCents DESC,name`, campaignId)
 return rows.map(row => ({ name: String(row.name), amountCents: integer(row.amountCents, 'Wall total'), giftCount: row.giftCount }))
}

function levels(url: URL): RecognitionLevel[] {
 const raw = url.searchParams.get('levels')
 if (!raw) return [{ name: 'All giving', minimumCents: 0 }]
 let parsed: unknown
 try { parsed = JSON.parse(raw) } catch { return fail('INPUT', 'Giving levels must be a JSON array of names and minimumCents.', 400) }
 if (!Array.isArray(parsed) || !parsed.length || parsed.length > 20) fail('INPUT', 'Choose 1–20 giving levels.', 400)
 const result = parsed.map((level: unknown) => {
  if (!level || typeof level !== 'object' || Array.isArray(level)) fail('INPUT', 'Each giving level needs a name and minimumCents.', 400)
  const value = level as Row
  return { name: text(value.name, 'Giving level name', 100), minimumCents: integer(value.minimumCents, 'Giving level lower bound') }
 }).sort((a, b) => a.minimumCents - b.minimumCents)
 if (result[0].minimumCents !== 0 || new Set(result.map(level => level.minimumCents)).size !== result.length || new Set(result.map(level => level.name)).size !== result.length) {
  fail('INPUT', 'Giving levels need distinct names and lower bounds, starting at zero cents.', 400)
 }
 return result
}

/** Owner/admin honor roll uses positive remaining balances of gifts received
 * in the inclusive period; later refunds reduce that original recognition.
 * Gift anonymity has its own row; donor anonymity groups the donor's gifts.
 * This proposal keeps names anonymous unless the donor opted into honor rolls. */
export async function report(c: Context, url: URL) {
 requireRole(c.actor, ['owner', 'admin'], 'export honor rolls')
 const from = date(url.searchParams.get('from'), 'From'), through = date(url.searchParams.get('through'), 'Through')
 if (from > through) fail('INPUT', 'From must be on or before Through.', 400)
 const bands = levels(url)
 const entries = await all(c, `SELECT g.donor_id,g.net_cents AS amount_cents,g.id AS original_id,
  COALESCE(d.anonymous,0) AS donor_anonymous,COALESCE(d.honor_roll_opt_in,0) AS honor_roll_opt_in,
  d.recognition_name AS donor_name,COALESCE(r.anonymous,0) AS gift_anonymous,owner.erased_at
  FROM cf_gift_balances g JOIN cf_donors owner ON owner.id=g.donor_id
  LEFT JOIN cf_donor_recognition d ON d.donor_id=g.donor_id
  LEFT JOIN cf_gift_recognition r ON r.gift_id=g.id
  WHERE g.received_on>=? AND g.received_on<=? AND g.net_cents>0 ORDER BY g.id`, from, through)
 const grouped = new Map<string, { name: string; cents: number; gifts: Set<string> }>()
 let totalCents = 0
 for (const entry of entries) {
  const recognitionName=name(entry.donor_name)
  const anonymous=!!(entry.erased_at || entry.donor_anonymous || entry.gift_anonymous || !entry.honor_roll_opt_in || !recognitionName)
  const key = anonymous ? `gift:${entry.original_id}` : `donor:${entry.donor_id}`
  const displayName = anonymous ? 'Anonymous' : recognitionName!
  const row = grouped.get(key) ?? { name: displayName, cents: 0, gifts: new Set<string>() }
  row.cents = integer(row.cents + entry.amount_cents, 'Honor-roll amount', -Number.MAX_SAFE_INTEGER)
  if (entry.original_id) row.gifts.add(entry.original_id)
  grouped.set(key, row)
  totalCents = integer(totalCents + entry.amount_cents, 'Honor-roll total', -Number.MAX_SAFE_INTEGER)
 }
 const rows: RecognitionRow[] = [...grouped.values()].filter(row => row.cents !== 0).map(row => ({
  name: row.name, amountCents: row.cents, giftCount: row.gifts.size,
  level: [...bands].reverse().find(level => row.cents >= level.minimumCents)?.name ?? null,
 })).sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name))
 await commit(c, [event(c, 'recognition.honorRoll', 'report', 'honor-roll', null, { from, through, rows: rows.length, totalCents }, 'cf_access_events')])
 return { from, through, levels: bands, rows, totalCents }
}

export function honorRollCsv(value: Awaited<ReturnType<typeof report>>) {
 return csv(['Recognition name', 'Giving level', 'Contribution cents', 'Contribution USD', 'Gifts'], value.rows.map(row => [
  row.name, row.level, row.amountCents,
  `${row.amountCents < 0 ? '-' : ''}${Math.floor(Math.abs(row.amountCents) / 100)}.${String(Math.abs(row.amountCents) % 100).padStart(2, '0')}`, row.giftCount,
 ]))
}

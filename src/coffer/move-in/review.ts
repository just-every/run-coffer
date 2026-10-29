import { customReviewWrites } from './custom-review-storage'
import { all, commit, fail, guard, one, sql, type Context, type Row, type Stmt } from '../db'
import type { Difference } from './reconcile'
import type { Diagnostic, ParsedImport } from './types'

/** D1 keeps a value under 2 MB and a request under 32 MiB. Staged parts and review rows
 * go in requests of about 4 MB, so 100,000 source rows fit on a hosted Coffer too. */
const REQUEST_BYTES = 4 * 1024 * 1024, ISSUES_PER_STATEMENT = 1000
export const PAGE_SIZE = 50

/** Differences, plus matching per-donor rows collapsed into a count: the stored report stays small. */
export function compact(rows: Difference[]) {
 const donors = rows.filter(r => r.scope === 'donor')
 return { rows: rows.filter(r => r.scope !== 'donor' || !r.matches), donors: { total: donors.length, matching: donors.filter(r => r.matches).length } }
}

/** The values with no place in Coffer, one line per file and column. */
export function leftOut(parsed: ParsedImport) {
 const columns = new Map<string, { file: string; column: string; values: number; rows: number[]; example: string }>()
 for (const u of parsed.unmapped) {
  if (!u.value) continue
  const key = `${u.file}\u0000${u.column}`, entry = columns.get(key) ?? { file: u.file, column: u.column, values: 0, rows: [], example: u.value }
  entry.values++; if (entry.rows.length < 3) entry.rows.push(u.row)
  columns.set(key, entry)
 }
 return [...columns.values()].sort((a, b) => b.values - a.values || a.column.localeCompare(b.column))
}

const sample = (p: ParsedImport) => Object.fromEntries((['recurringReferences', 'solicitations', 'channelWithdrawals', 'donors', 'households', 'gifts', 'relationships', 'softCredits', 'pledges', 'installments', 'notes'] as const).map(k => [k, ((p[k]??[]) as unknown[]).slice(0, 20)]))

/** Errors first, then warnings, each in file and row order. */
export function ordered(diagnostics: Diagnostic[]) {
 const rank = (d: Diagnostic) => d.severity === 'error' ? 0 : 1
 return [...diagnostics].sort((a, b) => rank(a) - rank(b) || (a.file ?? '').localeCompare(b.file ?? '') || (a.row ?? 0) - (b.row ?? 0))
}

/** Stores the review: the job first (not yet usable), then parts and review rows in bounded requests, then the
 * part count and fingerprint that make it usable. A review interrupted part-way can never be applied. */
export async function store(c: Context, review: { id: string; fileFingerprint: string; fingerprint: string; source: string; prior: Row | null; report: Row; parts: ParsedImport[]; issues: Diagnostic[] }) {
 const { id, prior } = review
 const custom=review.report.customReview
 const report={...review.report,...(custom?{customReview:{pending:true}}:{})}
 await commit(c, prior ? [guard("EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND state IN ('reviewed','undone'))", 'MOVE_IN_CHANGED', 'This move-in started in another window. Open its journal.', id),
  sql('DELETE FROM cf_move_in_parts WHERE job_id=?', id), sql('DELETE FROM cf_move_in_issues WHERE job_id=?', id),
  sql("UPDATE cf_move_in_jobs SET fingerprint='',state='reviewed',report=?,accepted_reason=NULL,created_at=?,created_by=?,undone_at=NULL,redacted=0,parts=0,applied_parts=0,acknowledged_before=NULL,checked_at=NULL,check_report=NULL WHERE id=?", JSON.stringify(report), c.now, c.actor.name, id)]
  : [sql("INSERT INTO cf_move_in_jobs(id,file_fingerprint,fingerprint,source,state,report,created_at,created_by,parts,applied_parts) VALUES(?,?,'',?,'reviewed',?,?,?,0,0)", id, review.fileFingerprint, review.source, JSON.stringify(report), c.now, c.actor.name)])
 await commit(c,[sql('DELETE FROM cf_move_in_custom_reviews WHERE job_id=?',id),...(custom?await customReviewWrites(id,custom):[])])
 const statements: [Stmt, number][] = review.parts.map((part, position) => { const payload = JSON.stringify(part); return [sql('INSERT INTO cf_move_in_parts(job_id,position,payload) VALUES(?,?,?)', id, position, payload), payload.length] })
 for (let i = 0; i < review.issues.length; i += ISSUES_PER_STATEMENT) {
  const rows = JSON.stringify(review.issues.slice(i, i + ISSUES_PER_STATEMENT).map((d, n) => [i + n, d.severity, d.code, d.file ?? null, d.sheet ?? null, d.row ?? null, d.column ?? null, d.message]))
  statements.push([sql(`INSERT INTO cf_move_in_issues(job_id,position,severity,code,file,sheet,row,column_name,message) SELECT ?,${[0, 1, 2, 3, 4, 5, 6, 7].map(k => `json_extract(value,'$[${k}]')`).join(',')} FROM json_each(?)`, id, rows), rows.length])
 }
 let batch: Stmt[] = [], bytes = 0
 for (const [statement, size] of statements) {
  if (batch.length && bytes + size > REQUEST_BYTES) { await c.db.batch(batch.map(s => c.db.prepare(s.sql).bind(...s.params))); batch = []; bytes = 0 }
  batch.push(statement); bytes += size
 }
 if (batch.length) await c.db.batch(batch.map(s => c.db.prepare(s.sql).bind(...s.params)))
 await commit(c, [guard("EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND state='reviewed' AND parts=0)", 'MOVE_IN_CHANGED', 'This review changed in another window. Upload the files again.', id),
  sql('UPDATE cf_move_in_jobs SET parts=?,fingerprint=? WHERE id=?', review.parts.length, review.fingerprint, id)])
}

export type IssueQuery = { severity?: string; code?: string; file?: string; page?: number }
function where(id: string, q: IssueQuery) {
 const clauses = ['job_id=?'], params: unknown[] = [id]
 if (q.severity === 'error' || q.severity === 'warning') { clauses.push('severity=?'); params.push(q.severity) }
 if (q.code) { clauses.push('code=?'); params.push(q.code) }
 if (q.file) { clauses.push('file=?'); params.push(q.file) }
 return { text: clauses.join(' AND '), params }
}

/** One page of the review's rows, with the counts the filters offer. */
export async function issues(c: Context, id: string, q: IssueQuery) {
 const filter = where(id, q), page = Math.max(1, Math.floor(Number(q.page) || 1))
 const [total, rows, codes, files] = await Promise.all([
  one(c, `SELECT count(*) AS n FROM cf_move_in_issues WHERE ${filter.text}`, ...filter.params),
  all(c, `SELECT severity,code,file,sheet,row,column_name AS "column",message FROM cf_move_in_issues WHERE ${filter.text} ORDER BY position LIMIT ? OFFSET ?`, ...filter.params, PAGE_SIZE, (page - 1) * PAGE_SIZE),
  all(c, 'SELECT severity,code,count(*) AS n,min(message) AS example FROM cf_move_in_issues WHERE job_id=? GROUP BY severity,code ORDER BY severity,n DESC', id),
  all(c, 'SELECT file,count(*) AS n FROM cf_move_in_issues WHERE job_id=? AND file IS NOT NULL GROUP BY file ORDER BY file', id)])
 return { total: total?.n ?? 0, page, pages: Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE)), rows, codes, files, query: q }
}

export async function allIssues(c: Context, id: string, q: IssueQuery) {
 const filter = where(id, q)
 return all(c, `SELECT severity,code,file,sheet,row,column_name AS "column",message FROM cf_move_in_issues WHERE ${filter.text} ORDER BY position`, ...filter.params)
}

export async function reviewed(c: Context, id: string) {
 const job = await one(c, 'SELECT id,source,state,fingerprint,parts,applied_parts,report,created_at,redacted FROM cf_move_in_jobs WHERE id=?', id)
 if (!job) fail('NOT_FOUND', 'That review does not exist. Upload the files again.', 404)
 if(job.redacted)fail('MOVE_IN_ERASED','A donor in this review was erased. Its source records are no longer available.',409)
 return { ...job, report: JSON.parse(job.report) } as Row
}

export const reportOf = (parsed: ParsedImport, review: { rows: Difference[]; canApply: boolean; needsAcceptance: boolean; counts: Row; parts: number }) => ({
 solicitCodes: parsed.solicitCodes, restrictionSource: { donorIds:[...new Set([...(parsed.solicitations??[]),...(parsed.channelWithdrawals??[]).filter(r=>!r.status||r.status==='withdrawn')].map(r=>r.donorExternalId))], solicitationIds:(parsed.solicitations??[]).map(r=>r.donorExternalId), withdrawals:(parsed.channelWithdrawals??[]).filter(r=>!r.status||r.status==='withdrawn').map(r=>({donorExternalId:r.donorExternalId,channel:r.channel})) },
 counts: review.counts, reconciliation: compact(review.rows), files: parsed.files, unmapped: parsed.unmapped.filter(u => u.value).length, leftOut: leftOut(parsed),
 needsAcceptance: review.needsAcceptance, canApply: review.canApply, parts: review.parts, sourceTotals: parsed.sourceTotals, controlTotals: parsed.controlTotals, sample: sample(parsed),
})

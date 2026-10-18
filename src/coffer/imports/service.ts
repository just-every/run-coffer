import { resumeD1Import, applyD1ImportBatches, createD1ImportJob, planD1Import, readD1ImportJob, readD1ImportOriginals, undoD1Import, d1RequestContext, type D1Database, type Json } from '../../modules/import-kit/src/d1/index.ts'
import { stored, boundary } from '../../modules/import-kit/src/d1/jobs.ts'
import { readAtomic } from '../../modules/import-kit/src/d1/database.ts'
import { authorize, destination, importContext, principalId } from './context.ts'
import { donorId, erasureHash, kitName, snapshotSource, type NativeIndex } from './snapshots.ts'
import { reject, type ApplyInput, type ImportActor, type ImportAuthority, type ImportJournal, type ImportPreview, type SnapshotInput } from './types.ts'
import { subscriptionIndex } from './subscriptions.ts'

const listOf = (value: unknown) => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
const items = (pages: unknown) => listOf(pages).flatMap((page: any) => Array.isArray(page?.data) ? page.data : []).filter((x: any) => x && typeof x === 'object')

/** Reads only the Coffer rows these Stripe pages could touch. */
async function nativeIndex(db: D1Database, input: SnapshotInput): Promise<NativeIndex> {
  const customers = items(input.customers), charges = items(input.charges)
  const emails = [...new Set([...customers.map((c: any) => c.email), ...charges.flatMap((c: any) => [c.billing_details?.email, c.receipt_email])]
    .filter(e => typeof e === 'string').map(e => e.trim().toLowerCase()))]
  const ids = customers.map((c: any) => typeof c.id === 'string' ? donorId(c.id) : null).filter(Boolean) as string[]
  const hashes = [...ids, ...emails].map(erasureHash)
  const refs = [...new Set(charges.flatMap((c: any) => [c.id,c.payment_intent,c.invoice]).filter(x => typeof x === 'string'))]
  const [byId, erased, byEmail, gifts, settings] = await db.batch([
    db.prepare('SELECT id,COALESCE((SELECT into_id FROM cf_donor_merges WHERE donor_id=cf_donors.id),id) AS effective_id FROM cf_donors WHERE erased_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)),
    db.prepare('SELECT hash FROM cf_erasures WHERE hash IN (SELECT value FROM json_each(?))').bind(JSON.stringify(hashes)),
    db.prepare(`SELECT DISTINCT COALESCE(m.into_id,d.id) AS id,e.email FROM (SELECT id AS donor_id,email FROM cf_donors UNION SELECT donor_id,email FROM cf_donor_aliases) e JOIN cf_donors d ON d.id=e.donor_id LEFT JOIN cf_donor_merges m ON m.donor_id=d.id WHERE d.erased_at IS NULL AND e.email IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(emails)),
    db.prepare("SELECT reference,amount_cents FROM cf_gifts WHERE source='stripe' AND kind='gift' AND reference IN (SELECT value FROM json_each(?))").bind(JSON.stringify(refs)),
    db.prepare('SELECT timezone FROM cf_settings WHERE id=1'),
  ]) as any[]
  for (const mail of emails) if (new Set(byEmail.results.filter((r:any)=>r.email===mail).map((r:any)=>r.id)).size>1)
    reject('IMPORT_DONOR_AMBIGUOUS','A shared household email matches several donors. Match the Stripe customer to a donor before importing this history.',409)
  return {
    donorIds: new Set(byId.results.map((r: any) => r.id)), aliases: new Map(byId.results.map((r:any) => [r.id,r.effective_id])), erased: new Set(erased.results.map((r: any) => r.hash)),
    emails: new Map(byEmail.results.map((r: any) => [r.email, r.id])), charges: new Map(charges.flatMap((c: any) => { const prior = gifts.results.find((g: any) => [c.id,c.payment_intent,c.invoice].includes(g.reference)); return prior ? [[c.id,prior.amount_cents] as [string,number]] : [] })),
    timezone: settings.results[0].timezone,
    subscriptions: await subscriptionIndex(db),
  }
}

async function prepare(db: D1Database, actor: ImportActor, input: SnapshotInput, authority: ImportAuthority) {
  await authorize(db, actor, authority)
  const { source, mapping, skipped } = snapshotSource(input, await nativeIndex(db, input))
  const context = d1RequestContext(importContext(db, actor, authority))
  const plan = await planD1Import(source, mapping, context)
  await authorize(context.storage.database, actor, authority)
  return { plan, context, skipped }
}

/** SELECT-only, including Base's current-authority fences. */
export async function preview(db: D1Database, actor: ImportActor, input: SnapshotInput, authority: ImportAuthority): Promise<ImportPreview> {
  const { plan, skipped } = await prepare(db, actor, input, authority)
  const values = (kind: string) => plan.entries.flatMap(e => e.effects).filter(e => e.targetKind === kind).map(e => e.value as Record<string, Json>)
  return { name: kitName, fingerprint: plan.fingerprint, counts: plan.counts, diagnostics: plan.diagnostics, donors: values('donor'), gifts: values('gift'), subscriptions: values('subscription'), skipped, plan }
}

/** Repeat the identical approved payload; the fingerprint binds the approval. */
export async function apply(db: D1Database, actor: ImportActor, input: ApplyInput, authority: ImportAuthority) {
  if (typeof input?.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint))
    reject('IMPORT_APPROVAL', 'Supply the exact fingerprint reviewed in preview.', 400)
  // Approving the same review twice continues the job it started.
  const prior = await db.prepare('SELECT id FROM ik_jobs WHERE destination=? AND principal_id=? AND operation_key=?').bind(destination, principalId, `coffer-move-in:${input.fingerprint}`).first<{ id: string }>()
  if (prior) return resume(db, actor, prior.id, authority)
  const { plan, context } = await prepare(db, actor, input, authority)
  if (plan.fingerprint !== input.fingerprint) reject('IMPORT_REVIEW_CHANGED', 'The Stripe pages or Coffer changed since the preview. Preview again and review the new plan.')
  if (plan.diagnostics.some(item => item.severity === 'error')) reject('IMPORT_DIAGNOSTICS', 'Resolve the preview errors before applying.')
  context.reviewedFingerprint = input.fingerprint
  context.operationKey = `coffer-move-in:${input.fingerprint}`
  const job = await createD1ImportJob(plan, context)
  return applyD1ImportBatches(job.id, context)
}

function jobId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) reject('IMPORT_JOB_ID', 'Supply a valid import job ID.', 400)
}

/** Job, complete fingerprinted plan and retained originals. */
export async function journal(db: D1Database, actor: ImportActor, id: string, authority: ImportAuthority): Promise<ImportJournal> {
  await authorize(db, actor, authority)
  jobId(id)
  const context = d1RequestContext(importContext(db, actor, authority))
  const job = await readD1ImportJob(id, context)
  const retained = await stored(id, context)
  const originals = await readD1ImportOriginals(id, context)
  // One final snapshot fence binds the public job and the full plan returned
  // here across the independent custody reads above.
  if (job.fingerprint !== retained.job.fingerprint || job.fence !== retained.job.fence)
    reject('IMPORT_JOURNAL_CHANGED', 'The import changed while its journal was being read. Refresh it.')
  const batches = await db.prepare('SELECT action,position,end_position,fence FROM ik_batches WHERE job_id=? ORDER BY fence,position').bind(id).all()
  await readAtomic(context, boundary(retained.job, retained.plan))
  const expected = retained.plan.entries.filter(e => !e.erased).flatMap(e => e.effects).filter(e => e.targetKind === 'gift').map(e => e.value as any)
  const actual = await db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(b.net_cents),0) AS cents FROM cf_gifts g JOIN cf_gift_balances b ON b.id=g.id WHERE g.id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(expected.map(e => e.id))).first<{n:number;cents:number}>()
  const expectedCents = expected.reduce((sum, e) => sum + e.amountCents, 0)
  return { job, plan: retained.plan, originals, batches: batches.results, totals: { expectedCount: expected.length, expectedCents, actualCount: actual?.n ?? 0, actualCents: actual?.cents ?? 0, matches: actual?.n === expected.length && actual?.cents === expectedCents } }
}

export async function jobs(db: D1Database) {
  return (await db.prepare("SELECT id,state,checkpoint,total,fingerprint FROM ik_jobs WHERE destination='coffer:donor-ledger' ORDER BY rowid DESC LIMIT 20").all()).results
}

/** Strict reversal: records a person has built on since stay, and block undo. */
export async function undo(db: D1Database, actor: ImportActor, id: string, authority: ImportAuthority) {
  await authorize(db, actor, authority)
  jobId(id)
  return undoD1Import(id, importContext(db, actor, authority))
}

/** Continue from retained custody without re-uploading the pages. */
export async function resume(db: D1Database, actor: ImportActor, id: string, authority: ImportAuthority) {
  await authorize(db, actor, authority); jobId(id)
  return resumeD1Import(id, importContext(db, actor, authority))
}

import type { D1Sql, ImportJob, ImportPlan, Json, RetainedOriginal } from '../../modules/import-kit/src/d1/index.ts'

export type ImportActor = { id: string; name: string; role: string }
/** Supplied by the authenticated handler; must consult the current session. */
export type ImportAuthority = { sql: string; params: any[]; liveStripe?: boolean }
/** Saved Stripe API list responses: GET /v1/customers and GET /v1/charges pages. */
export type SnapshotInput = { customers?: object[]; charges: object[]; subscriptions?: object[]; paymentIntents?: object[]; invoices?: object[]; noGoodsOrServices?: boolean }
export type ApplyInput = SnapshotInput & { fingerprint: string }
export type Skipped = { kind: 'customer' | 'charge' | 'subscription'; sourceId: string; reason: string }
export type ImportPreview = {
  name: string; fingerprint: string; counts: ImportPlan['counts']; diagnostics: ImportPlan['diagnostics']
  donors: Record<string, Json>[]; gifts: Record<string, Json>[]; subscriptions: Record<string, Json>[]; skipped: Skipped[]; plan: ImportPlan
}
export type ImportJournal = { job: ImportJob; plan: ImportPlan; originals: RetainedOriginal[]; batches: Record<string, any>[]; totals: { expectedCount: number; expectedCents: number; actualCount: number; actualCents: number; matches: boolean } }
/** Native SQL is server-authored. checkpoint is portability's redaction fence. */
export type EraseIntegration = { nativeStatements: D1Sql[]; checkpoint: D1Sql[] }
export type SnapshotObject = { [key: string]: Json }

export class ImportError extends Error {
  code: string
  status: number
  details: unknown
  constructor(code: string, message: string, status = 409, details: unknown = null) {
    super(message); this.name = 'ImportError'; this.code = code; this.status = status; this.details = details
  }
}
export function reject(code: string, message: string, status = 409, details: unknown = null): never {
  throw new ImportError(code, message, status, details)
}

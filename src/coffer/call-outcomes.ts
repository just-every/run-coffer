import { requireRole } from './auth'
import { addDays, all, fail, id, one, type Context } from './db'
import { retention, type RetentionKind } from './retention'
import { settings } from './settings'

type CallRun = {
 id: string; week_on: string; manager_id: string; capacity: number; window_days: number
 fiscal_year: number; fiscal_start: string; created_at: string; created_by: string
}
type Entry = {
 id: string; donor_id: string; rank_num: number; score: number; is_ask: number; reason: string
 task_id: string | null; state: 'task' | 'overflow' | 'held'; name: string | null
 task_status: string | null; completed_at: string | null; interaction_id: string | null
 occurred_on: string | null; recorded_at: string | null
}
type GiftEvidence = { id: string; donorId: string; receivedOn: string; netCents: number }
export type CallOutcomeRow = {
 id: string; donorId: string; name: string | null; rank: number; score: number; isAsk: boolean
 reason: string | null; state: Entry['state']; available: boolean; unavailableReason: string | null
 taskId: string | null; taskStatus: string | null; called: boolean | null; calledOn: string | null
 interactionId: string | null; completedAt: string | null; windowEnd: string | null
 windowObservedThrough: string | null; windowClosed: boolean | null; gaveWithinWindow: boolean | null
 gifts: GiftEvidence[]; priorDonor: boolean | null; retentionKind: RetentionKind | null
 retained: boolean | null; fiscalClosed: boolean; includedInRates: boolean
 evidence: { donor: string | null; task: string | null; call: string | null; gifts: string | null; retention: string }
}

/** Outcomes describe observed records; the comparison does not establish that a call caused giving. */
export async function callOutcomes(c: Context, runId: string) {
 requireRole(c.actor, ['owner', 'admin'], 'read ranked call outcomes')
 const run = await one<CallRun>(c, 'SELECT * FROM cf_call_rank_runs WHERE id=?', id(runId, 'Call run'))
 if (!run) fail('NOT_FOUND', 'That ranked call run no longer exists.', 404)
 const s = await settings(c)
 if (s.fiscal_year_start !== run.fiscal_start) fail('FISCAL_SETTINGS_CHANGED',
  `This run used a fiscal-year start of ${run.fiscal_start}; current settings use ${s.fiscal_year_start}. Restore the saved fiscal-year start to read this run, or prepare a new run with current settings.`, 409,
  { savedFiscalStart: run.fiscal_start, currentFiscalStart: s.fiscal_year_start })
 const reportHref = `/app/retention?basis=fiscal&year=${run.fiscal_year}`
 const [report, entries] = await Promise.all([
  retention(c, new URL(reportHref, 'https://coffer.local')),
  all<Entry>(c, `SELECT e.id,e.donor_id,e.rank_num,e.score,e.is_ask,e.reason,e.task_id,e.state,d.name,
   t.status AS task_status,t.completed_at,i.id AS interaction_id,i.occurred_on,i.recorded_at
   FROM cf_call_rank_entries e
   LEFT JOIN cf_donors d ON d.id=e.donor_id AND d.erased_at IS NULL AND d.constituent_status='active'
    AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
   LEFT JOIN cf_call_tasks t ON t.id=e.task_id AND t.donor_id=d.id AND t.task_kind='call'
   LEFT JOIN cf_interactions i ON i.id=t.interaction_id AND i.donor_id=d.id AND i.kind='call'
   WHERE e.run_id=? ORDER BY e.rank_num,e.id`, run.id),
 ])
 const asOf = report.asOf, fiscalEnd = addDays(`${run.fiscal_year + 1}-${run.fiscal_start}`, -1)
 const fiscalClosed = asOf > fiscalEnd
 const classifications = new Map<string, RetentionKind>()
 for (const group of Object.values(report.groups)) for (const row of group.rows) classifications.set(row.donorId, group.kind)
 const completed = (entry: Entry) => entry.state === 'task' && entry.task_status === 'done'
  && entry.completed_at !== null && Number.isFinite(Date.parse(entry.completed_at))
  && Date.parse(entry.completed_at) <= Date.parse(c.now) && entry.interaction_id !== null
  && entry.occurred_on !== null && entry.occurred_on <= asOf && entry.recorded_at !== null
  && Number.isFinite(Date.parse(entry.recorded_at)) && Date.parse(entry.recorded_at) <= Date.parse(c.now)
 const calls = entries.filter(entry => entry.name !== null && completed(entry))
 const gifts = calls.length ? await all<GiftEvidence>(c, `SELECT g.id,g.donor_id AS donorId,g.received_on AS receivedOn,g.net_cents AS netCents
  FROM cf_gift_balances g JOIN cf_donors d ON d.id=g.donor_id
  WHERE g.donor_id IN (SELECT value FROM json_each(?)) AND g.kind='gift' AND g.net_cents>0
   AND g.received_on>=? AND g.received_on<=? AND d.erased_at IS NULL AND d.constituent_status='active'
   AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
   AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id)
  ORDER BY g.received_on,g.id`, JSON.stringify(calls.map(entry => entry.donor_id)),
  calls.reduce((first, entry) => entry.occurred_on! < first ? entry.occurred_on! : first, asOf), asOf) : []
 const rows: CallOutcomeRow[] = entries.map(entry => {
  const available = entry.name !== null, called = available ? completed(entry) : null
  const calledOn = called ? entry.occurred_on : null
  const windowEnd = calledOn ? addDays(calledOn, run.window_days) : null
  const windowObservedThrough = windowEnd ? (windowEnd < asOf ? windowEnd : asOf) : null
  const windowClosed = windowEnd ? asOf > windowEnd : null
  const matchingGifts = calledOn && windowObservedThrough ? gifts.filter(gift => gift.donorId === entry.donor_id
   && gift.receivedOn >= calledOn && gift.receivedOn <= windowObservedThrough) : []
  const kind = available ? classifications.get(entry.donor_id) ?? null : null
  const donorHref = available ? `/app/donors/${encodeURIComponent(entry.donor_id)}` : null
  const timeline = (kind: string, from: string, through: string) => `${donorHref}?timelineKind=${kind}&timelineFrom=${from}&timelineTo=${through}#timeline`
  return {
   id: entry.id, donorId: entry.donor_id, name: entry.name, rank: entry.rank_num, score: entry.score,
   isAsk: !!entry.is_ask, reason: available ? entry.reason : null, state: entry.state, available,
   unavailableReason: available ? null : 'This constituent is no longer active or available.',
   taskId: available ? entry.task_id : null, taskStatus: available ? entry.task_status : null,
   called, calledOn, interactionId: called ? entry.interaction_id : null, completedAt: called ? entry.completed_at : null,
   windowEnd, windowObservedThrough, windowClosed,
   gaveWithinWindow: called ? matchingGifts.length > 0 ? true : windowClosed ? false : null : null,
   gifts: matchingGifts, priorDonor: available ? kind === 'retained' || kind === 'lapsed' : null,
   retentionKind: kind, retained: available && fiscalClosed ? kind === 'retained' : null, fiscalClosed,
   includedInRates: available && entry.state !== 'held',
   evidence: { donor: donorHref, task: available && entry.task_id ? '/app/calls' : null,
    call: calledOn ? timeline('call', calledOn, calledOn) : null,
    gifts: calledOn && windowObservedThrough ? timeline('gift', calledOn, windowObservedThrough) : null,
    retention: reportHref },
  }
 })
 const summarize = (called: boolean) => {
  const cohort = rows.filter(row => row.includedInRates && row.called === called)
  const priorDonors = cohort.filter(row => row.priorDonor).length
  const retained = fiscalClosed ? cohort.filter(row => row.priorDonor && row.retained).length : null
  return { count: cohort.length, priorDonors, retained, pending: fiscalClosed ? 0 : priorDonors,
   notPriorDonors: cohort.length - priorDonors, rate: retained !== null && priorDonors ? retained / priorDonors : null }
 }
 return { run, rows, called: summarize(true), uncalled: summarize(false), fiscalClosed,
  excluded: { held: rows.filter(row => row.state === 'held').length, unavailable: rows.filter(row => !row.available).length,
   total: rows.filter(row => !row.includedInRates).length },
  period: { basis: 'fiscal' as const, year: run.fiscal_year, startMonthDay: run.fiscal_start,
   from: report.current.from, through: fiscalEnd, observedThrough: report.current.through,
   priorFrom: report.prior.from, priorThrough: report.prior.through, asOf, timezone: report.timezone },
  definition: { retention: 'REPORT-001: positive net ledger giving in both the complete prior fiscal year and the run fiscal year.',
   denominator: 'Available assigned and overflow constituents with positive prior fiscal-year net giving; held constituents are excluded. Rates are ratios from zero to one and remain pending until the fiscal year closes.',
   giftWindow: `Positive current net monetary gifts received from the logged call date through ${run.window_days} days later, both dates included, observed only through the organization date. Reversed gifts, in-kind gifts and soft credits are excluded. An unfinished window without a gift remains pending.`,
   comparison: 'Called and uncalled outcomes are observational; no causal effect is attributed to a call.' },
 }
}

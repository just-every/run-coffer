import { emptyTotals } from './source-totals'
import type { ParsedImport } from './types'

export const PART_RECORDS = 800
const PART_BYTES = 400 * 1024
const PART_EFFECTS = 2400

/** Splits one reviewed export into parts that each apply in a single transaction.
 * A part repeats the donors (and pledges, gifts) it refers to; those resolve to the
 * records an earlier part already imported, so links survive across parts. */
export function stageParts(parsed: ParsedImport): ParsedImport[] {
 const donors = new Map(parsed.donors.map(d => [d.externalId, d])), households = new Map(parsed.households.map(h => [h.externalId, h]))
 const pledges = new Map(parsed.pledges.map(p => [p.externalId, p])), gifts = new Map(parsed.gifts.map(g => [g.externalId, g]))
 const parts: ParsedImport[] = []
 const part = (fill: Partial<ParsedImport>, donorIds: Iterable<string>) => {
  const ids = new Set(donorIds)
  // Include each explicit head's actual source row in the first household part.
  // This resolves matches before headship is set, even across chunk boundaries.
  for (const id of ids) { const h=households.get(donors.get(id)?.householdKey||''); if (h?.headExternalId) ids.add(h.headExternalId) }
  const linked = new Set([...(fill.gifts ?? []), ...(fill.softCredits ?? [])].map(g => g.acknowledgment?.interactionExternalId).filter(Boolean))
  const notes = [...new Map([...(fill.notes ?? []), ...parsed.notes.filter(n => linked.has(n.externalId))].map(n => [n.externalId, n])).values()]
  for (const n of notes) ids.add(n.donorExternalId)
  const ds = [...ids].map(id => donors.get(id)).filter(d => d !== undefined)
  parts.push({ source: parsed.source, spreadsheet:parsed.spreadsheet, donors: ds, households: [...new Set(ds.map(d => d.householdKey).filter(Boolean))].map(k => households.get(k)!).filter(Boolean),
   gifts: [], relationships: [], softCredits: [], pledges: [], installments: [], unmapped: [], diagnostics: [], sourceTotals: emptyTotals(), mappedTotals: emptyTotals(), controlTotals: [], files: [], solicitCodes: parsed.solicitCodes, sourceTags:(parsed.sourceTags??[]).filter(r=>ids.has(r.donorExternalId)), solicitations:(parsed.solicitations??[]).filter(r=>ids.has(r.donorExternalId)), channelWithdrawals:(parsed.channelWithdrawals??[]).filter(r=>ids.has(r.donorExternalId)), ...fill, notes })
 }
 // A part also stays under PART_BYTES of its own records, so long notes never push one past D1's 2 MB value limit.
 const chunks = <T>(rows: T[], size = PART_RECORDS, weight:(row:T)=>number=()=>1) => {
  const out: T[][] = []; let chunk: T[] = [], bytes = 0, effects=0
  for (const row of rows) {
   const length = JSON.stringify(row).length,cost=weight(row)
   if (chunk.length && (chunk.length >= size || bytes + length > PART_BYTES || effects+cost>PART_EFFECTS)) { out.push(chunk); chunk = []; bytes = 0; effects=0 }
   chunk.push(row); bytes += length; effects+=cost
  }
  if (chunk.length) out.push(chunk)
  return out
 }
 const sourceCosts=new Map<string,number>()
 for(const r of [...(parsed.sourceTags??[]),...(parsed.channelWithdrawals??[]),...(parsed.solicitations??[])])sourceCosts.set(r.donorExternalId,(sourceCosts.get(r.donorExternalId)??0)+2)
 const donorCost=(d:ParsedImport['donors'][number])=>1+(d.contacts?.length??0)+(d.householdKey?1:0)+(d.recognitionName?1:0)+(sourceCosts.get(d.externalId)??0)
 for (const chunk of chunks(parsed.donors,PART_RECORDS,donorCost)) part({}, chunk.map(d => d.externalId))
 for (const chunk of chunks(parsed.sourceHistory??[])) part({sourceHistory:chunk},chunk.map(r=>r.donorExternalId))
 for (const chunk of chunks(parsed.volunteering??[])) part({volunteering:chunk},chunk.map(r=>r.donorExternalId))
 for (const chunk of chunks(parsed.recurringReferences??[])) part({recurringReferences:chunk},chunk.map(r=>r.donorExternalId))
 for (const chunk of chunks(parsed.relationships)) part({ relationships: chunk }, chunk.flatMap(r => [r.donorExternalId, r.relatedDonorExternalId]))
 const installmentsOf = (ids: Set<string>) => parsed.installments.filter(i => ids.has(i.pledgeExternalId))
 for (const chunk of chunks(parsed.pledges, PART_RECORDS / 2)) part({ pledges: chunk, installments: installmentsOf(new Set(chunk.map(p => p.externalId))) }, chunk.map(p => p.donorExternalId))
 // A pledge's payments stay in one part, so installments are paid in date order.
 const groups = new Map<string, typeof parsed.gifts>()
 for (const g of parsed.gifts) { const key = g.pledgeExternalId ? `pledge:${g.pledgeExternalId}` : `gift:${g.externalId}`; groups.set(key, [...(groups.get(key) ?? []), g]) }
 let batch: typeof parsed.gifts = []
 const flushGifts = () => {
  if (!batch.length) return
  const ids = new Set(batch.map(g => g.pledgeExternalId).filter(Boolean)), used = [...ids].map(id => pledges.get(id)!).filter(Boolean)
  part({ gifts: batch, pledges: used, installments: installmentsOf(ids) }, [...batch.map(g => g.donorExternalId), ...used.map(p => p.donorExternalId)])
  batch = []
 }
 let batchBytes = 0
 for (const group of groups.values()) {
  const bytes = JSON.stringify(group).length
  if (batch.length + group.length > PART_RECORDS || batchBytes + bytes > PART_BYTES) { flushGifts(); batchBytes = 0 }
  batch.push(...group); batchBytes += bytes
 }
 flushGifts()
 for (const chunk of chunks(parsed.softCredits)) {
  // A credited pledge payment brings its whole pledge, so the payment split matches the earlier part.
  const credited = new Map<string, (typeof parsed.gifts)[number]>()
  for (const s of chunk) { const g = gifts.get(s.giftExternalId); if (!g) continue; for (const x of g.pledgeExternalId ? groups.get(`pledge:${g.pledgeExternalId}`)! : [g]) credited.set(x.externalId, x) }
  const ids = new Set([...credited.values()].map(g => g.pledgeExternalId).filter(Boolean)), used = [...ids].map(id => pledges.get(id)!).filter(Boolean)
  part({ softCredits: chunk, gifts: [...credited.values()], pledges: used, installments: installmentsOf(ids) }, [...chunk.map(s => s.donorExternalId), ...[...credited.values()].map(g => g.donorExternalId), ...used.map(p => p.donorExternalId)])
 }
 for (const chunk of chunks(parsed.notes)) part({ notes: chunk }, chunk.map(n => n.donorExternalId))
 return parts
}

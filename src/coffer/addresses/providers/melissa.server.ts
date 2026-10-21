import type { ProviderFetch, SmartMoverRequest, SmartMoverResult } from './types'
import { completeAddress, isUnitedStates, object, postJson } from './transport.server'
import { normalizeMoverRecord, resultCodes } from './melissa-normalize.server'

// Server handler imports only; CustomerID is in the HTTPS body, never a query.
// https://docs.melissa.com/cloud-api/smartmover/smartmover-reference-guide.html
// https://wiki.melissadata.com/?title=SmartMover_V3%3AFAQ
export async function runMelissaSmartMover(input: SmartMoverRequest, fetcher?: ProviderFetch): Promise<SmartMoverResult> {
 const error = (reason: Extract<SmartMoverResult, { status: 'error' }>['reason']): SmartMoverResult => ({ status: 'error', reason, results: [] })
 if (!input.customerId?.trim()) return error('not_configured')
 if (input.pafConfirmed !== true) return error('paf_required')
 // The caller must count the real, deduplicated full list and process every batch.
 // USPS does not permit fabricating records to reach this minimum.
 if (!Number.isSafeInteger(input.listSize) || input.listSize < 100) return error('list_too_small')
 if (!input.records.length || input.records.length > 100 || input.records.length > input.listSize) return error('invalid_request')
 if (!/^[^\s\\/*:?”"<>|\x00-\x1f]{1,50}$/.test(input.jobId) || !input.executionId?.trim() || !input.transmissionReference?.trim()) return error('invalid_request')
 const ids = new Set<string>(), identities = new Set<string>()
 for (const record of input.records) {
  if (!record.identity.id.trim() || !record.identity.name.trim() || !['person', 'organization'].includes(record.identity.kind) || !isUnitedStates(record.address.country) || !completeAddress(record.address)) return error('invalid_request')
  const unique = JSON.stringify([record.identity.name, record.address.street, record.address.street2 ?? '', record.address.city, record.address.state, record.address.postalCode].map(value => value.trim().toUpperCase()))
  if (ids.has(record.identity.id) || identities.has(unique)) return error('invalid_request')
  ids.add(record.identity.id)
  identities.add(unique)
 }
 const response = await postJson('https://smartmover.melissadata.net/V3/WEB/SmartMover/doSmartMover', {
  Actions: 'NCOA', Columns: 'MoveReturnCode,DPVFootNotes,Plus4', CustomerID: input.customerId.trim(),
  JobID: input.jobId, ExecutionID: input.executionId, TransmissionReference: input.transmissionReference,
  ...(input.pafId?.trim() ? { PAFId: input.pafId.trim() } : {}),
  Records: input.records.map(({ identity, address }) => ({
   RecordID: identity.id, ...(identity.kind === 'organization' ? { Company: identity.name } : { NameFull: identity.name }),
   AddressLine1: address.street, AddressLine2: address.street2 ?? '', City: address.city,
   State: address.state, PostalCode: address.postalCode, Country: 'US',
  })),
 }, {}, fetcher)
 if ('error' in response) return error(response.error)
 const body = object(response.value)
 if (!body || typeof body.TransmissionResults !== 'string') return error('invalid_response')
 if (body.TransmissionResults.trim()) return error('provider_error')
 if (body.TransmissionReference !== input.transmissionReference || !Array.isArray(body.Records)) return error('invalid_response')
 const records = body.Records.map(object)
 if (records.length !== input.records.length || String(body.TotalRecords) !== String(records.length)) return error('invalid_response')
 const seen = new Set<string>()
 const results = []
 for (const record of records) {
  if (!record || typeof record.RecordID !== 'string' || !ids.has(record.RecordID) || seen.has(record.RecordID)) return error('invalid_response')
  const codes = resultCodes(record.Results)
  if (!codes?.length) return error('invalid_response')
  if (codes.some(code => code.startsWith('SE') || code.startsWith('GE'))) return error('provider_error')
  // Requested code fields must remain strings; never persist their raw values.
  if (record.MoveReturnCode !== undefined && typeof record.MoveReturnCode !== 'string') return error('invalid_response')
  if (record.DPVFootNotes !== undefined && typeof record.DPVFootNotes !== 'string') return error('invalid_response')
  seen.add(record.RecordID)
  results.push(normalizeMoverRecord(record, record.RecordID, codes))
 }
 if (seen.size !== ids.size) return error('invalid_response')
 // Return the request order even when the provider reorders its response array.
 const byId = new Map(results.map(result => [result.id, result]))
 return { status: 'completed', results: input.records.map(record => byId.get(record.identity.id)!) }
}

/** Server-side, read-only enrichment. Source numbers stay distinct from API IDs. */
export type SourceDefinition = {
 id: string
 name: string
 kind: 'constituent' | 'gift' | 'interaction' | 'note'
 type: 'text' | 'number' | 'currency' | 'date' | 'year' | 'checkbox'
 entry: 'free-form' | 'pick-one' | 'pick-many'
 choices: string[]
 values: { recordId: string; value: unknown; reason?: string }[]
}
export type SourceRecord = { kind: SourceDefinition['kind']; externalId: string }
type ObjectValue = Record<string, unknown>
type Definition = { field: SourceDefinition; choices: Map<string, string> }
type Read = (path: string, query?: Record<string, string>) => Promise<unknown>

const ORIGIN = 'https://api.bloomerang.co/v2'
const MAX_RECORDS = 10_000, MAX_FIELDS = 100, MAX_CHOICES = 100
const PAGE_SIZE = 50, MAX_PAGES = MAX_RECORDS / PAGE_SIZE, MAX_BYTES = 2_000_000
const sourceTypes = { constituent: 'Constituent', gift: 'Transaction', interaction: 'Interaction', note: 'Note' } as const
const dataTypes: Record<string, SourceDefinition['type']> = { Text: 'text', Decimal: 'number', Currency: 'currency', Date: 'date', Year: 'year' }
const pickTypes: Record<string, SourceDefinition['entry']> = { Freeform: 'free-form', PickOne: 'pick-one', PickMultiple: 'pick-many' }
function invalid(message: string): never { throw Error(`Bloomerang: ${message}`) }
function object(value: unknown): ObjectValue {
 if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('an object response was expected.')
 return value as ObjectValue
}
function list(value: unknown, max: number): unknown[] {
 if (!Array.isArray(value) || value.length > max) invalid('a response list is invalid or exceeds the supported limit.')
 return value
}
function sourceId(value: unknown): string {
 if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid('an API identifier is invalid or cannot be represented exactly.')
 return String(value)
}
function label(value: unknown): string {
 if (typeof value !== 'string' || !value.trim() || value.length > 2000) invalid('a field name or choice is invalid.')
 return value
}

/** Never propagate upstream bodies, fetch errors, or headers that could expose a key. */
function reader(apiKey: string): Read {
 let requests = 0
 return async (path, query = {}) => {
  if (++requests > 3000) invalid('the request limit was reached; nothing was enriched.')
  const url = new URL(ORIGIN + path)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000)
  let stream: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
   const response = await fetch(url, { method: 'GET', headers: { 'X-API-KEY': apiKey, Accept: 'application/json, text/json' }, redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal })
   if (!response.ok) invalid(`the read request failed (HTTP ${response.status}); nothing was enriched.`)
   if (!response.body) invalid('the API returned an empty body.')
   stream = response.body.getReader()
   const decoder = new TextDecoder('utf-8', { fatal: true })
   let bytes = 0, body = ''
   for (;;) {
    const chunk = await stream.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > MAX_BYTES) invalid('a response exceeds the supported size; nothing was enriched.')
    body += decoder.decode(chunk.value, { stream: true })
   }
   body += decoder.decode()
   try { return JSON.parse(body) as unknown } catch { invalid('the API returned invalid JSON; nothing was enriched.') }
  } catch (error) {
   if (error instanceof Error && error.message.startsWith('Bloomerang: ')) throw error
   invalid('the read request could not complete; nothing was enriched.')
  } finally {
   clearTimeout(timeout)
   try { await stream?.cancel() } catch { /* No upstream error text is exposed. */ }
  }
 }
}

/** These endpoints are arrays, without documented pagination. Read both statuses for history. */
async function definitions(read: Read, kind: SourceRecord['kind']): Promise<Map<string, Definition>> {
 const type = sourceTypes[kind], result = new Map<string, Definition>()
 const pages = await Promise.all(['true', 'false'].map(isActive => read(`/customFields/${type}/`, { isActive })))
 for (const raw of pages.flatMap(page => list(page, MAX_FIELDS))) {
  const row = object(raw), id = sourceId(row.Id)
  const valueType = typeof row.DataType === 'string' && Object.hasOwn(dataTypes, row.DataType) ? dataTypes[row.DataType] : undefined
  const entry = typeof row.PickType === 'string' && Object.hasOwn(pickTypes, row.PickType) ? pickTypes[row.PickType] : undefined
  if (!valueType || !entry) invalid('an unsupported custom data type or entry method was returned.')
  if (result.has(id) || result.size >= MAX_FIELDS) invalid('custom definitions are duplicate or exceed the supported limit.')
  const field: SourceDefinition = { id, name: label(row.Name), kind, type: valueType, entry, choices: [], values: [] }
  const choices = new Map<string, string>()
  if (entry !== 'free-form') {
   const values = await Promise.all(['true', 'false'].map(isActive => read(`/customValues/${type}/${id}`, { isActive })))
   for (const rawChoice of values.flatMap(page => list(page, MAX_CHOICES))) {
    const choice = object(rawChoice), choiceId = sourceId(choice.Id), value = label(choice.Value)
    if (sourceId(choice.FieldId) !== id || choices.has(choiceId) || field.choices.includes(value) || choices.size >= MAX_CHOICES) invalid('custom choices are ambiguous or exceed the supported limit.')
    choices.set(choiceId, value); field.choices.push(value)
   }
   if (!choices.size) invalid('a pick field has no supported choices.')
  }
  result.set(id, { field, choices })
 }
 return result
}

/** Finish the entire filtered list; finding a match early does not establish uniqueness. */
async function paged(read: Read, path: string, query: Record<string, string>, visit: (row: ObjectValue) => void) {
 let skip = 0, total: number | undefined
 const ids = new Set<string>()
 for (let page = 0; page < MAX_PAGES; page++) {
  const response = object(await read(path, { ...query, skip: String(skip), take: String(PAGE_SIZE) }))
  const rows = list(response.Results, PAGE_SIZE), count = response.TotalFiltered
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > MAX_RECORDS || total !== undefined && count !== total || response.Start !== skip || response.ResultCount !== rows.length || skip + rows.length > count) invalid('pagination is incomplete, changed, or exceeds 10,000 records; nothing was enriched.')
  total = count
  for (const raw of rows) {
   const row = object(raw), id = sourceId(row.Id)
   if (ids.has(id)) invalid('pagination returned a repeated record; nothing was enriched.')
   ids.add(id); visit(row)
  }
  skip += rows.length
  if (skip === total) return
  if (!rows.length) invalid('pagination stopped before all records were read; nothing was enriched.')
 }
 invalid('pagination exceeded its bound; nothing was enriched.')
}

async function sourceRecords(read: Read, kind: SourceRecord['kind'], records: SourceRecord[]) {
 const requested = new Set(records.map(row => row.externalId)), found = new Map<string, ObjectValue>()
 const remember = (row: ObjectValue, number: unknown) => {
  const externalId = sourceId(number)
  if (!requested.has(externalId)) return
  if (found.has(externalId)) invalid('a source number matches multiple API records; nothing was enriched.')
  if (kind === 'gift' && (typeof row.Type !== 'string' || !['Donation', 'PledgePayment', 'RecurringDonationPayment'].includes(row.Type))) invalid('a gift source number refers to an unsupported designation type.')
  found.set(externalId, row)
 }
 if (kind === 'constituent') {
  // AccountNumber has no documented exact API filter. Never use it as constituent Id.
  await paged(read, '/constituents', { orderBy: 'Id', orderDirection: 'Asc' }, row => remember(row, row.AccountNumber))
 } else {
  const numbers = [...requested]
  for (let start = 0; start < numbers.length; start += PAGE_SIZE) {
   const batch = new Set(numbers.slice(start, start + PAGE_SIZE))
   const path = kind === 'gift' ? '/transactions/designations' : `/${kind}s`
   const filter = kind === 'gift' ? 'designationNumbers' : 'id'
   await paged(read, path, { [filter]: [...batch].join('|') }, row => {
    const number = kind === 'gift' ? row.DesignationNumber : row.Id
    if (!batch.has(sourceId(number))) invalid('a source ID filter returned an unrelated record.')
    remember(row, number)
   })
  }
 }
 if (found.size !== requested.size) invalid('some imported source numbers could not be resolved; nothing was enriched.')
 return found
}

function assignments(recordId: string, record: ObjectValue, fields: Map<string, Definition>) {
 const seen = new Set<string>()
 // CustomValues is optional in the published schema; absent means no assignments.
 for (const raw of record.CustomValues === undefined ? [] : list(record.CustomValues, MAX_FIELDS)) {
  const assignment = object(raw), fieldId = sourceId(assignment.FieldId), definition = fields.get(fieldId)
  if (!definition || seen.has(fieldId)) invalid('a custom assignment has an unknown or repeated field.')
  seen.add(fieldId)
  const { field, choices } = definition, multiple = field.entry === 'pick-many'
  if (multiple ? Object.hasOwn(assignment, 'Value') : Object.hasOwn(assignment, 'Values')) invalid('a custom assignment has the wrong entry method.')
  const rawValues = multiple ? list(assignment.Values, MAX_CHOICES) : [assignment.Value]
  let reason: string | undefined
  const values = rawValues.map(rawValue => {
   const value = object(rawValue)
   if (typeof value.Value !== 'string' || value.Value.length > 2000) invalid('a custom value is not a supported string.')
   if (field.entry !== 'free-form' && choices.get(sourceId(value.Id)) !== value.Value) reason = 'The source choice identifier and value do not match the fetched definition. Review the original value before importing.'
   return value.Value
  })
  if (new Set(values).size !== values.length) reason = 'The source assignment repeats a selected value. Review the original list before importing.'
  // Empty multi-selection is an unset value, never an instruction to clear Coffer data.
  if (multiple && !values.length) continue
  field.values.push({ recordId, value: multiple ? values : values[0], ...(reason ? { reason } : {}) })
 }
}

/** externalId: AccountNumber for constituents, DesignationNumber for gifts, API Id otherwise. */
export async function readBloomerangCustom(apiKey: string, records: SourceRecord[]): Promise<SourceDefinition[]> {
 if (typeof window !== 'undefined') invalid('custom data must be read on the server.')
 if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096 || /[\s\x00-\x1f\x7f]/.test(apiKey)) invalid('supply a private API key for this read.')
 if (!Array.isArray(records) || records.length > MAX_RECORDS) invalid('supply at most 10,000 imported source records.')
 const unique = new Map<string, SourceRecord>()
 for (const record of records) {
  if (!record || !Object.hasOwn(sourceTypes, record.kind) || typeof record.externalId !== 'string' || !/^[1-9]\d*$/.test(record.externalId) || !Number.isSafeInteger(Number(record.externalId))) invalid('use a supported source kind and an exact positive source number.')
  unique.set(`${record.kind}:${record.externalId}`, record)
 }
 const read = reader(apiKey), result: SourceDefinition[] = []
 for (const kind of Object.keys(sourceTypes) as SourceRecord['kind'][]) {
  const selected = [...unique.values()].filter(record => record.kind === kind)
  if (!selected.length) continue
  const [fields, resolved] = await Promise.all([definitions(read, kind), sourceRecords(read, kind, selected)])
  for (const [externalId, record] of resolved) assignments(externalId, record, fields)
  result.push(...[...fields.values()].map(definition => definition.field))
 }
 return result
}

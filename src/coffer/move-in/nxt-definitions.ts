import type { SourceDefinition } from './source-definitions'
import type { SourceRecord } from './custom-review-types'

type NxtRecord = Pick<SourceRecord, 'kind' | 'externalId'> & { idType?: 'system' | 'lookup'; sourceObject?: 'action' | 'note' }
type ObjectValue = Record<string, unknown>
type Area = 'Constituent' | 'Gift' | 'Action'
type Read = (path: string, query?: Record<string, string>) => Promise<unknown>
type Definition = { field: SourceDefinition; sourceType: string }
const ORIGIN = 'https://api.sky.blackbaud.com'
const MAX_RECORDS = 10_000, MAX_FIELDS = 100, MAX_CHOICES = 100, PAGE_SIZE = 50, MAX_BYTES = 2_000_000
const paths: Record<Area, string> = { Constituent: '/constituent/v1/constituents', Gift: '/gift/v1/gifts', Action: '/constituent/v1/actions' }
const sourceTypes: Record<string, string> = { Text: 'Text', Number: 'Number', Currency: 'Currency', Date: 'Date', Boolean: 'Boolean', Table: 'CodeTableEntry', Constituent: 'ConstituentId', FuzzyDate: 'FuzzyDate' }
const targetTypes: Record<string, SourceDefinition['type']> = { Text: 'text', Number: 'number', Currency: 'currency', Date: 'date', Boolean: 'checkbox', Table: 'text', Constituent: 'text', FuzzyDate: 'date' }
function invalid(message: string): never { throw Error(`Raiser's Edge NXT: ${message}`) }
function object(value: unknown): ObjectValue {
 if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('an object response was expected.')
 return value as ObjectValue
}
function label(value: unknown): string {
 if (typeof value !== 'string' || !value.trim() || value.length > 2000) invalid('a source name is invalid.')
 return value
}
function systemId(value: unknown): string {
 if (typeof value !== 'string' || !/^[1-9]\d{0,127}$/.test(value)) invalid('a system record ID is invalid or not exact.')
 return value
}
function categoryId(value: unknown): string {
 if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) invalid('a category or code table ID is invalid.')
 return String(value)
}

/** Credentials exist only in this read closure. No upstream error text escapes. */
function reader(token: string, subscriptionKey: string): Read {
 let requests = 0
 return async (path, query = {}) => {
  if (++requests > 12_000) invalid('the request bound was reached; nothing was captured.')
  const url = new URL(ORIGIN + path)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000)
  let stream: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
   const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'Bb-Api-Subscription-Key': subscriptionKey, Accept: 'application/json' }, redirect: 'manual', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal })
   if (!response.ok) invalid(`the read request failed (HTTP ${response.status}); nothing was captured.`)
   if (!response.body) invalid('the API returned an empty body.')
   stream = response.body.getReader()
   const decoder = new TextDecoder('utf-8', { fatal: true })
   let bytes = 0, body = ''
   for (;;) {
    const chunk = await stream.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > MAX_BYTES) invalid('a response exceeds the supported size; nothing was captured.')
    body += decoder.decode(chunk.value, { stream: true })
   }
   body += decoder.decode()
   try { return JSON.parse(body) as unknown } catch { invalid('the API returned invalid JSON.') }
  } catch (error) {
   if (error instanceof Error && error.message.startsWith("Raiser's Edge NXT: ")) throw error
   invalid('the read request could not complete; nothing was captured.')
  } finally {
   clearTimeout(timer)
   try { await stream?.cancel() } catch { /* Upstream text stays private. */ }
  }
 }
}

function collection(response: ObjectValue, key: string, bound: number): unknown[] {
 const rows = response[key], count = response.count
 if (!Array.isArray(rows) || rows.length > bound || typeof count !== 'number' || !Number.isSafeInteger(count) || count < rows.length || count > bound) invalid('a collection is invalid or exceeds its supported bound.')
 return rows
}
/** These individual-record and category-detail endpoints document no paging inputs. */
async function complete(read: Read, path: string, bound: number): Promise<unknown[]> {
 const response = object(await read(path)), rows = collection(response, 'value', bound)
 if (response.count !== rows.length || response.next_link) invalid('an unpaged endpoint returned an incomplete collection.')
 return rows
}
/** Rebuild only documented offset queries; never follow provider-supplied URLs. */
async function paged(read: Read, path: string, query: Record<string, string>, bound: number, key = 'value'): Promise<ObjectValue[]> {
 const result: ObjectValue[] = [], ids = new Set<string>()
 let total: unknown
 for (let page = 0; page < Math.ceil(bound / PAGE_SIZE) + 1; page++) {
  const response = object(await read(path, { ...query, limit: String(PAGE_SIZE), offset: String(result.length) }))
  const rows = collection(response, key, bound)
  if (rows.length > PAGE_SIZE || total !== undefined && total !== response.count || result.length + rows.length > Number(response.count)) invalid('a paged collection changed or is incomplete.')
  if (key === 'custom_field_categories' && (response.offset !== result.length || response.limit !== PAGE_SIZE)) invalid('category pagination metadata does not match the request.')
  total = response.count
  for (const raw of rows) {
   const row = object(raw), id = key === 'custom_field_categories' ? categoryId(row.custom_field_category_id) : systemId(row.table_entries_id ?? row.id)
   if (ids.has(id)) invalid('pagination repeated a source record.')
   ids.add(id); result.push(row)
  }
  if (result.length === total) {
   if (response.next_link) invalid('pagination reports additional data beyond its count.')
   return result
  }
  if (!rows.length) invalid('pagination stopped before its complete count.')
 }
 invalid('pagination exceeded its supported bound.')
}

async function definitions(read: Read, area: Area, kind: SourceDefinition['kind']): Promise<Map<string, Definition>> {
 const detailPath = paths[area] + '/customfields/categories' + (area === 'Gift' ? '' : '/details')
 const [categories, details] = await Promise.all([
  paged(read, '/customfield/customfieldcategories', { record_type: area, include_inactive: 'true' }, MAX_FIELDS, 'custom_field_categories'),
  complete(read, detailPath, MAX_FIELDS),
 ])
 const byName = new Map<string, ObjectValue>(), fields = new Map<string, Definition>()
 for (const raw of details) {
  const row = object(raw), name = label(row.name)
  if (byName.has(name)) invalid('category descriptions are ambiguous.')
  byName.set(name, row)
 }
 for (const row of categories) {
  const name = label(row.description), type = row.type_of_data
  if (typeof type !== 'string' || !Object.hasOwn(sourceTypes, type)) invalid('an unsupported category data type was returned.')
  const detail = byName.get(name), sourceType = sourceTypes[type]
  if (!detail || detail.type !== sourceType) invalid('category metadata is missing or changed between reads.')
  if (fields.has(name)) invalid('category descriptions are ambiguous.')
  const table = type === 'Table'
  if (table && typeof detail.one_per_record !== 'boolean') invalid('a table category has no documented one-per-record setting.')
  const field: SourceDefinition = { id: `nxt_${kind}_${categoryId(row.custom_field_category_id)}`, name, kind, type: targetTypes[type], entry: table ? detail.one_per_record ? 'pick-one' : 'pick-many' : 'free-form', choices: [], values: [] }
  if (table) {
   const tableId = categoryId(row.code_table_id)
   if (detail.code_table_id !== tableId) invalid('category code table identifiers do not agree.')
   const entries = await paged(read, `/codetable/v1/codetables/${tableId}/tableentries`, { include_inactive: 'true' }, MAX_CHOICES)
   for (const entry of entries) {
    const choice = label(entry.long_description)
    if (entry.code_tables_id !== tableId || field.choices.includes(choice)) invalid('code table entries are unrelated or ambiguous.')
    field.choices.push(choice)
   }
   if (!field.choices.length) invalid('a table category has no supported choices.')
  }
  fields.set(name, { field, sourceType })
 }
 return fields
}

function areaOf(record: NxtRecord): Area {
 if (record.kind === 'constituent') return 'Constituent'
 if (record.kind === 'gift') return 'Gift'
 if (record.kind === 'interaction' || record.kind === 'note' && record.sourceObject === 'action') return 'Action'
 invalid('note custom fields require explicit action provenance; ordinary notes have no documented custom-field endpoint.')
}
async function resolve(read: Read, area: Area, records: NxtRecord[]): Promise<Map<string, string>> {
 const found = new Map<string, string>(), wanted = new Set(records.filter(row => row.idType === 'lookup').map(row => row.externalId))
 if (wanted.size) {
  if (area === 'Action') invalid('action lookup identifiers are unsupported; export the action system record ID.')
  const query: Record<string, string> = area === 'Constituent' ? { include_deceased: 'true', include_inactive: 'true', fields: 'id,lookup_id' } : {}
  const rows = await paged(read, paths[area], query, MAX_RECORDS)
  for (const row of rows) {
   if (typeof row.lookup_id !== 'string' || !wanted.has(row.lookup_id)) continue
   if (found.has(row.lookup_id)) invalid('a lookup identifier matches multiple API records.')
   found.set(row.lookup_id, systemId(row.id))
  }
  if (found.size !== wanted.size) invalid('an imported lookup identifier could not be resolved exactly.')
 }
 for (const record of records.filter(row => row.idType === 'system')) {
  const id = systemId(record.externalId), row = object(await read(`${paths[area]}/${id}`))
  if (row.id !== id) invalid('a record response does not match the requested system ID.')
  found.set(record.externalId, id)
 }
 if (new Set(found.values()).size !== found.size) invalid('different imported source identifiers resolve to the same record.')
 return found
}

function valueReason(definition: Definition, row: ObjectValue): string | undefined {
 const { field, sourceType } = definition, value = row.value
 if (!Object.hasOwn(row, 'value')) return 'The source assignment has no value. Fix or skip this assignment.'
 if (row.type !== sourceType) return 'The assignment type differs from its source definition. Review the original value.'
 if (sourceType === 'ConstituentId') return 'A source constituent reference needs an explicit destination mapping. Review or skip this value.'
 if (sourceType === 'FuzzyDate') return 'A partial source date needs explicit review. No missing date components were invented.'
 if (sourceType === 'Text' && (typeof value !== 'string' || !value.trim() || value.length > 255)) return 'The source text is empty or invalid. Review the original value.'
 if (sourceType === 'Number' && (typeof value !== 'number' || !Number.isSafeInteger(value))) return 'The source number is not an exact integer. Review the original value.'
 if (sourceType === 'Currency' && (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(Math.round(value * 100)) || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value)))) return 'The source currency is not an exact supported decimal amount. Review the original value.'
 if (sourceType === 'Boolean' && typeof value !== 'boolean') return 'The source Boolean is invalid. Review the original value.'
 if (sourceType === 'Date' && typeof value !== 'string') return 'The source date is invalid. Review the original value.'
 if (sourceType === 'CodeTableEntry' && (typeof value !== 'string' || !field.choices.includes(value))) return 'The source choice is absent from the complete code table. Review the original value.'
}
async function assignments(read: Read, area: Area, record: NxtRecord, id: string, fields: Map<string, Definition>): Promise<number> {
 const rows = await complete(read, `${paths[area]}/${id}/customfields`, MAX_RECORDS), grouped = new Map<string, ObjectValue[]>(), ids = new Set<string>()
 for (const raw of rows) {
  const row = object(raw), assignmentId = systemId(row.id), name = label(row.category)
  if (row.parent_id !== id || ids.has(assignmentId) || !fields.has(name)) invalid('a custom assignment is unrelated, repeated, or has an unknown category.')
  ids.add(assignmentId)
  const group = grouped.get(name) ?? []; group.push(row); grouped.set(name, group)
 }
 for (const [name, group] of grouped) {
  const definition = fields.get(name)!, { field } = definition, multiple = field.entry === 'pick-many'
  const values = group.map(row => Object.hasOwn(row, 'value') ? row.value : null)
  let reason = group.map(row => valueReason(definition, row)).find(Boolean)
  if (!multiple && group.length > 1) reason = 'Multiple source assignments cannot fit one destination value. Review every original value before importing.'
  if (multiple && new Set(values).size !== values.length) reason = 'The source repeats a selected value. Review the original selections before importing.'
  field.values.push({ recordId: record.externalId, value: multiple || group.length > 1 ? values : values[0], ...(reason ? { reason } : {}) })
 }
 return rows.length
}

/** Call only from an authorized server handler, with exact imported ID provenance. */
export async function readNxtCustom(token: string, subscriptionKey: string, records: NxtRecord[]): Promise<SourceDefinition[]> {
 if (typeof window !== 'undefined') invalid('custom data must be read on the server.')
 for (const credential of [token, subscriptionKey]) if (typeof credential !== 'string' || !credential || credential.length > 8192 || /[\s\x00-\x1f\x7f]/.test(credential)) invalid('supply a private access token and API subscription key for this read.')
 if (!Array.isArray(records) || records.length > MAX_RECORDS) invalid('supply at most 10,000 imported source records.')
 const unique = new Map<string, NxtRecord>()
 for (const record of records) {
  if (!record || !['constituent', 'gift', 'interaction', 'note'].includes(record.kind) || typeof record.externalId !== 'string' || !record.externalId.trim() || record.externalId.length > 128 || /[\x00-\x1f\x7f]/.test(record.externalId)) invalid('an imported record identifier is invalid.')
  if (record.idType !== 'system' && record.idType !== 'lookup') invalid('source identifiers need explicit system or lookup provenance; export and import the original ID column again.')
  if (record.sourceObject !== undefined && record.sourceObject !== 'action' && record.sourceObject !== 'note') invalid('the source object provenance is invalid.')
  if (record.sourceObject === 'note' && record.kind !== 'note' || record.sourceObject === 'action' && !['interaction', 'note'].includes(record.kind)) invalid('source object provenance conflicts with its imported kind.')
  const area = areaOf(record)
  if (area === 'Action' && record.idType !== 'system') invalid('actions require explicit system record IDs.')
  if (record.idType === 'system') systemId(record.externalId)
  const key = `${record.kind}:${record.externalId}`, previous = unique.get(key)
  if (previous && (previous.idType !== record.idType || previous.sourceObject !== record.sourceObject)) invalid('one source record has conflicting ID provenance.')
  unique.set(key, record)
 }
 const read = reader(token, subscriptionKey), result: SourceDefinition[] = []
 let assignmentsRead = 0
 for (const kind of ['constituent', 'gift', 'interaction', 'note'] as const) {
  const selected = [...unique.values()].filter(record => record.kind === kind)
  if (!selected.length) continue
  const area = areaOf(selected[0]), [fields, resolved] = await Promise.all([definitions(read, area, kind), resolve(read, area, selected)])
  for (const record of selected) {
   assignmentsRead += await assignments(read, area, record, resolved.get(record.externalId)!, fields)
   if (assignmentsRead > MAX_RECORDS) invalid('custom assignments exceed 10,000; nothing was captured.')
  }
  result.push(...[...fields.values()].map(definition => definition.field))
 }
 return result
}

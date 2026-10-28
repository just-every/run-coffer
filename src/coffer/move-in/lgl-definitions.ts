import type { SourceDefinition } from './source-definitions'

type SourceRecord = { kind: SourceDefinition['kind']; externalId: string }
type ObjectValue = Record<string, unknown>
type Read = (path: string, query?: Record<string, string>) => Promise<unknown>
type Category = { field: SourceDefinition; choices: Map<string, string>; facet: string }
const ORIGIN = 'https://api.littlegreenlight.com/api/v1'
const PAGE_SIZE = 25, MAX_RECORDS = 1000, MAX_FIELDS = 100, MAX_CHOICES = 1000
const MAX_REQUESTS = 3000, MAX_BYTES = 2_000_000
const kinds = { constituent: 'Constituent', gift: 'Gift' } as const

function invalid(message: string): never { throw Error(`Little Green Light: ${message}`) }
function object(value: unknown): ObjectValue {
 if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('an object response was expected.')
 return value as ObjectValue
}
function list(value: unknown, max: number): unknown[] {
 if (!Array.isArray(value) || value.length > max) invalid('a response list is invalid or exceeds the supported limit.')
 return value
}
function sourceId(value: unknown): string {
 if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid('an API identifier cannot be represented exactly.')
 return String(value)
}
function label(value: unknown): string {
 if (typeof value !== 'string' || !value.trim() || value.length > 2000) invalid('a definition name or choice is invalid.')
 return value
}

/** Never expose upstream bodies, headers, transport errors, or the private key. */
function reader(apiKey: string): Read {
 let requests = 0
 return async (path, query = {}) => {
  if (++requests > MAX_REQUESTS) invalid('the request limit was reached; nothing was enriched.')
  const url = new URL(ORIGIN + path)
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000)
  let stream: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
   const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, redirect: 'manual', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal })
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
   if (error instanceof Error && error.message.startsWith('Little Green Light: ')) throw error
   invalid('the read request could not complete; nothing was enriched.')
  } finally {
   clearTimeout(timer)
   try { await stream?.cancel() } catch { /* Do not expose upstream details. */ }
  }
 }
}

/** Construct offsets locally; next_link is never a destination for credentials. */
async function paged(read: Read, path: string, query: Record<string, string>, max: number): Promise<ObjectValue[]> {
 const rows: ObjectValue[] = [], ids = new Set<string>()
 let total: number | undefined
 for (let page = 0; page <= max; page++) {
  const offset = rows.length, response = object(await read(path, { ...query, limit: String(PAGE_SIZE), offset: String(offset) }))
  const items = list(response.items, PAGE_SIZE), count = response.total_items
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > max || total !== undefined && total !== count || response.offset !== offset || response.items_count !== items.length || typeof response.limit !== 'number' || !Number.isInteger(response.limit) || response.limit < 1 || response.limit > PAGE_SIZE || items.length > response.limit || offset + items.length > count) invalid('pagination is incomplete, changed, or exceeds its bound; nothing was enriched.')
  total = count
  for (const item of items) {
   const row = object(item), id = sourceId(row.id)
   if (ids.has(id)) invalid('pagination repeated a record; nothing was enriched.')
   ids.add(id); rows.push(row)
  }
  if (rows.length === total) return rows
  if (!items.length || response.next_item !== rows.length) invalid('pagination stopped before all records were read; nothing was enriched.')
 }
 invalid('pagination exceeded its bound; nothing was enriched.')
}

async function categories(read: Read, kind: keyof typeof kinds): Promise<Map<string, Category>> {
 const rows = await paged(read, '/categories.json', { item_type: kinds[kind] }, MAX_FIELDS)
 const result = new Map<string, Category>()
 // Keep request fan-out bounded even when the account has many categories.
 for (let start = 0; start < rows.length; start += 4) {
  const batch = await Promise.all(rows.slice(start, start + 4).map(async row => {
   const id = sourceId(row.id), name = label(row.name), facet = row.facet_type
   if (row.item_type !== kinds[kind] || facet !== 'single' && facet !== 'list') invalid('a category has an unsupported item type or selection method; nothing was enriched.')
   const choices = new Map<string, string>()
   for (const choice of await paged(read, `/categories/${id}/keywords.json`, {}, MAX_CHOICES)) {
    const choiceId = sourceId(choice.id), value = label(choice.name)
    if (sourceId(choice.category_id) !== id || [...choices.values()].includes(value)) invalid('category choices are ambiguous or belong to another category.')
    choices.set(choiceId, value)
   }
   const field: SourceDefinition = { id: `category:${kind}:${id}`, name, kind, type: 'text', entry: facet === 'single' ? 'pick-one' : 'pick-many', choices: [...choices.values()], values: [] }
   return { id, category: { field, choices, facet } }
  }))
  for (const item of batch) result.set(item.id, item.category)
 }
 return result
}

function assignments(recordId: string, rows: unknown[], fields: Map<string, Category>, kind: keyof typeof kinds) {
 const seen = new Set<string>()
 for (const raw of rows) {
  const row = object(raw), id = sourceId(row.id), category = fields.get(id)
  if (!category || seen.has(id)) invalid('a selected category is unknown or repeated; nothing was enriched.')
  seen.add(id)
  const { field, choices, facet } = category
  if (row.item_type !== kinds[kind] || row.name !== field.name || row.facet_type !== facet) invalid('a selected category differs from its definition.')
  let reason:string|undefined
  const values = list(kind === 'constituent' ? row.keywords : row.values, MAX_CHOICES).map(rawChoice => {
   const choice = object(rawChoice), choiceId = sourceId(choice.id), name = label(choice.name)
   if (sourceId(choice.category_id) !== id || choices.get(choiceId) !== name) reason='The source category selection differs from its documented choice. Review the original value.'
   return name
  })
  if (new Set(values).size !== values.length || facet === 'single' && values.length > 1) reason='The source category repeats selections or exceeds its cardinality. Review every original value.'
  if (values.length) field.values.push({ recordId, value: facet === 'single'&&values.length===1 ? values[0] : values,...(reason?{reason}:{}) })
 }
}

function attributes(records: Map<string, ObjectValue>, rows: ObjectValue[]): SourceDefinition[] {
 const definitions = new Map(rows.map(row => [sourceId(row.id), row]))
 const result = new Map<string, SourceDefinition>()
 for (const [recordId, record] of records) {
  const seen = new Set<string>()
  // LGL omits empty response fields; an absent array carries no assignments.
  for (const raw of record.custom_attrs === undefined ? [] : list(record.custom_attrs, MAX_FIELDS)) {
   const row = object(raw), id = sourceId(row.id), definition = definitions.get(id), classification = row.classification
   if (!definition || seen.has(id) || row.name !== definition.name || row.key !== definition.key) invalid('a custom attribute is unknown, repeated, or differs from its definition.')
   seen.add(id)
   if (classification !== 'text' && classification !== 'integer') invalid('the API returned an unsupported custom attribute classification; nothing was enriched.')
   const type = classification === 'text' ? 'text' : 'number', name = label(definition.name)
   let field = result.get(id)
   if (field && field.type !== type) invalid('a custom attribute classification changed between records.')
   if (!field) {
    field = { id: `attribute:constituent:${id}`, name, kind: 'constituent', type, entry: 'free-form', choices: [], values: [] }
    result.set(id, field)
   }
   if (row.value === null || row.value === undefined || row.value === '') continue
   if (typeof row.value !== 'string' || row.value.length > 2000) invalid('a custom attribute value is not a supported string.')
   // Preserve the API string; reviewed typed validation handles malformed numbers.
   field.values.push({ recordId, value: row.value })
  }
 }
 if (result.size !== definitions.size) invalid('the attributes endpoint omits data types, and some definitions have no classification on the imported constituents; nothing was enriched.')
 return [...result.values()]
}

/** externalId is the LGL record ID from the export, never an external-system ID. */
export async function readLglCustom(apiKey: string, records: SourceRecord[]): Promise<SourceDefinition[]> {
 if (typeof window !== 'undefined') invalid('custom data must be read on the server.')
 if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096 || /[\s\x00-\x1f\x7f]/.test(apiKey)) invalid('supply a private API key for this read.')
 if (!Array.isArray(records) || records.length > MAX_RECORDS) invalid('supply at most 1,000 imported LGL records.')
 const unique = new Map<string, SourceRecord>()
 for (const record of records) {
  if (!record || !Object.hasOwn(kinds, record.kind)) invalid('the documented API exposes custom definitions only for constituents and gifts; interactions and notes cannot be enriched.')
  if (typeof record.externalId !== 'string' || !/^[1-9]\d*$/.test(record.externalId) || !Number.isSafeInteger(Number(record.externalId))) invalid('use the exact positive LGL record ID from the export.')
  unique.set(`${record.kind}:${record.externalId}`, record)
 }
 const read = reader(apiKey), result: SourceDefinition[] = []
 for (const kind of Object.keys(kinds) as (keyof typeof kinds)[]) {
  const selected = [...unique.values()].filter(record => record.kind === kind)
  if (!selected.length) continue
  const [fields, attrs] = await Promise.all([categories(read, kind), kind === 'constituent' ? paged(read, '/attributes.json', { item_type: 'Constituent' }, MAX_FIELDS) : Promise.resolve([])])
  const details = new Map<string, ObjectValue>()
  for (let start = 0; start < selected.length; start += 4) {
   const batch = await Promise.all(selected.slice(start, start + 4).map(async record => {
    const id = record.externalId, row = object(await read(`/${kind === 'constituent' ? 'constituents' : 'gifts'}/${id}.json`))
    if (sourceId(row.id) !== id) invalid('the returned record does not match its imported LGL ID.')
    const values = kind === 'constituent' ? await paged(read, `/constituents/${id}/categories.json`, {}, MAX_FIELDS) : row.custom_fields === undefined ? [] : list(row.custom_fields, MAX_FIELDS)
    return { id, row, values }
   }))
   for (const item of batch) { details.set(item.id, item.row); assignments(item.id, item.values, fields, kind) }
  }
  result.push(...[...fields.values()].map(category => category.field))
  if (kind === 'constituent') result.push(...attributes(details, attrs))
 }
 return result
}

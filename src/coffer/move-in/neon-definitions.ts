import type { SourceDefinition, SourceRecord as ImportedRecord } from './source-definitions'
type SourceRecord=ImportedRecord&{sourceObject?:'action'|'activity'|'note'}

type ObjectValue = Record<string, unknown>
type Kind = SourceRecord['kind']
type Read = (path: string, query?: Record<string, string>) => Promise<unknown>
type Definition = { field: SourceDefinition; choices: Map<string, string>; dataType: string; accountType?: string }
const ORIGIN = 'https://api.neoncrm.com/v2'
const MAX_RECORDS = 1000, MAX_FIELDS = 100, MAX_CHOICES = 100, MAX_VALUES = 10_000
const MAX_BYTES = 2_000_000, MAX_TOTAL_BYTES = 20_000_000
const kinds = { note:{category:'Activity',path:'activities',values:'activityCustomFields'},constituent: { category: 'Account', path: 'accounts', values: 'accountCustomFields' }, gift: { category: 'Donation', path: 'donations', values: 'donationCustomFields' }, interaction: { category: 'Activity', path: 'activities', values: 'activityCustomFields' } } as const
const dataTypes: Record<string, SourceDefinition['type']> = { Text: 'text', Whole_Number: 'number', Integer: 'number', Decimal: 'number', Float: 'number', Currency: 'currency', Amount: 'currency', Date: 'date', Boolean: 'checkbox' }

class NeonReadError extends Error {}
function invalid(message: string): never { throw new NeonReadError(`Neon CRM: ${message}`) }
function object(value: unknown): ObjectValue {
 if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('an object response was expected.')
 return value as ObjectValue
}
function list(value: unknown, max: number): unknown[] {
 if (!Array.isArray(value) || value.length > max) invalid('a response list is invalid or exceeds its supported bound.')
 return value
}
function sourceId(value: unknown, max = 128): string {
 if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) invalid('an exact source identifier is missing or unsupported.')
 return value
}
function label(value: unknown): string {
 if (typeof value !== 'string' || !value.trim() || value.length > 2000) invalid('a definition name or choice is invalid.')
 return value
}

/** Fixed destinations only; never expose upstream bodies or transport error details. */
function reader(organizationId: string, apiKey: string): Read {
 const authorization = `Basic ${btoa(`${organizationId}:${apiKey}`)}`
 let requests = 0, totalBytes = 0
 return async (path, query = {}) => {
  if (++requests > MAX_RECORDS + 3) invalid('the request bound was reached; nothing was enriched.')
  const url = new URL(ORIGIN + path)
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000)
  let stream: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
   const response = await fetch(url, { method: 'GET', headers: { Authorization: authorization, 'NEON-API-VERSION': '2.12', Accept: 'application/json' }, redirect: 'manual', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal })
   if (!response.ok) invalid(`the read request failed (HTTP ${response.status}); nothing was enriched.`)
   if (!response.body) invalid('the API returned an empty body.')
   stream = response.body.getReader()
   const decoder = new TextDecoder('utf-8', { fatal: true })
   let bytes = 0, body = ''
   for (;;) {
    const chunk = await stream.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength; totalBytes += chunk.value.byteLength
    if (bytes > MAX_BYTES || totalBytes > MAX_TOTAL_BYTES) invalid('the response size bound was exceeded; nothing was enriched.')
    body += decoder.decode(chunk.value, { stream: true })
   }
   body += decoder.decode()
   try { return JSON.parse(body) as unknown } catch { invalid('the API returned invalid JSON.') }
  } catch (error) {
   if (error instanceof NeonReadError) throw error
   invalid('the read request could not complete; nothing was enriched.')
  } finally {
   clearTimeout(timer)
   try { await stream?.cancel() } catch { /* No upstream details leave this reader. */ }
  }
 }
}

/** Custom field lists are documented as unpaged arrays, including embedded options. */
async function definitions(read: Read, kind: Kind): Promise<Map<string, Definition>> {
 const category = kinds[kind].category, result = new Map<string, Definition>()
 for (const raw of list(await read('/customFields', { category }), MAX_FIELDS)) {
  const row = object(raw), id = sourceId(row.id, 20), display = row.displayType, dataType = row.dataType
  if (row.component !== category || row.status !== 'ACTIVE' && row.status !== 'INACTIVE' || result.has(id)) invalid('custom metadata is unrelated, duplicate, or lacks its documented status.')
  const pick = display === 'Checkbox' || display === 'Dropdown' || display === 'Radio'
  if (!pick && display !== 'OneLineText' && display !== 'MultiLineText') invalid('this custom display type is unsupported; file, password, and account reference fields cannot be enriched.')
  if (pick ? dataType !== undefined && dataType !== null && dataType !== 'Text' : typeof dataType !== 'string' || !Object.hasOwn(dataTypes, dataType)) invalid('a custom data type is missing or unsupported.')
  const field: SourceDefinition = { id: `neon:${kind}:${id}`, name: label(row.name), kind, type: pick ? 'text' : dataTypes[dataType as string], entry: pick ? display === 'Checkbox' ? 'pick-many' : 'pick-one' : 'free-form', choices: [], values: [] }
  const choices = new Map<string, string>()
  for (const rawChoice of row.optionValues === undefined || row.optionValues === null ? [] : list(row.optionValues, MAX_CHOICES)) {
   const choice = object(rawChoice), choiceId = sourceId(choice.id, 20), name = label(choice.name)
   if (!pick || choices.has(choiceId) || field.choices.includes(name)) invalid('custom choices are unexpected or ambiguous.')
   choices.set(choiceId, name); field.choices.push(name)
  }
  if (pick && !choices.size) invalid('a pick field has no documented choices.')
  let accountType: string | undefined
  if (row.accountSettings !== undefined && row.accountSettings !== null) {
   const settings = object(row.accountSettings)
   if (kind !== 'constituent' || !['Any', 'Individual', 'Company'].includes(String(settings.accountType))) invalid('custom account scope metadata is unsupported.')
   accountType = settings.accountType as string
  }
  result.set(id, { field, choices, dataType: pick ? 'Text' : dataType as string, accountType })
 }
 return result
}

function scalarReason(value: unknown, definition: Definition): string | undefined {
 if (typeof value !== 'string' || value.length > 2000) return 'The source value is not a supported string. Review the original value.'
 const type = definition.field.type
 if (type === 'number') {
  const number = Number(value), whole = ['Whole_Number', 'Integer'].includes(definition.dataType)
  const canonical = value.replace(/^(-?)0+(?=\d)/, '$1').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace(/^-0$/, '0')
  if (!/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(number) || !Number.isSafeInteger(Math.trunc(number)) || whole && !Number.isSafeInteger(number) || String(number) !== canonical) return 'The source number is invalid or cannot be represented without decimal changes. Review the original value.'
 }
 if (type === 'currency') {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) return 'The source amount cannot be represented as exact cents. Review the original value.'
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.')
  if (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')) > BigInt(Number.MAX_SAFE_INTEGER)) return 'The source amount cannot be represented as exact cents. Review the original value.'
 }
 if (type === 'checkbox' && value !== 'true' && value !== 'false') return 'The source Boolean is not true or false. Review the original value.'
 if (type === 'date') {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : undefined
  if (!parsed || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) return 'The source date is not an exact calendar date in YYYY-MM-DD form. Review the original value.'
 }
 return undefined
}

function assignments(recordId: string, rows: unknown[], fields: Map<string, Definition>, accountType?: string) {
 const seen = new Set<string>()
 for (const raw of rows) {
  const row = object(raw), id = sourceId(row.id, 20), definition = fields.get(id)
  if (!definition || seen.has(id)) invalid('a custom assignment has an unknown or repeated field identifier.')
  seen.add(id)
  const { field, choices } = definition
  let reason: string | undefined, value: unknown
  if (field.entry === 'free-form') {
   if (row.value === undefined || row.value === null || row.value === '') {
    if (row.optionValues === undefined || row.optionValues === null || Array.isArray(row.optionValues) && !row.optionValues.length) continue
   }
   value = row.value ?? row.optionValues
   reason = scalarReason(value, definition)
   if (row.optionValues !== undefined && row.optionValues !== null && (!Array.isArray(row.optionValues) || row.optionValues.length)) {
    value = row; reason = 'A free-form assignment includes unexpected selections. Review the original assignment.'
   }
  } else {
   const selected = row.optionValues
   if (selected === undefined || selected === null || Array.isArray(selected) && !selected.length) {
    if (row.value === undefined || row.value === null || row.value === '') continue
    value = row.value; reason = 'The source selection has no documented option identifiers. Review the original value.'
   } else if (!Array.isArray(selected)) {
    value = selected; reason = 'The source selections are not a list. Review the original value.'
   } else {
    if (selected.length > MAX_CHOICES) invalid('a selection list exceeds its supported bound.')
    const ids = new Set<string>(), names: string[] = []
    for (const item of selected) {
     const choice = item && typeof item === 'object' && !Array.isArray(item) ? item as ObjectValue : undefined
     const choiceId = choice?.id, name = typeof choiceId === 'string' ? choices.get(choiceId) : undefined
     if (!name || typeof choiceId !== 'string' || ids.has(choiceId) || choice?.name !== undefined && choice.name !== name) reason = 'The source selection is unknown, repeated, or differs from its definition. Review the original selections.'
     if (typeof choiceId === 'string') ids.add(choiceId)
     if (name) names.push(name)
    }
    if (field.entry === 'pick-one' && selected.length !== 1) reason = 'The source single-choice field contains multiple selections. Review the original selections.'
    value = reason ? selected : field.entry === 'pick-one' ? names[0] : names
    if (row.value !== undefined && row.value !== null && row.value !== '') {
     value = row; reason = 'The source supplies both scalar and option representations. Review the original assignment.'
    }
   }
  }
  if (row.name !== undefined && row.name !== field.name) reason = 'The source assignment name changed from its definition. Review the original value.'
  if (definition.accountType && definition.accountType !== 'Any' && definition.accountType !== accountType) reason = 'The assignment is outside its documented account scope. Review the original value.'
  field.values.push({ recordId, value, ...(reason ? { reason } : {}) })
 }
}

/** Enrich already imported records by exact Neon API IDs; never match names or labels. */
export async function readNeonCustom(organizationId: string, apiKey: string, records: SourceRecord[]): Promise<SourceDefinition[]> {
 if (typeof window !== 'undefined') invalid('custom data must be read on the server.')
 if (typeof organizationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(organizationId) || typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(apiKey)) invalid('supply a private organization ID and API key for this read.')
 if (!Array.isArray(records) || records.length > MAX_RECORDS) invalid('supply at most 1,000 imported source records.')
 const unique = new Map<string, SourceRecord>()
 for (const record of records) {
  if (!record || !Object.hasOwn(kinds, record.kind)||record.kind==='note'&&record.sourceObject!=='activity') invalid('only account, donation, and activity custom fields are documented; note enrichment is unsupported.')
  sourceId(record.externalId)
  unique.set(`${record.kind}:${record.externalId}`, record)
 }
 const read = reader(organizationId, apiKey), result: SourceDefinition[] = []
 let valueCount = 0
 for (const kind of Object.keys(kinds) as Kind[]) {
  const selected = [...unique.values()].filter(record => record.kind === kind)
  if (!selected.length) continue
  const fields = await definitions(read, kind)
  for (let start = 0; start < selected.length; start += 4) {
   const batch = await Promise.all(selected.slice(start, start + 4).map(async record => {
    let row = object(await read(`/${kinds[kind].path}/${encodeURIComponent(record.externalId)}`)), accountType: string | undefined
    if (kind === 'constituent') {
     const individual = row.individualAccount != null, company = row.companyAccount != null
     if (individual === company) invalid('the account response has an ambiguous or missing account wrapper.')
     accountType = individual ? 'Individual' : 'Company'; row = object(individual ? row.individualAccount : row.companyAccount)
    }
    if (sourceId(kind === 'constituent' ? row.accountId : row.id) !== record.externalId) invalid('the returned record does not match its imported source identifier.')
    const raw = row[kinds[kind].values], rows = raw === undefined || raw === null ? [] : list(raw, MAX_FIELDS)
    return { recordId: record.externalId, rows, accountType }
   }))
   for (const item of batch) {
    assignments(item.recordId, item.rows, fields, item.accountType)
    valueCount = result.reduce((sum, field) => sum + field.values.length, 0) + [...fields.values()].reduce((sum, definition) => sum + definition.field.values.length, 0)
    if (valueCount > MAX_VALUES) invalid('the custom value bound was exceeded; nothing was enriched.')
   }
  }
  result.push(...[...fields.values()].map(definition => definition.field))
 }
 return result
}

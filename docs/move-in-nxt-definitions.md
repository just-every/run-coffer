# Raiser's Edge NXT custom definitions

`./src/coffer/move-in/nxt-definitions.ts` exports
`readNxtCustom(token, subscriptionKey, records)`, returning the shared
`SourceDefinition[]` from `./src/coffer/move-in/source-definitions.ts`.
Call it only inside an authorized server handler. The access token and API
subscription key remain in the current request. The reader never stores,
returns, logs, or caches credentials. Requests use GET against the fixed origin
`https://api.sky.blackbaud.com`, with `Authorization: Bearer` and
`Bb-Api-Subscription-Key` headers. Redirects fail without being followed.
Upstream response bodies and transport errors never enter error messages.

The input contains records already imported from the incumbent CSV export:

```ts
type NxtRecord = {
 kind: 'constituent' | 'gift' | 'interaction' | 'note'
 externalId: string
 idType?: 'system' | 'lookup'
 sourceObject?: 'action' | 'note'
}
```

`idType` must be explicit. Missing provenance fails before any network read.
System IDs are exact positive decimal strings, retained without numeric
conversion; leading zeroes are refused. Lookup IDs preserve case, punctuation,
and leading zeroes. The reader neither trims nor numerically converts them.
Duplicate identical inputs are read once; conflicting provenance fails.

| Input | Exact resolution |
| --- | --- |
| Constituent with system ID | Read that constituent and require its returned `id` to match |
| Gift with system ID | Read that gift and require its returned `id` to match |
| Constituent with lookup ID | Complete the bounded constituent list including deceased and inactive records, then match `lookup_id` exactly |
| Gift with lookup ID | Complete the bounded gift list, then match `lookup_id` exactly |
| Interaction with system ID | Read the corresponding NXT action and require its returned `id` to match |
| Native note with `sourceObject: 'action'` and system ID | Read the corresponding NXT action; keep the destination definition kind as `note` |

The CSV labels Constituent ID and Gift ID do not establish system-ID
provenance. The caller must retain the actual exported column's meaning.
An explicit System Record ID column can establish system provenance. A lookup
ID is never used as an API path identifier. List scans finish even after finding
a match, because finding the first match does not prove uniqueness. Missing
matches, multiple exact matches, and multiple imported IDs resolving to one
API record fail the entire read. The supported collection bound is 10,000
records; larger accounts require a narrower documented strategy before this
reader can resolve lookup IDs.

The current CSV importer stores action exports as native notes. Action ID
provenance must survive that import as `sourceObject: 'action'`. An ordinary
Note ID, a generated file-row ID, or an older note with no source-object
provenance cannot establish an action identity. Such notes fail explicitly;
the caller can exclude them from the custom-field connection while keeping
them in the original CRM import. No documented custom-field endpoint for
ordinary NXT notes was found. Action lookup IDs are unsupported. Definitions
for actions imported at native note and native interaction levels have distinct
IDs, so their values cannot cross destination record levels.

Definitions come from the paged Custom Field API, with `record_type` set to
`Constituent`, `Gift`, or `Action` and `include_inactive=true`. The reader also
gets the corresponding constituent or action category details, or gift
categories, to obtain the documented `one_per_record` setting. It joins those
responses by exact category description and verifies the data types agree.
For table categories, the `code_table_id` must also agree. Missing, ambiguous,
or changed metadata fails instead of inventing cardinality or choices.

Table choices come from the Code Table API with `include_inactive=true`.
Each choice is the exact `long_description`, matching the documented string
representation of assignment type `CodeTableEntry`. Both inactive definitions
and inactive table entries are retained. Duplicate descriptions are ambiguous
and fail. No source choice is created from an observed assignment.

| NXT definition type | Returned type | Entry method |
| --- | --- | --- |
| Text | `text` | `free-form` |
| Number | `number` | `free-form` |
| Currency | `currency` | `free-form` |
| Date | `date` | `free-form` |
| Boolean | `checkbox` | `free-form` |
| Table | `text` | `pick-one` when `one_per_record` is true; otherwise `pick-many` |
| Constituent | `text` review container | Every reference waits for an explicit destination mapping |
| FuzzyDate | `date` review container | Every raw partial-date object waits for explicit review |

The last two types cannot be represented faithfully by the shared destination
type union. Their assignments always have a blocking `reason`; the type is a
review container, with no inferred constituent relationship or invented date
components. Unknown definition types fail. Unsupported or malformed assignment
values remain in `values` with their original JSON value and a blocking reason.
Values with `reason` must remain waiting until explicitly fixed, mapped, or
skipped by the user.

Assignments come from the individual record custom-field endpoints. Each
assignment's `parent_id` must match the resolved immutable system ID, and its
category must match a fetched definition exactly. The returned `recordId`
is always the original CSV `externalId`, including when it is a lookup ID.
Definition IDs use `nxt_`, the native destination kind, and the numeric custom
category ID, for example `nxt_note_7`. Definition names preserve source text.
Unused definitions are returned with an empty `values` array.

Single assignments preserve their raw JSON scalar. Multiple table assignments
become an ordered array of raw values. Duplicate selections are retained and
held for review. Repeated non-table assignments or repeated single-choice
assignments also retain every raw value as an array with a blocking reason.
An absent assignment value becomes explicit `null` with a reason. Numeric
strings are never promoted to numbers, table IDs are never substituted for
descriptions, and strings are never converted to Booleans. Decimal currency
remains in source units; destination normalization handles cents. Date strings
remain unchanged, including ISO date-time strings: destination date validation
can hold these for an explicit date-only correction. No value requests clearing
an existing destination value.

Bounds: 10,000 input records, 10,000 source records in each lookup scan,
100 definitions per native kind, 100 choices per definition, 10,000 total raw
assignments, 50 rows per paged request, 2 MB per response, 15 seconds per request,
and 12,000 requests per call. Paged count must remain constant; repeated IDs,
empty pages before the declared count, and contradictory pagination fail.
The reader reconstructs documented offset requests instead of following
`next_link`. The individual-record and category-detail endpoints document no
paging parameters, so their declared counts must equal their returned arrays.
Any bound or network failure rejects the entire call, with no partial capture,
retry, or alternate endpoint.

## Network-edge fixtures for integration

No fixture files were added by this scoped change. Root integration tests can
fake only `fetch`, using `synthetic-coffer-1` and `synthetic-coffer-2` as the two
credentials. All paths below are relative to the fixed official origin. Fixture
JSON must use the documented response envelopes, including counts.

- Definition requests use the path in
  [Get custom field categories](https://developer.sky.blackbaud.com/docs/services/customfield/operations/GetCustomFieldCategories),
  with `record_type`, `include_inactive=true`, `limit=50`, and `offset=0`.
  Respond with `{custom_field_categories: [{custom_field_category_id: 7,
  description: 'synthetic-coffer-3', type_of_data: 'Table', code_table_id: 43}],
  count: 1, limit: 50, offset: 0}`. Further pages echo the requested offset.
- Constituent category details use
  [List constituent custom field category details](https://developer.sky.blackbaud.com/docs/services/56b76470069a0509c8f1c5b3/operations/ListConstituentCustomFieldCategoryDetails).
  Action details use
  [List action custom field category details](https://developer.sky.blackbaud.com/docs/services/56b76470069a0509c8f1c5b3/operations/ListActionCustomFieldCategoryDetails).
  Gift categories use
  [List gift custom field categories](https://developer.sky.blackbaud.com/docs/services/58bdd5edd7dcde06046081d6/operations/ListGiftCustomFieldCategories).
  Respond with `{count: 1, value: [{name: 'synthetic-coffer-3',
  type: 'CodeTableEntry', code_table_id: '43', one_per_record: false}]}`.
- Table entries use
  [Get table entries list](https://developer.sky.blackbaud.com/docs/services/codetable/operations/GetTableEntriesList),
  with code table ID `43`, `include_inactive=true`, `limit=50`, and `offset=0`.
  Respond with `{count: 1, value: [{table_entries_id: '6', code_tables_id: '43',
  long_description: 'synthetic-coffer-4', is_active: false}]}`.
- Direct identity reads return `{id: '101'}`. Constituent lookup scans request
  `fields=id,lookup_id`, `include_inactive=true`, `include_deceased=true`,
  `limit=50`, and `offset=0`. Gift lookup scans use just limit and offset.
  Respond with `{count: 1, value: [{id: '101', lookup_id: 'synthetic-coffer-5'}]}`.
- An individual record custom-field read returns `{count: 1, value:
  [{id: '201', parent_id: '101', category: 'synthetic-coffer-3',
  type: 'CodeTableEntry', value: 'synthetic-coffer-4'}]}`. Its output contains
  `value: ['synthetic-coffer-4']` for this multi-choice definition and uses the
  original input external ID for `recordId`.

Meaningful negative cases are ambiguous or missing lookup IDs; missing source
provenance; ordinary notes; inactive choices; repeated selections; an unknown
assignment choice; type disagreement; a mismatched parent; incomplete or
repeating pages; redirect responses; and upstream errors containing sensitive
text. Only the reader's fixed error message should escape the last case.

## Provider provisioning boundary and sources

Blackbaud requires a developer account, API subscription, application setup,
customer environment connection and authorization, and an access token with
appropriate user permissions. This reader accepts an existing short-lived token
and subscription key; it neither provisions a provider application nor runs an
OAuth grant or token refresh. The Custom Field and Code Table APIs are public
preview services and provider access must be available in that subscription.
Network-edge fixtures prove the documented read interface. They do not prove a
customer environment is provisioned or authorized; a live account acceptance
check remains necessary before claiming that boundary is complete.

Official documentation checked on 29 October 2026:

- [Getting started](https://developer.blackbaud.com/skyapi/docs/getting-started)
- [Making API calls and authorization prerequisites](https://developer.blackbaud.com/skyapi/docs/getting-started/learn-api)
- [Constituent entities](https://developer.blackbaud.com/skyapi/renxt/constituent/entities)
- [Gift entities](https://developer.blackbaud.com/skyapi/renxt/gift/entities)
- [Custom Field API introduction and subsequent changes](https://developer.blackbaud.com/skyapi/support/changelog/renxt)
- [Official Constituent OpenAPI export](https://bbapiprod.developer.azure-api.net/developer/apis/56b76470069a0509c8f1c5b3?export=true&api-version=2022-04-01-preview)
- [Official Gift OpenAPI export](https://bbapiprod.developer.azure-api.net/developer/apis/58bdd5edd7dcde06046081d6?export=true&api-version=2022-04-01-preview)
- [Official Custom Field OpenAPI export](https://bbapiprod.developer.azure-api.net/developer/apis/customfield?export=true&api-version=2022-04-01-preview)
- [Official Code Table OpenAPI export](https://bbapiprod.developer.azure-api.net/developer/apis/codetable?export=true&api-version=2022-04-01-preview)

The official entity-reference application fetches these OpenAPI exports with
the Swagger-document JSON accept header. The exports establish the hosts,
authentication headers, endpoint parameters, enum values, response shapes,
pagination metadata, and the distinction between `id` and `lookup_id` used
above. No third-party schema or guessed endpoint is used.

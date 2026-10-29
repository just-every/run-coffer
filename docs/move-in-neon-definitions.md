# Neon CRM custom definitions

`./src/coffer/move-in/neon-definitions.ts` exports
`readNeonCustom(organizationId, apiKey, records)`, returning the shared
`SourceDefinition[]` declared in `./src/coffer/move-in/source-definitions.ts`.
Use an authorized server handler after the generic CSV import establishes
source records. This adapter only reads definitions and values; the existing
custom review must approve destination mappings and resolve waiting values.

Credentials live only in the current call. HTTP Basic authentication uses the
organization ID as username and API key as password, with
`NEON-API-VERSION: 2.12`. The adapter sends GET requests only to
`https://api.neoncrm.com/v2`. It never writes, logs, returns, or caches
credentials. Redirect handling is manual and every unsuccessful status,
including redirects, fails without following a location. Upstream response
bodies, headers, and transport error details never enter error messages.

| Input kind | Exact exported identifier | Definition category | Detail URL |
| --- | --- | --- | --- |
| `constituent` | Neon account ID | `Account` | `https://api.neoncrm.com/v2/accounts/{id}` |
| `gift` | Neon donation ID | `Donation` | `https://api.neoncrm.com/v2/donations/{id}` |
| `interaction` | Neon activity ID | `Activity` | `https://api.neoncrm.com/v2/activities/{id}` |

Record IDs remain exact strings of up to 128 ASCII letters, digits,
underscores, or hyphens. There is no numeric conversion, trimming, label
matching, donor-name matching, external-reference lookup, or inferred record
identity. Duplicate input pairs are read once. Returned IDs must equal their
requested IDs. Account responses must contain exactly one non-null
`individualAccount` or `companyAccount` wrapper, whose `accountId` must match.
Donation and activity responses expose `id` directly.

Definitions come from `https://api.neoncrm.com/v2/customFields` using the
documented `category` query parameter. The published schema describes plain
arrays, embedded `optionValues`, and no pagination inputs. The adapter does
not fabricate pagination, fetch individual definitions, or follow response
links. Both documented status values, `ACTIVE` and `INACTIVE`, are accepted.
There is no documented include-inactive switch; this adapter cannot establish
that a tenant returns metadata hidden by permissions or other provider rules.
An assignment absent from the fetched definitions fails the whole read.

Each definition needs its exact `id`, internal `name`, `component`, `status`,
and `displayType`. `component` must equal the requested category. Returned
identifiers use `neon:{kind}:{fieldId}` so different source areas cannot
collide. Public display labels and assignment names never identify fields.
Optional account scope metadata accepts `Any`, `Individual`, and `Company`;
an assignment outside that scope stays waiting with its original value.

| Display type | Returned entry method | Returned value type |
| --- | --- | --- |
| `OneLineText`, `MultiLineText` | `free-form` | From `dataType` below |
| `Dropdown`, `Radio` | `pick-one` | `text` |
| `Checkbox` | `pick-many` | `text` |

The provider's checkbox display means a list of selections. It does not mean
a Boolean field. Pick fields require distinct option IDs and names and either
an absent, null, or `Text` data type. They return the labels resolved from exact
option IDs. A supplied option name must also equal its definition name.

| Free-form data type | Returned type |
| --- | --- |
| `Text` | `text` |
| `Whole_Number`, `Integer`, `Decimal`, `Float` | `number` |
| `Currency`, `Amount` | `currency` |
| `Date` | `date` |
| `Boolean` | `checkbox` |

Free-form data types must be explicit. Time, email, phone, area code, name,
file, password, account references, unknown display types, unknown data types,
and typed pick lists fail explicitly. The adapter does not downgrade them to
text. The published enum contains no year type, so this adapter never returns
`year`. It supports account category metadata with documented account scope;
it does not infer additional categories from `Individual` or `Company`.

Record assignments use `accountCustomFields`, `donationCustomFields`, or
`activityCustomFields`, respectively. An absent or null array means no
assignments. Unknown or repeated field IDs reject the whole read because
definition identity cannot be established. Empty strings, null values, and
empty option lists represent unset assignments and never request clearing
destination data.

Free-form values preserve the source value exactly. Invalid numeric values,
nonintegral whole numbers, unsafe whole numbers, amounts beyond exact cents,
Boolean strings other than `true` or `false`, malformed calendar dates, and
non-string or overlong values carry a `reason`. Dates are accepted directly
only in exact `YYYY-MM-DD` form; other source formats remain original and wait
for review. Numeric strings and monetary strings are never converted here.
Destination validation still applies, including its own numeric constraints.

Valid single selections become a label string; valid multiple selections
become a label array. Invalid selections preserve their original option array
or scalar with a reason, including unknown IDs, mismatched names, duplicate
IDs, or excessive single-choice cardinality. If both scalar and option
representations are populated, the original assignment object remains waiting;
the published schema does not explain how to reconcile conflicting forms.
Unexpected selections on a free-form assignment also preserve the assignment
object for review. A changed assignment name receives a reason. Callers must
honor every reason even if destination normalization would accept the value.

The public v2.12 schema has no note endpoint, note custom-field category, or
note custom-field assignment schema. A native note input requires explicit Activity ID provenance; it then uses the Activity metadata and values at the native note level. Ordinary note inputs fail before network access. An activity's standard `note` property is not a separate note custom
definition and is not imported by this adapter. Pledges, payments, recurring
schedules, custom objects, trial instances, and other CRM areas are outside
this adapter. A generic CSV import remains the record import path.

Bounds are 1,000 supplied records, 100 fields per requested kind, 100 choices
per field, 10,000 returned assignments, four simultaneous detail reads, 1,003
requests, 2 MB per response, 20 MB across the call, and 15 seconds per request.
Field and choice identifiers are limited to the schema's 20 characters.
Exceeding a bound rejects the entire call, with no partial return, retries,
alternate origin, fallback endpoint, or saved credential.

## Fixture contract for integration checks

Use `synthetic-coffer-1` as organization ID and `synthetic-coffer-2` as API key.
Never use tenant credentials in fixtures or print the authorization header.
The following request set needs six responses; detail order within each batch
is not part of the contract. Every request uses the fixed origin, Basic
authentication, version header, GET method, and manual redirects.

```ts
const records = [
 { kind: 'constituent', externalId: '41' },
 { kind: 'gift', externalId: '42' },
 { kind: 'interaction', externalId: '43' },
]
```

| Fixture URL | JSON response |
| --- | --- |
| `https://api.neoncrm.com/v2/customFields?category=Account` | `[{"id":"11","name":"synthetic-coffer-3","component":"Account","status":"ACTIVE","displayType":"Checkbox","dataType":"Text","accountSettings":{"accountType":"Any"},"optionValues":[{"id":"21","name":"synthetic-coffer-4"},{"id":"22","name":"synthetic-coffer-5"}]}]` |
| `https://api.neoncrm.com/v2/accounts/41` | `{"individualAccount":{"accountId":"41","accountCustomFields":[{"id":"11","optionValues":[{"id":"21","name":"synthetic-coffer-4"}]}]}}` |
| `https://api.neoncrm.com/v2/customFields?category=Donation` | `[{"id":"11","name":"synthetic-coffer-6","component":"Donation","status":"INACTIVE","displayType":"OneLineText","dataType":"Decimal"}]` |
| `https://api.neoncrm.com/v2/donations/42` | `{"id":"42","donationCustomFields":[{"id":"11","value":"invalid-number"}]}` |
| `https://api.neoncrm.com/v2/customFields?category=Activity` | `[{"id":"11","name":"synthetic-coffer-7","component":"Activity","status":"ACTIVE","displayType":"OneLineText","dataType":"Date"}]` |
| `https://api.neoncrm.com/v2/activities/43` | `{"id":"43","activityCustomFields":[{"id":"11","value":"2026-02-30"}]}` |

Expected output has three distinct IDs: `neon:constituent:11`,
`neon:gift:11`, and `neon:interaction:11`. The first assignment has
`recordId: '41'`, value `['synthetic-coffer-4']`, and no reason. The second and
third retain their original strings with reasons. Changing the first selected
option ID to an unknown ID must retain the original option array with a
reason. Changing a returned record ID, duplicating a field ID, returning an
unknown assignment field, returning a file definition, or sending a note input
must reject. A redirect must reject without another request; a request failure
must not expose a provider body or exception text. Empty input makes no
network requests.

## Primary sources

Checked 29 October 2026. Schema verification used the official machine-readable
v2.12 document; no live tenant reads were performed.

- [Official API reference](https://developer.neoncrm.com/api-v2/)
- [Official v2.12 OpenAPI schema](https://developer.neoncrm.com/api-v2/docs/v2.12.yaml)
- [Official authentication guide](https://developer.neoncrm.com/authentication/)
- [Official custom field display semantics](https://support.neonone.com/hc/en-us/articles/4407399646733-Configuring-Custom-Fields)
- [Official activity overview](https://developer.neoncrm.com/activities/)

The OpenAPI security scheme is named `X-API-KEY` but declares HTTP Basic;
the authentication guide confirms organization ID and API key as its pair.
Its relevant schemas are `CustomFieldData`, `CustomFieldOption`,
`AccountCustomFieldData`, `CustomField`, `Account`, `IndividualAccount`,
`CompanyAccount`, `Donation`, and `Activity`.

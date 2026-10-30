# Bloomerang custom definitions

`./src/coffer/move-in/source-definitions.ts` exports `SourceDefinition`,
`SourceRecord`, and `readBloomerangCustom(apiKey, records)`. Call this adapter
only from an authorized server handler. The key stays in the current request:
the adapter never writes, logs, returns, or caches it. All requests are GETs to
the fixed origin `https://api.bloomerang.co/v2`, using `X-API-KEY`. Redirects
are refused. Upstream error bodies and transport error details are not exposed.

The input is an array of `{kind, externalId}` objects for records already
imported from CSV or XLSX. Identifiers must be positive decimal integer strings
without leading zeroes, within JavaScript's exact integer range. Duplicate
input objects are read once. The supported identifiers are:

| Kind | Meaning of externalId | Lookup |
| --- | --- | --- |
| `constituent` | CRM Account Number (`AccountNumber`) | Complete paged constituent list, exact account number match |
| `gift` | CRM reporting Transaction Number (`DesignationNumber`) | Paged designation list with the documented `designationNumbers` filter |
| `interaction` | API interaction `Id` | Paged interaction list with the documented `id` filter |
| `note` | API note `Id` | Paged note list with the documented `id` filter |

Account Number is **not** API constituent `Id`. Reporting Transaction Number
is **not** API transaction `Id` or API designation `Id`. The constituent API
does not document an exact account number filter, so the adapter completes a
bounded account scan even after finding a match. A missing match, duplicate
number, incomplete scan, changing page count, repeated record, or oversized
source fails the entire read. Note and interaction IDs must come from the
source export; this adapter does not infer records from text or dates.

Gift definitions belong to Bloomerang's `Transaction` custom field area, but
assignments belong to **designations**, not payment-level transaction objects.
Only `Donation`, `PledgePayment`, and `RecurringDonationPayment` designations
can enrich imported gifts. Pledges, recurring schedules, and Benevon fields
are unsupported. No records are created or matched by donor names.

Definitions use `GET /customFields/{type}/`; pick choices use
`GET /customValues/{type}/{fieldId}`. Both endpoints document plain arrays
without pagination parameters. The adapter reads active and inactive objects
separately so historical assignments remain resolvable. Record values use the
documented `CustomValues` assignments, whose `Value` or `Values` members contain
objects with string `Value` and, for picks, an `Id`. Choice IDs and text are
checked against the fetched definition. Unknown choices, mismatched choice IDs,
and repeated selections preserve the raw source value and include a `reason`:
the caller must hold that value for review rather than importing it.

| Bloomerang data type | Returned type |
| --- | --- |
| `Text` | `text` |
| `Decimal` | `number` |
| `Currency` | `currency` |
| `Date` | `date` |
| `Year` | `year` |

`Freeform`, `PickOne`, and `PickMultiple` become `free-form`, `pick-one`, and
`pick-many`. Bloomerang does not document a Boolean custom data type. Although
the shared return union includes `checkbox`, this adapter never invents one.
Unknown data types and entry methods fail rather than becoming text.

The returned shape is `{id, name, kind, type, entry, choices, values}`; values
contain `{recordId, value, reason?}` with the **input externalId**, a raw source string
for single values, or a string array for multiple selections. Choices preserve
the source's string representation. Dates and monetary values are not guessed,
and monetary values are not converted to Coffer cents here. The caller must
validate these through the destination custom-field normalization and reviewed
mapping before staging writes. An empty multiple selection produces no value;
this read never requests clearing an existing destination value. A value with
`reason` must remain waiting even if its text happens to match another choice.
Definition IDs identify fields within their source kind; callers must key
definitions by both `kind` and `id`, without assuming IDs are globally unique.
Absent
`CustomValues` is allowed by the source schema and means no assignments.

Bounds: 10,000 input records, 200 pages of 50 records per list, 100 definitions
per kind including inactive definitions, 100 choices per field including
inactive choices, 2 MB per response, 15 seconds per request, and 3,000 total
requests. Exceeding any bound rejects the whole call. No retry, partial-result
return, fallback endpoint, arbitrary URL, or persisted key is supported.

Documentation checked on 29 October 2026:

- [Official REST API introduction and Swagger UI](https://bloomerang.com/api/rest-api)
- [Official OpenAPI document loaded by that Swagger UI](https://bloomerang-api-documentation.s3.us-west-2.amazonaws.com/public_crm_generated.json)

The OpenAPI document defines the production origin, `ApiKeyAuth`, the endpoints
above, paging parameters and `PagedList` response metadata, `CustomField`,
`CustomValue`, `OneValueAssignment`, `MultipleValueAssignments`,
`CustomFieldDataType`, and `CustomFieldPickType`. Its `ConstituentBase` and
`Designation` descriptions explicitly distinguish source report numbers from
API IDs. The deprecated v1 endpoints are not used.

Schema adoption applies `migrations/core/0178_coffer_source_custom_index.sql` and then `migrations/core/0179_coffer_undone_custom_custody.sql`. Existing migration history stays unchanged. The source index retains erasure custody after an undone custom capture.

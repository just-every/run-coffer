# CSV exports

The owner or an admin reviews a download at `/app/exports`. Members and agents
receive 403. `GET /api/coffer/exports/{type}.csv?list=search` downloads the same
file. `GET /api/coffer/exports/preview?type={type}` returns its current counts,
organization time zone, as-of UTC timestamp and withheld-note statement.

`list` is `search`, `lybunt`, `sybunt` or `saved:{list-id}`. Search supports `q`,
`relationship`, `relatedTo`, `solicitation` and `volunteer` (`all` or `never-given`); annual
lists also accept a calendar `year`. Each CSV selects live, unpaged membership
in one database statement, then every chosen-type record of those constituents
across all dates. Annual membership uses signed calendar-year giving through
today in the organization's time zone, or the selected historical year-end.
SYBUNT includes LYBUNT. Current search includes matching inactive and deceased
records, as the current donor-search door does. Saved searches default to active
constituents under DONOR-012. Erased and merged-away identities never export;
records moved by a merge export under their survivor.

`list.save` accepts `name` and a `filters` object with those five search fields.
For a form it also accepts the five flat fields. Updating needs `listId` and
the current `version`; a stale version returns 409. `GET /api/coffer/lists`
lists these definitions. Definitions are backed up, never frozen member IDs;
membership is evaluated from the saved definition inside the export statement.
Current saved lists additionally support giving/date/fund/campaign, manager, consent, tags, custom fields, acknowledgment, status, engagement and lapse filters. They feed the current appeal, retention, task, welcome and export doors. Bulk tags, manager, custom values, status and restrictions have private audited history and guarded undo; the native export page provides these controls.

Every successful CSV is audited as `export.csv`: actor, source, record type,
safe selection metadata, count, as-of time and `N confidential staff notes
withheld`. Search text and row contents never enter that audit. Downloads are
not stored files and never create a DATA-003 donor request. The preview,
confirmation, response `X-Coffer-Withheld` header and audit state the count.
The generic download audit may additionally record the route.

The one-request bound is 10,000 rows and 4 MiB. The query counts all records and
their encoded size first in that same snapshot; an oversize response is 413
with its full row count, never a shortened CSV. The final CSV byte size is also
checked before audit/download. Preview counts may change before downloading:
the downloaded file and its audit use their own single snapshot.

## Format and fixed columns

UTF-8, RFC 4180 quoting, CRLF rows. Dates are organization-local `YYYY-MM-DD`;
recorded timestamps are UTC. All money columns contain exact **integer USD
cents**, written as plain decimal numbers without formatting or floating-point
dollar conversion. String cells beginning `=`, `+`, `-`, `@`, tab or carriage
return gain an apostrophe. Signed numeric cells do not gain one. `id` is the
record identifier; `donor_id` is the current hard-credit constituent.

Constituents:
`id, version, name, prefix, first_name, middle_name, last_name, suffix, nickname,
constituent_kind, organization_type, website, ein, email, phone, address_line1,
address_line2, city, region, postal_code, country, household_id,
informal_salutation, formal_salutation, envelope_name, constituent_status,
status_reason, deceased_on, status_changed_at, created_at, contact_points,
custom_fields, tags, solicitation_restrictions, computed_informal_salutation, computed_formal_salutation, computed_envelope_name`.
The first three salutation/envelope columns hold typed overrides; computed
columns use current installation defaults and those overrides.

Gifts:
`id, donor_id, kind, received_on, amount_cents, gross_cents, adjustment_cents,
refunded_cents, stated_value_cents, description, quantity, fund, campaign_id,
allocations, method, pledge_id, created_at, custom_fields`.
One row per original hard-credit monetary gift, with its current signed net in
`amount_cents`; a reversed gift has zero net. Refunds and reinstatements adjust
that net and do not create extra gift rows. `gross_cents` retains the imported
gross where present, `adjustment_cents` is net minus gross, and
`refunded_cents` carries the saved-import refund fact (later payment adjustments
are already in net/adjustment). A split remains one row; `allocations` is a JSON
array in original position order with `fund`, `campaign_id`, original
`amount_cents` and current signed `net_cents`. Unsplit gifts have `[]`.
Each current property gift is one `in_kind` row, zero money, with its current
description, quantity and donor-stated value separate. Soft credits never join
these totals. Property corrections are reflected in the current property row.

Pledges:
`id, donor_id, version, pledged_on, due_by, amount_cents, reduced_cents,
paid_cents, remaining_cents, fund, campaign_id, created_at`.
Original commitment, effective reductions, allocated net payments and current
remaining cents match the pledge API.

Plans:
`id, donor_id, campaign_id, amount_cents, status, cancel_at_period_end,
failed_attempts, recovered, updated_at`. No customer IDs, access tokens or
payment-method details.

Consent:
`id, donor_id, channel, status, method, evidence, captured_on, recorded_at,
recorded_by`. Only the newest recorded answer per constituent and channel.

Interactions:
`id, donor_id, kind, occurred_on, who, notes, next_step, open_question,
question_resolved_at, recorded_at, recorded_by, custom_fields`. Includes ordinary notes and
visits alongside calls, meetings and logged emails; confidential notes are
always withheld, even for an owner.

Tasks:
`id, donor_id, task_kind, title, owner_id, due_on, status, notes, created_at,
completed_at, related_record_id`. `task_kind` is `call`, `recurring`,
`cultivation`, `grant`, `receipt_address` or `reply`; all supported donor-owned
tasks export, including completed tasks. Donorless recurring tasks are outside
a constituent list. A grant task's created timestamp is its grant's timestamp;
completion uses the stored local completion date where that kind stores a date.

Opportunities:
`id, donor_id, version, label, stage, owner_id, ask_amount_cents,
expected_amount_cents, probability_percent, weighted_cents, expected_close_on,
next_step, fund, campaign_id, pledge_id, gift_id, closed_on, created_at,
updated_at`. Weighted cents round half a cent upward per opportunity as the API
does. Prospect research, provider estimates and proposal/document bytes stay out.

New fields added by DONOR-005/013/014/015 join the relevant documented column
set when those capabilities ship. Report-record exports are DATA-004 and do
not use this donor-lifetime selection.

The `solicitation` filter is `any`, `none`, `stop`, `channels` or `limit`; it evaluates active restrictions in the organization day, including merged originals. Constituent files add `solicitation_restrictions`, a JSON array of original donor id, type, dates, channels, maximum, period, source, source date and version. This array retains inactive/future restrictions with their dates. Owner/admin `list.solicitation` requires listId, version, type and reason, applies through the same live membership selection (1–500 records), and preserves per-record version/history/audit. General undoable bulk actions remain DONOR-007.

`custom_fields` is a JSON object for the record’s defined constituent, gift or interaction values; `tags` is the constituent’s JSON tag array. Definitions, types and entry methods are available to the owner/admin at `/api/coffer/custom-fields`. Currency values in this object are exact integer-cent decimal strings; text, numbers, dates, years and checkbox answers retain their stored scalar representation, and pick-many values retain an array. A cleared value may be null. Ordinary notes have an empty custom object until their custom-field capability ships; confidential notes remain withheld. These fields are read in the same consistent, unpaged statement and included in the existing row/byte limits and audit.


## Current report exports

The same private CSV and preview routes accept `report=funds`, `report=states`,
`report=attribution`, `report=custom-fields`, `report=honor-roll`,
`report=dashboard-money`, `report=retention`, and
`report=annual-lapses`. The fund screen also links each record type. Reports
that have no implemented selector return 400; they never fall back to an
unfiltered donor search. DATA-004 remains partial until every current report
has its selection and public-door proof.

Fund exports accept the report's inclusive `from` and `through` dates,
`donorId` and `fund`. State exports use its `year`, `basis`, `fund`, `campaignId`,
`formId`, `channel` and `solicitation`. Attribution uses inclusive `from` and
`to`; custom fields use `field`, `from` and `through`. Honor rolls use inclusive
`from` and `through`, selecting the original report's positive remaining gift
balances. Annual lapse exports require `list=lybunt` or `list=sybunt` and accept
`year`; additional donor-search filters are refused because that report does
not apply them.

For the monetary reports and custom-field reports, gifts are the report's own record type. Each
original gift appears once, with `amount_cents` equal to the sum of its selected
movements. An adjustment-only period can therefore show negative cents even
when that gift's lifetime balance is zero. Its `gross_cents` retains the original
amount; `adjustment_cents` is the selected amount minus that original gross.
Fund, state, attribution, dashboard and custom-field allocations carry the selected signed
fund movements; honor-roll allocations retain the current balances used by
that report. Property appears only when the source report includes it, with
zero monetary cents and its stated value separate. Monetary fund, state,
attribution, dashboard money and honor-roll reports exclude property, just as their totals do.
Constituents are the distinct live identities behind the selected records.
Every other record type uses those constituents' complete lifetime history.

Annual lapse cohorts own constituent rows. Every other type, including gifts,
is their donor-lifetime history, independent of the cohort year. Each filename
states the report, normalized selection parameters, scope and as-of timestamp;
lifetime files explicitly say `lifetime`. The audit retains the same parameters
and scope, full row count, as-of time and withheld-note statement. Erased and
merged-away identities remain excluded. For gift-based reports, preview and
audit expose `reportCents` and `reportExcludedCents`: retained anonymous financial
amounts remain in the report total without disclosing those identities in CSVs.
Exported gift cents plus those excluded cents reconcile to the monetary report.

The shared selection is unpaged. Each export reads membership, selected record
amounts, private record projections, complete counts and withheld-note counts
in one statement. The ordinary bounds and formula escaping still apply.
Preview and download are separate current snapshots. Fund totals and displayed
pages now derive from the same unpaged record set; choosing a fund scopes both.
Frozen artifacts keep their existing frozen download doors; this work does not
replace them with a live record export.


Dashboard money exports accept the resolved fiscal `year`, `period` (`current`
or `prior`), `dimension` and `key` used by its money drilldown. They use the
same unpaged ledger query as the dashboard. Cohort-specific money, goal,
commitment and recurring dashboard metrics remain unavailable, with a clear
400 response for an unsupported cohort selector. This does not mark the whole
dashboard acceptance complete.


Retention exports accept the native report's period and scopes plus `cohort`:
`all`, `retained`, `new`, `lapsed`, `recaptured`, `upgraded`, `downgraded`,
`unchanged`, or `adjustments`. Their own record type is constituents. Each
preview returns `reportTotals` with the selected count and exact prior and
current monetary cents from the same cohort snapshot; every other type is
labelled lifetime. Search text stays out of the audit. Separate recognition
and excluded-identity reconciliation metrics remain in the DATA-004 gap.

## Saved reports and report metrics

Open **Export report records** from the ordinary record export page to choose a
report, its period and metric, then review and download any of the eight record
types. Retention includes recognition and ledger reconciliation. Dashboard
selections include cohorts, recurring commitments and the current pipeline.
Recurring exports show the historical plan state, billing cadence and known
lifetime dates behind the chosen month, including distinct failed and recovered invoice counts. Tax selections are accountant working
papers; property stated values remain separate from monetary cents. Restricted
fund exports reconcile given amounts while the report metadata separately states
spending, releases and held balances.

The report builder saves columns, filters, grouping and numeric totals for
constituents, gifts, pledges, opportunities and interactions. Defined custom
fields are selectable for each record type. Gift periods select signed ledger movements;
fund grouping uses the actual allocations. The record download includes each
original gift once. CSV and Excel contain the same selected records; cents stay
numeric and spreadsheet text cannot become a formula. JSON definitions contain
field selectors rather than captured result rows and can be imported into another
installation whose matching custom fields have already been defined.

Owners and admins export, explicitly share with an active member, and approve
scheduled disclosures. Shared members read the current report without export or
editing rights. Definition edits clear member sharing and pause existing
schedules, requiring fresh disclosure review. Revoking sharing or the approving
account's authority stops later reads. Definitions retain no report snapshots.

# List CSV exports

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
General saved-filter fields, appeal/journey/report consumers and undoable bulk
actions remain DONOR-007 work.

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
status_reason, deceased_on, status_changed_at, created_at,
computed_informal_salutation, computed_formal_salutation, computed_envelope_name`.
The first three salutation/envelope columns hold typed overrides; computed
columns use current installation defaults and those overrides.

Gifts:
`id, donor_id, kind, received_on, amount_cents, gross_cents, adjustment_cents,
refunded_cents, stated_value_cents, description, quantity, fund, campaign_id,
allocations, method, pledge_id, created_at`.
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
question_resolved_at, recorded_at, recorded_by`. Includes ordinary notes and
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

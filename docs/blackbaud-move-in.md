# Move historical NXT records into Coffer

Open **Move in from your CRM → Read Raiser's Edge NXT history**. Supply a current
Blackbaud access token, the application's subscription key and a reviewed
`sky-review.json` file. Coffer uses the credentials for this read only; neither
credential nor source payment tokens enter the review, journal or archive.
Acquiring production OAuth authority is a separate prerequisite. This adapter
does not connect, refresh tokens, write to Blackbaud, stop source plans or start
replacement charges.

The read follows Blackbaud's published [Constituent API](https://developer.sky.blackbaud.com/api#api=56b76470069a0509c8f1c5b3),
[Gift API](https://developer.sky.blackbaud.com/api#api=58bdd5edd7dcde06046081d6) and
[Opportunity API](https://developer.sky.blackbaud.com/api#api=58e3b2597c1af25c58b9c4e3).
These are the read doors, relative to `https://api.sky.blackbaud.com`:

- `./constituent/v1/constituents`, including inactive and deceased people, and
  `./constituent/v1/constituents/{id}` for complete constituent details.
- Each constituent's `./nameformats/summary`, `./emailaddresses`, `./phones`,
  `./addresses`, `./communicationpreferences` and `./customfields` subresources.
- `./constituent/v1/relationships`, `./constituent/v1/actions` and
  `./constituent/v1/notes`, plus each action's `./customfields` subresource.
- `./gift/v1/gifts`, each gift detail and its `./customfields` subresource.
- `./opportunity/v1/opportunities`, including inactive opportunities so that an
  unsupported state is refused rather than silently omitted.

Collections use `count`, `value`, `limit`, `offset` and `next_link`. Coffer checks
stable counts, distinct identities, complete terminal pagination and the fixed
provider origin and object path. An incomplete read, denied request, unsupported
object, changing count or conflicting source fact refuses the entire preview;
no native constituent or financial record has been imported. The bounded read
allows 1,500 requests, 100 pages per collection, 10,000 records per collection,
2 MiB per response and 16 MiB overall. Larger or differently paginated sources
need a separately supported migration, not an accepted partial result.

## Review source mappings

The JSON file is a Coffer mapping and source-history supplement. It is **not** a
Blackbaud response format. Compare its facts with your actual source reports;
never infer a household head, acknowledgment or tribute from a name alone.
Use immutable SKY record IDs as keys. For example:

```json
{
  "currency": "USD",
  "funds": {"synthetic-coffer-fund": "Library"},
  "campaigns": {"synthetic-coffer-campaign": "Autumn books"},
  "appeals": {"synthetic-coffer-appeal": "Annual reading"},
  "stages": {"Proposal": {"stage": "ask", "probability": 80}},
  "owners": {
    "synthetic-coffer-fundraiser": {"id": "current-native-owner-id", "version": 1}
  },
  "contactTypes": {
    "email:Email": "personal",
    "email:Work": "work",
    "phone:Mobile": "mobile",
    "address:Home": "home"
  },
  "households": {},
  "gifts": {},
  "softCredits": {},
  "customFields": [],
  "definitions": [],
  "recurring": {}
}
```

Use your current native person's ID and version from `./auth/session` or the
installation's native people read. Map every source opportunity status to a
current **open** pipeline stage. Map its single source fundraiser to an active
native owner, admin or member; use `unassigned` explicitly for an opportunity
with no source fundraiser. Names are never identity matches. The source ask and
expected amounts remain opportunity amounts and never become received cash.
Review the displayed donor, source status, mapped stage, owner and amounts.
Changes to that owner or pipeline configuration invalidate the approval.

Map all source fund, campaign, appeal and contact-type IDs or labels actually
encountered. Contacts retain their source values and explicit primary flags.
All contacts in each bounded API collection are retained, with exactly one
explicit source primary per present kind. The spreadsheet numbered-column
limits do not truncate API contacts. Unsupported types, dated or inactive contacts require separate
review. Available native types are personal, work and other for email; mobile,
home and work for phone; home, work, vacation and other for undated addresses.

Use the existing **Code meanings** review for each solicit code, for example:

```text
Do not solicit = stop
Do not mail = no mail
Solicit once annually = limit 1
```

A mapped channel code records a withdrawn channel preference. A stop or limit
records the corresponding native solicitation rule. Completed mappings are
reused on the next NXT review. Empty or absent permission is never consent.
Source dates remain distinct from the import time; later native choices cannot
be overwritten by another source import. Ended or future-dated codes require
separate migration.

## Supplemental source facts

`households` is keyed by a stable source household ID. Each entry has `name`,
`members` (constituent IDs), optional explicit `headId`, `addressee`, `formal`
and `informal`. A source relationship's explicit head flags must agree with
these facts. No head is inferred for an unflagged or address-inferred household.
Source greetings stay unchanged as overrides where they differ from native
computation. The review counts households with and without explicit heads.

`gifts` is keyed by a source gift ID. Optional `acknowledgmentMethod` and
`acknowledgmentInteractionId` retain source evidence absent from SKY's gift
acknowledgment object; the latter must resolve to a supported source action on
the same constituent. SKY's acknowledgment date or letter establishes
acknowledged status, with do-not-acknowledge taking precedence. Missing history
remains not acknowledged. `goodsValue` supplies an attested benefits value when
no receipt amount exists. With a source receipt amount, goods equal the parent
gift amount minus that receipt amount; any supplied benefits value must agree.
Recorded zero means no goods, and an absent answer stays unknown.

An optional gift `tribute` has `kind` (`honor` or `memory`), `honoree`, optional
`sourceGroup`, `recipientName` and `recipientAddress`. These facts must come from
the source report. Publication permission is withheld; importing a tribute does
not approve a notification or disclose the amount to its recipient.

`softCredits` is keyed by each source soft-credit ID, independently of the hard
credit. Its optional `status`, `date`, `method`, `reference` and `interactionId`
carry that credit's source acknowledgment. No hard-credit thank-you is copied to
a credited person. Linked actions must belong to the credited constituent.

`customFields` uses the existing reviewed column mapping shape: `source`
(`re-nxt`), exact source `column` (SKY category), native `key`, `label`, `kind`,
`type`, `entry`, `choices` and current definition `version` (zero for new).
The supported kinds are constituent, gift, pledge, interaction and note. Every
encountered source value requires an explicit mapping and native validation;
unknown categories and unsupported structured values are refused. Repeated values
are combined only for a reviewed pick-many field. Source start and end dates,
record IDs and comments remain in each imported value's private provenance;
they never become native consent or an automatic expiry rule.

An optional `definitions` inventory attests the definitions exported from the
source database view. This is Coffer's supplement format, not a SKY response.
Each entry supplies a stable source `id`, `kind` (`constituent`, `gift` or
`action`), `category`, native-compatible `type`, `entry` and complete `choices`.
For example:

```json
{
  "id": "synthetic-coffer-definition",
  "kind": "action",
  "category": "Outcome",
  "type": "text",
  "entry": "pick-one",
  "choices": ["Thanked", "Follow-up"]
}
```

Every entry requires a matching `customFields` mapping with the same type,
entry method and complete code table. An action category used for both an
interaction and a note requires separate native keys and mappings. Empty
categories still create reviewed native definitions, without inventing values.
Definition changes after preview refuse apply before any native records move.
Undo removes only untouched definitions created by that import. Existing fields
remain. The inventory is explicitly supplied by the owner; this is no claim
that the SKY API returned complete vendor definition metadata. Unrepresented
vendor field types and code-table semantics remain under MOVE-010.

`recurring` is keyed by a `RecurringGift` source gift ID. Each entry retains
`frequency` (`weekly`, `biweekly`, `monthly`, `quarterly`, `semiannual` or
`annual`), `method` (`card`, `bank`, `cash`, `check` or `other`), required
`startsOn`, optional `endsOn` and source `nextOn`, plus optional opaque
`customerReference` and `paymentMethodReference`. Active source plans require
their original next date. Dates are never advanced or inferred. Missing
processor references remain explicitly missing evidence. Raw card or bank
numbers are refused. Review source amount, status, fund, campaign and appeal
separately from cash. These records survive restore and native merge, disappear
on constituent erasure, and authorize no payment, retry or source cancellation.

## Apply, reconcile and undo

Review first, then explicitly confirm apply. One source payment remains **one
gift**, with source-linked designation allocations whose cents add exactly to
its parent. This slice supports distinct funds with a common campaign and
appeal. Fund reports expand allocations; cash, receipts and donor lifetime
totals count the parent once. Unpaid unsplit pledges and open opportunities
remain promises, outside received-cash totals. Recurring plans retain source
schedules and opaque processor references as evidence; they are never gifts
and create no replacement subscriptions. Repeating a completed source
review never duplicates records.

The journal compares source parent counts and cents by year, donor and fund
with the native ledger. Undo removes untouched import-owned records together,
including allocations and opportunities. A later household, opportunity,
custom-value or other dependent edit refuses undo without removing anything.
Archives retain the imported history and mappings. Native merge and erasure
rules apply, and an erased constituent cannot be recreated by replay.

The following remain outside this slice: vendor definition types and code-table
semantics beyond the attested native-compatible inventory; unfinished or opportunity-linked actions; funded or closed opportunities;
multiple opportunity fundraisers; split promises; complete recurring-payment history and vault
transfer; other unsupported gift types and remaining source-object coverage;
production OAuth and live provider qualification. Unsupported objects returned
by a fetched door are refused. Objects from other, unfetched doors remain
unclaimed and must be inventoried before cutover. No source plan is cancelled
and no replacement schedule is activated.

# Move historical NXT records into Coffer

Open **Move in from your CRM → Read Raiser's Edge NXT history**. Supply a current
Blackbaud access token, the application's subscription key and a reviewed
`sky-review.json` file. Coffer uses the credentials for this read only; neither
credential nor raw SKY payment tokens enter the review, journal or archive.
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
- Complete constituent and action `./customfields/categories/details` catalogs,
  the gift `./customfields/categories` catalog and each code table's
  `./customfields/categories/values?category_name=...` collection.
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
  "customFields": []
}
```

Use your current native person's ID and version from `./auth/session` or the
installation's native people read. Map every source opportunity status to a
current pipeline stage with its existing open, won or lost outcome. Map its source fundraiser to an active
native owner, admin or member; use `unassigned` explicitly for an opportunity
with no source fundraiser. Names are never identity matches. The source ask and
expected amounts remain opportunity amounts and never become received cash.
The optional `opportunities` dictionary is keyed by source opportunity ID.
Supply an explicitly reviewed `nextStep` for each opportunity: the documented
SKY record supplies a purpose, not a native follow-up instruction. For a lost
proposal without a source funding date, supply its source-attested `closedOn`.
A supplied close date must agree with a returned funding date.

A won opportunity must link to one source gift or pledge for that constituent
and fund, with a source funded amount that reconciles exactly. A lost proposal
has no funding link. Historical closures are excluded from open forecasts and
create no additional gift or pledge. Duplicate funding claims, wrong native
outcomes and inconsistent source amounts refuse review. The native funding
guard also prevents reusing a pledge and one of its payments for two closures.
With several source fundraisers, the opportunity entry must explicitly select
one source `owner` identity. All source fundraiser IDs and their known credit
amounts remain historical evidence; missing credit amounts stay unknown.
Only the selected mapping assigns the native opportunity. Other source people
gain no native access or current authority. Review the displayed donor, source
status, mapped stage, owner and amounts.
Changes to that owner or pipeline configuration invalidate the approval.

Map all source fund, campaign, appeal and contact-type IDs or labels actually
encountered. Contacts retain their source values and explicit primary flags.
Every returned email, phone and undated address is retained, with its source
identity, mapped type, primary flag and active or inactive state. Every present
current kind has one explicit primary.
There is no three-email or two-address truncation. Contact reads explicitly
include inactive records. Inactive history remains visible in the preview and
the owner-only source-history read; it never becomes a current contact choice.
Past address start and end dates retain their effective-date provenance.
Ended and inactive addresses stay outside current selection. Annual seasonal
month and day bounds map to the native seasonal address type; overlapping
active seasons refuse preview. Future absolute address periods need separate
activation support and are refused rather than made current early. Available native types are personal, work and other for email; mobile,
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

## Review source actions

Unfinished actions need a current native owner. Their source fundraiser ID maps
through `owners`; use `unassigned` explicitly when the source has no fundraiser.
An `actions` entry, keyed by action ID, can select one source `owner` when
several are present. A call or meeting requires explicit `isAsk: true` or
`isAsk: false`; other actions require a reviewed `kind` of `follow_up`,
`thank_you` or `data_fix` and cannot be classified as asks. Open actions on an
inactive or deceased constituent, a withdrawn phone channel or a conflicting
solicitation restriction refuse the review. Current native restrictions are
checked again when the task is applied and used.

The source date becomes the task due date. A source opportunity link must
resolve to an open reviewed opportunity for the same constituent. The source
summary and description remain on its task and a labelled historical note;
custom values on that note use reviewed note-field mappings. Task creation
sends no mail or text and places no call. Later task edits prevent undo, and
ordinary native merge, erasure and archive custody include the imported task.
Completed opportunity-linked actions retain their native task and interaction
links as completed history. Other completed actions remain labelled source
notes unless explicitly reviewed as past asks. A reviewed historical ask needs
`isAsk: true`, its actual `completed_date` (or an attested `completedOn`) and a
known `channel` of `email`, `mail`, `phone` or `sms`. No completion date is
inferred from the scheduled action date. A missing non-ask completion date stays
explicitly unknown. Historical asks count against current solicitation limits
on their actual source day; they neither grant current consent nor send a new
message. Their source facts follow archive, merge and erasure custody, and undo
removes them only with their unchanged import-owned task. Later native asks
still prevent destructive undo.

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
Map every category in the three fetched catalogs, including categories with no
values. The native types must match: SKY Text, Number, Currency, Date and Boolean
map to text, number, currency, date and checkbox, respectively, with free-form
entry. A CodeTableEntry maps to text with pick-one or pick-many entry and the
complete source choice list. A source one-per-record category cannot become
pick-many. Action values map to interaction fields for calls, meetings and
emails, or note fields for other completed actions. If a category occurs on
both record kinds, supply both mappings with distinct native keys.

The review shows source category, declared type, entry method, source-value
count and complete choices separately from the native mapping. Supported
pick-many values retain their source selections. Boolean, numeric and currency
values must have their declared JSON type, not a text approximation. Dates must
be complete calendar dates. Every value is checked before native apply;
conflicting mappings, missing choices, unknown categories, duplicate values and
incomplete catalogs refuse the preview. Definitions with zero values are still
created and included in guarded undo. Pre-existing definitions survive undo;
later edits or use of an import-created definition prevent destructive removal.

ConstituentId and FuzzyDate categories, dated or annotated values and other
unsupported source types still require a separate migration. This adapter does
not establish full MOVE-010 parity for those categories or for other importers.

## Recurring schedule history

A supported `RecurringGift` records its amount, status, source designations,
frequency, start, optional end and next transaction date as evidence. The
returned `recurring_gift_schedule` supplies those facts for automated source
plans. For a manual source plan, the optional `plans` dictionary, keyed by the
source gift ID, must supply a source-attested `schedule` using exactly those
SKY field names. If both exist they must agree. Supported source frequencies
are weekly, every two weeks, every four weeks, monthly, quarterly and annually;
card and direct-debit methods are retained as methods, without the raw account
token. The status must be explicit. Incomplete dates, unsupported methods or
unmapped commitment custom values refuse the whole preview.

An attested plan entry may also supply opaque `customerReference` and
`paymentMethodReference` values from the processor transfer evidence. Missing
references remain missing. A stored reference establishes no provider usability,
account authority, debit permission or billing approval. Coffer never retains
the source response's payment token. Commitment acknowledgment, receipt and
tribute facts still need separate native mappings and are refused if present.

A `RecurringGiftPayment` needs exactly one read source recurring parent for the
same constituent. Payments become ordinary historical cash gifts once; their
source parent remains in their note and the plan's payment-ID history. The
schedule itself adds no cash and creates no active subscription. Undo, archive
restore, native merge and erasure preserve this separation. An actual vault
transfer, provider qualification and replacement schedule remain separate work.

## Apply, reconcile and undo

Review first, then explicitly confirm apply. One source payment remains **one
gift**, with source-linked designation allocations whose cents add exactly to
its parent. This slice supports distinct funds with a common campaign and
appeal. Fund reports expand allocations; cash, receipts and donor lifetime
totals count the parent once. Unpaid unsplit pledges and open opportunities
remain promises, outside received-cash totals. Historical closed proposals link
to their existing imported gift or pledge and never duplicate it. Repeating a completed source
review never duplicates records. The review identity includes all normalized
SKY records; changing a source gift while reusing the same mapping file requires
a new review, and conflicting previously imported facts block apply.

Partially paid, unsplit pledges reconcile their source balance against every
read `PledgePayment`. Each payment must link to its pledge and use that
constituent and fund. A source pledge and its payment cannot fund two separate
closed opportunities. Promise, paid and remaining cents remain separate from
received cash. Missing payment history refuses the whole preview. Commitment
acknowledgment and tribute facts still require separate mapping.

Refreshing owner mappings for a previously imported opportunity or task keeps
its native assignment and later edits. Changes to its source business facts
still require review rather than overwriting history. Existing native donor
profiles and contacts also remain authoritative on later source-ID matches.

The journal compares source parent counts and cents by year, donor and fund
with the native ledger. Undo removes untouched import-owned records together,
including allocations and opportunities. A later household, opportunity,
custom-value or other dependent edit refuses undo without removing anything.
Archives retain the imported history and mappings. Native merge and erasure
rules apply, and an erased constituent cannot be recreated by replay.

The following remain outside this slice: reference and partial-date custom definitions, dated or annotated values; later source action updates;
multiple funding links for one closure; split promises; future absolute
address periods; pledge acknowledgment and tribute facts; recurring commitment custom values and acknowledgment facts;
vault transfer and replacement schedules; other unsupported gift types and remaining source-object coverage;
production OAuth and live provider qualification. Unsupported objects returned
by a fetched door are refused. Objects from other, unfetched doors remain
unclaimed and must be inventoried before cutover. No source plan is cancelled
and no replacement schedule is activated.

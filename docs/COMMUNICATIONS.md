# Appeals, welcome series and replies

Open **Appeals** to prepare an audience by fund, giving date and amount. Email
messages accept `{{donor_name}}`, `{{total_given}}`, `{{gift_count}}` and
`{{last_gift}}`, plus `{{prefix}}`, `{{first_name}}`, `{{middle_name}}`, `{{last_name}}`, `{{suffix}}`, `{{nickname}}`, `{{informal_salutation}}`, `{{formal_salutation}}` and `{{envelope_name}}` (`DONOR-014`). Preparation freezes the message, recipient names and giving
figures in the approval hash. Approve that exact version, then send it through
the connected provider (see below). Repeated presses never send twice.

A saved submission is never sent twice automatically. A campaign accepted for
scheduling is **submitted**, not delivered. Refresh results to read the
provider's recipient disposition. A lost response stays **uncertain**; a
confirmed refusal is **rejected**. Inspect the campaign in the sender before
contacting the donor again. CSV export remains available for postal appeals.

## Connect the sender

The owner connects Mango or Mailchimp on **Appeals → Connect Mango or Mailchimp**
(`/app/appeals/connect`). The connection is stored in Coffer's D1 table
`cf_email_connection` and read at request time; backups leave it out. There are
no deploy settings for it. RER Managed has no integration egress relay yet:
provider actions say “Email marketing is not available yet on RER Managed.” and
make no provider request.

Mango uses its scoped integration API (`/api/integrations/v1`, Mango
`docs/integrations.md`) with a credential the Mango owner creates under
**Settings → Integration credentials** with `contacts:read`, `contacts:write`,
`events:read` and `campaigns:send`. **Connect Mango** checks every scope without
changing anything (`GET /segments`, `GET /events`, and an empty `PUT /contacts`
and campaign send that a granted scope answers with 400) and refuses a credential
that lacks one. A scoped credential cannot create or approve a campaign, so an
approved appeal's recipients are upserted with Coffer's consent evidence into a
Mango integration list named after the appeal (`segmentName`), one request per
donor, 40 per press. Coffer then shows the subject and message (with
`{{donor_name}}` rewritten as Mango's `{{displayName | fallback: "Friend"}}`) and
the list name; a Mango operator approves the campaign for that list and Mango
sends it and reports each send. Coffer withdrawals go to Mango's suppression API.
Mango contact fields carry those nine name values. The copy page flags name tokens for the operator to map with Mango’s field picker; Coffer does not claim provider rendering was verified. Mailchimp provisions private text fields CF_PREFIX, CF_FIRST, CF_MIDDLE, CF_LAST, CF_SUFFIX, CF_NICK, CF_INFORM, CF_FORMAL and CF_ENVELOP and never changes subscription state in a name update.

The welcome series lists each step's donors on `Coffer welcome · …` lists the same
way.

Mailchimp uses its Marketing API: the key's `-usN` suffix picks the API host, the
owner picks an audience from `GET /lists`, and each recipient gets a one-recipient
static segment and regular campaign, checked before its single send action. Its
fixtures are documentation-derived; no Mailchimp account or live send is claimed.
See `tests/fixtures/mailchimp/README.md`.

`COFFER_REPLY_ADDRESS` remains the address Cloudflare Email Routing delivers to
this Worker for replies.

The Worker includes Cloudflare’s [`global_fetch_strictly_public` flag](https://developers.cloudflare.com/workers/runtime-apis/fetch/) so self-hosted Workers can call a sibling Worker through its public HTTPS origin.

## Preferences and receipts

Before each marketing submission, Coffer checks both its latest email consent
and the sender's current subscription. A provider unsubscribe or suppression
adds a withdrawal to Coffer's append-only history. A Coffer email withdrawal is
recorded first, then sent to the provider; the connection card shows whether the
provider confirmed it or synchronization is still pending. **Sync email
preferences** performs the same operation by hand. The minute scheduler rotates
through eight donor records at a time; the pre-send check always reads the
specific recipient afresh. A failed check blocks that send.

Marketing withdrawals do not stop gift receipts or tax statements. Receipts use
the installation's transactional SendGrid connection, independently of Mango or
Mailchimp. Missing addresses and known receipt bounces/complaints still route
to print. The receipt test was updated to require both an opted-in donor and a
marketing-withdrawn donor to receive their receipt, with distinct provider IDs.

## Ask classification and restrictions

Every current outbound run records whether it is an ask. Email and mail appeals,
SMS appeals and the welcome second-ask step are asks. A newsletter explicitly
prepared as a newsletter, welcome thank-you/impact steps, gift receipts, annual
statements and reminders for the donor's own pledge are non-asks. Non-ask status
retains each door's separate consent and constituent-status checks. The current
call list excludes restricted ask candidates while allowing explicitly non-ask
stewardship calls. A gift-triggered thank-you task is also a non-ask.

Solicitation restrictions are versioned facts separate from consent: do not
solicit, no asks on selected channels, or an allowance per organization-local calendar month, quarter or year. Preparation
counts exclusions as “do not solicit” or “solicitation limit”; approval and
submission recheck frozen restriction versions and the current allowance. An
owner or admin can deliberately include a selected restricted donor in one run
with a reason. The run and donor timeline retain the reason and author; the
restriction and consent remain unchanged.

Default ADOPTED, pending ct: unique durable provider claims and mail exports
count across channels in the selected organization-local calendar period, once per
kind/run/original donor. Preparation does not count. Unknown outcomes count;
a definitive SMS 4xx rejection releases that count. After merge, original
restrictions and ask histories are evaluated as a union. Only the owner, admin
or assigned relationship manager can replace or clear an existing restriction,
including resolving inherited restrictions. These are conservative defaults,
not a claim that DONOR-015 is complete.

Current LGL, Bloomerang and configured NXT export imports retain sourced
restriction facts, channel withdrawals, preview mappings and reconciliation,
with repeat/undo safeguards. Restriction filters in saved lists/reports, bulk
set/clear and export columns remain unimplemented. Month, quarter and year
allowances now reset on their organization-local calendar boundaries; existing
and imported answers retain their annual meaning. The GIVE-006 recovery journey proves restricted-donor
failed-payment/card-expiry notices, and the DONOR-003 household journey includes
a restricted head and unchanged solicitation facts. Future provider,
journey, task, list/report/export/API and importer doors must inherit ask
classification, restriction checks, limits, audit and custody before shipping.
Topics and per-channel frequency preferences remain distinct unfinished work
under COMM-001; calendar solicitation limits do not implement them.

## Text messages

Staff record SMS permission with evidence, capture date, current phone and donor
time zone. SMS and phone answers join the shared append-only channel history;
SMS send eligibility also requires permission bound to that current phone.
Owner/admin prepare an appeal, thank-you or own-pledge reminder text, review its
frozen recipients and message, explicitly approve, then send. Preparation sends
nothing. A pledge reminder requires an unpaid installment. Appeals exclude
restricted donors; thank-yous and own-pledge reminders still require current
SMS consent and active status.

Self-hosted sending requires the Twilio account SID, auth token and sender
bindings named TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM. The operator
supplies an already registered sender. Coffer does not manage 10DLC registration.
Texts are held outside 8 a.m. to 9 p.m. in each donor's recorded time zone. A
later explicit send releases eligible held recipients; no automatic scheduling
or morning resumption is implemented. Changed consent, phone, donor or
restriction versions fence an already approved run.

A durable recipient claim prevents duplicate submission. Twilio acceptance is
labelled **submitted**, with its returned status separate; it does not prove
delivery. Lost or ambiguous responses remain **uncertain**, including a claim
interrupted before its outcome was saved, and are never automatically retried.
A definitive 4xx refusal reads failed. The signed Twilio form webhook verifies
the exact request URL and parameters, account and destination. STOP and its
supported equivalents append withdrawals to the SMS preference and shared
consent histories once per message, preventing subsequent texts. HELP and
ordinary reply logging/assignment are not implemented.

Backups preserve SMS runs and histories while leaving credentials out. Pending
or held runs must be discarded before merge; a submission in progress must be
reconciled. Merge never transfers SMS permission to the survivor: staff must
explicitly reconfirm the current phone and donor time zone. Clean undo restores
original history, while later staff decisions fence undo. Erasure removes
private phone, identity and message data, including runs that only excluded the
erased donor. These custody policies remain conservative defaults pending ct.

## Welcome journeys

Publish thank-you, impact and second-ask messages from Appeals. Only a first
gift recorded after publication and dated on or after launch enrolls; historical and merged donors do not
restart the series. The thank-you is due immediately; impact and ask are due at
the saved day offsets. The actual Worker minute scheduler runs due steps, and
**Run due welcome steps** uses the same path. A second gift stops the remaining
series even if later reversed. Missing consent, erasure and merge cancel pending
steps. A solicitation restriction skips the ask step while preserving eligible
thank-you/impact steps. Publication is refused while a journey is active so its messages cannot
change underneath it. Submission claims and unique message keys prevent repeats;
uncertain submissions require human investigation.

This implements the first-gift series with current constituent-status and
solicitation gates. Other journey triggers, branching, topic preferences and
cross-journey frequency caps remain outside this implementation. Reviewed
gift-triggered rules separately create ordinary thank-you calls and first-gift
tags or submit minimal private fund notices through Slack; they do not provide
those additional journey triggers. Mango also enforces its own sender and frequency
rules at approval and handoff.

## Replies

Configure a Cloudflare Email Routing rule for `COFFER_REPLY_ADDRESS`, and verify
the staff addresses Email Routing may forward to. These are installation
account settings, not something Coffer can grant itself. The Worker exports an
actual `email` handler. A reply must match the configured address, a current
known donor's sender address and an earlier submitted subject (with Re/Fwd
prefixes removed). It is logged as an email interaction and a reply task, and
forwarded to the donor's most recently updated active prospect owner. Without
one, the active installation owner receives it. Automatic replies are filed.

The task stores the assigned person, destination and confirmed/uncertain
forwarding outcome. Repeated Message-IDs cannot forward twice. A failed or lost
forwarding response stays visible for investigation; it is never silently
retried. The assignee or an administrator finishes follow-up with an outcome.
Erasure removes replies and merged message text; backups include the new domain
tables and exclude connection credentials.

Live Email Routing acceptance requires an installation address and verified
forward destinations. That account configuration is not supplied by the fleet
deploy token. The historical hosted check below did not prove live reply routing. Current
COMM-005 public-door tests cover explicit email stop withdrawals and staff
confirmation of ambiguous requests; neither email behavior supplies SMS HELP
or ordinary text reply tasks.

## Checks

`tests/communications.test.mjs` exercises both unsubscribe directions through
the Coffer Worker's authenticated HTTP API and real D1, with only Mango's
network edge replaced. `tests/fixtures/mango/audience.json` is a response from a
real local Mango containing only synthetic QA contacts, with mailbox addresses
replaced by reserved `example.test` addresses for publication. `tests/receipts.test.mjs`
proves receipt sending after an email marketing withdrawal. One-off scheduler
and Email Routing probes exercise the real handlers with network edges replaced;
they establish Coffer's side, not provider delivery or live routing.

## Hosted check, 17 October 2026

Temporary self-hosted Mango and Coffer Workers on the RunEditRun account sent
the Library appeal to the first fleet QA inbox and the first-gift welcome to
the second fleet QA inbox. Both inbox messages carried the expected full donor
name and giving amount; the appeal also carried gift count and last-gift date.
The inbox reader observed passing DMARC for both. Coffer displayed Mango’s
actual recipient disposition separately from inbox-confirmed delivery.

Clicking the real appeal’s Mango unsubscribe link and confirming it withdrew
the donor in Mango and Coffer. Withdrawing the second donor in Coffer was
confirmed as unsubscribed in Mango. The second gift cancelled the impact and
ask steps. A subsequently approved gift receipt still reached the first QA
inbox with the amount and IRS goods-or-services statement. Screens were used at
1440 and 390 pixels with no page overflow. Live reply routing remains unproven
because an inbound Email Routing rule and verified forward destination were
not supplied; no Mango source or homepage copy was changed.

Both temporary proof environments were removed after the check. The deploy
command read back that neither Worker nor any of their D1, R2 or queue resources
remained.

## Current public-door checks, 22 October 2026

`tests/coffer.test.mjs` — "DONOR-015: ask restrictions preserve transactional contact and deliberate audited exceptions"
runs solicitationJourney in `tests/solicitation-journey.mjs` through current
appeal, welcome, receipt, annual-statement, pledge, call and donor doors, with
native 1440/390 views. "DONOR-015: incumbent restrictions retain source meaning, previews, reconciliation and undo across current CRM doors"
runs solicitationImportJourney in `tests/solicitation-import-journey.mjs`.
"DONOR-015: SMS asks honor restrictions while approved thank-yous and pledge reminders retain consent, quiet hours and STOP"
runs smsJourney in `tests/sms-journey.mjs`: approved Twilio submission, night
hold and explicit morning release, signed STOP/replay, stale/uncertain holds,
merge union, permission reconfirmation, restore/undo/erasure and native text
screens. "STEW-005: reviewed rules act once on live gifts and never on historical imports"
runs giftRulesJourney in `tests/gift-rules-journey.mjs`, asserting reviewed
publication, 48-hour non-ask tasks, first-gift tags, historical suppression,
minimal Slack handoff and native rules at 1440/390. Only paid/network edges are
faked; these checks establish Coffer's side, with no live Twilio or Slack
acceptance or delivery claim.

## Postal address checks and mailing passes

On Addresses, an owner or administrator can enable connected address processing
with a current signed Processing Acknowledgement Form (PAF) reference and an
explicit reviewed authorization for current donors. The installation privately
supplies SMARTY_AUTH_ID, SMARTY_AUTH_TOKEN and MELISSA_SMARTMOVER_KEY; the page
never asks staff to enter provider keys. Provider credentials alone do not
authorize processing. Restoring a backup retains address history and check/pass
records but leaves processing disabled until an administrator authorizes it.

When enabled, manual US address entry and Verify current address use Smarty.
Mail preparation waits for a completed National Change of Address pass through
Melissa SmartMover. Preparing a pass queues work; the actual minute scheduler
processes one batch of up to 100 unique names and addresses per tick. The
licensed list must contain at least 100 genuine unique names and addresses.
Coffer never pads it or fabricates records to meet that minimum. Progress and
failed/uncertain reasons appear on Addresses. Failed or uncertain work is never
automatically retried; review the provider job before preparing another pass.

The pass verifies confirmed moves through Smarty before applying changes.
Earlier addresses retain the NCOA source and the observed change date; earlier
gifts remain attributed to their earlier state. A provider-reported move month
is retained separately. The history uses the organization-calendar day the
change was observed rather than inventing an exact day within that month.
Malformed, mismatched or missing provider results refuse the batch; a provider
failure never becomes an undeliverable flag.

An enabled mail appeal consumes one fresh completed pass and freezes each
recipient’s verified address fingerprint and check version in its reviewed
content. A changed check or address stops approval/export and requires a new
pass. A current matching known-undeliverable result is excluded with the reason
“undeliverable address” even if processing is subsequently disabled.

DONOR-009 remains partial. With processing disabled, the legacy mail CSV door
still permits unverified addresses without an NCOA pass. The full legacy
verification gate remains unproved. Default ADOPTED, pending ct: new provider
processing requires owner/admin authorization under a current signed PAF;
unknown move days stay unknown, history uses the observed organization day,
provider errors never imply undeliverability and existing matching known
undeliverables remain excluded. The privacy/consent activation boundary needs
ct’s ruling. These defaults do not narrow the target requirement to verify
addresses and process movers before each mail appeal.

`tests/coffer.test.mjs` — "DONOR-009: verified entry and licensed scheduled address passes preserve moves and exclude undeliverable mail"
runs addressVerificationJourney in `tests/state-report-journey.mjs`. It proves
standardized entry, the genuine 100-constituent scheduled pass, moved and
undeliverable results, mail exclusions/export, sourced history and earlier-gift
state attribution, malformed/outage refusal, replay/changed-check fences,
donor-file privacy, restore-disabled custody and erasure. Native address-pass,
mover/history, undeliverable and mail-review screens run at 1440/390. The Smarty
and Melissa network edges are faked; no live provider delivery or acceptance is
claimed. Root’s recorded run is 20261021T235854381977Z-heavy-slot-c1263138;
final candidate validation follows integration.

The authenticated giving portal includes a deliberately narrow donation-request
door. The donor may add an indefinite do-not-solicit choice on their own record,
never clear a staff/imported choice, resolve merged originals or grant channel
consent. Its versioned history records portal source, an opaque request reference
and a donor audit role. The same hashed unexpired session and current identity
are checked in the write transaction. An email shared by several current donors
is refused for this write. These conservative identity/consent defaults remain
pending ct; broader preferences stay with GIVE-005 and COMM-001.

The existing recurring/portal journey in `tests/giving.test.mjs` also proves
this source, forged-target/stale/clear refusals, unchanged consent, ongoing
card/cancellation access, shared-email denial and erasure. Native entry and
saved states run at 1440/390. The solicitationJourney additionally exercises
month and quarter resets across UTC and New York midnight, cross-channel
counting, competing approved exports, versioned period changes and native
period controls.

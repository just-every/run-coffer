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

## Personal mailboxes

Owners and admins open **Settings → Personal mailboxes** and configure their
Google or Microsoft application with the redirect address shown there. Google
needs Gmail read-only and send scopes; Microsoft needs delegated User.Read,
Mail.Read, Mail.Send and offline access. Connect the personal mailbox matching
the current Coffer sign-in address. Application secrets and refresh tokens are
encrypted and excluded from archives; a restored installation reconnects.

**Log recent messages** captures a page from the connected mailbox; **Log next
page** continues when the provider returns one. Only one uniquely matched
current constituent is eligible. Shared, unknown and multi-party identities
are refused. The donor timeline shows the subject, plain-text excerpt and
mailbox link. A received message joins the existing relationship-manager reply
routing and stop workflow. Explicit new stop requests withdraw immediately;
ambiguous wording still needs a proposal and confirmation. Automatic replies
are filed. Forwarding is attempted once and provider acceptance is separate
from delivery. A manager without the current private mailbox authority keeps
an assigned follow-up for an owner or admin to review.

On the donor page, **Personal email → Write a personal email** selects the
sender's own connection and classifies the message as an ask or a non-ask.
Review the saved exact message, then explicitly submit it. Current email
permission, active constituent status, topics, per-channel frequency and
DONOR-015 ask restrictions are checked again before submission. Personal
non-asks use the newsletter topic and never claim a transactional exemption.
A replay cannot send twice; a lost response stays uncertain for investigation.

With the installation's `COFFER_REPLY_DOMAIN` routed to this Worker's email
handler, Settings reveals an opaque BCC address for each current connection.
Mail from another client must use the connected sender as both its envelope
and authenticated From address. Cloudflare's trusted DMARC result must pass.
A single current constituent recipient, message identity and date are required.
BCC and mailbox capture share the same message identity and cannot log twice.
Disconnecting, changing the application or revoking native authority stops the
old BCC capability.

Mailbox excerpts and follow-up notes remain private to owners and admins and
are withheld from a donor-file export. Logged history remains in installation
archives and follows merge and undo. Erasure removes the text, and hash-only
capture and erased-address tombstones prevent historical mail returning.
The current owner and admin policy is adopted pending ct; broader staff access
still owes TEAM-001 record and confidential-data authority. The Gmail and Graph
network-edge journeys qualify Coffer's behavior, without claiming a live
mailbox or delivery qualification.

## Preferences and receipts

The donor record and authenticated donor portal offer newsletter, appeals and
events topics separately for email, postal mail, SMS and phone. Appeal frequency
can be unlimited, monthly or quarterly per channel. Limits use the organization's
calendar month or quarter and count durable submissions, exports and completed
ask calls, never preparation. Topics and frequency are checked again before the
existing submission claim. A newsletter keeps its own topic and does not consume
an appeal slot. Receipts, statements and existing pledge reminders remain
transactional. Donation-request restrictions under DONOR-015 still apply
independently to every ask.

Each confirmed change appends a versioned preference and a consent-history row
with its source, retaining the channel's current permission. Owner or admin
staff may record the donor's choices; the portal may change only its authenticated
donor. Neither door grants channel permission. Stale writes and foreign donor
targets are refused. Original merged identities keep their separate history;
their topics intersect and their strictest cap applies. Archives preserve the
history and erasure removes it.

Settings contains provider topic mappings. Mango segment IDs, Mailchimp interest
IDs and optional frequency fields can import stricter choices. Constant Contact
uses authenticated contact reads, including unsubscribed contacts, mapped lists
and an optional frequency custom field. Connection credentials are encrypted
and excluded from archives. Unavailable or malformed provider answers hold
sending. External updates only remove topics or tighten caps; they never restore
permission or weaken a recorded preference. The 27 October 2026 CT ruling approves these tightening-only imports, merged
originals and organization-local calendar windows. An explicit version-checked
native confirmation records a genuinely weaker donor choice; a provider opt-out
still holds that provider’s send. COMM-001 remains partial while its named
provider-envelope proof is outstanding.
Future event invitation and additional provider doors inherit these checks.

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

Ruled (ct 22 Oct): an ask counts when it is durably submitted, exported or completed as an ask call, never when it is prepared. Each kind/run/original donor counts once, and an unknown outcome counts until a definitive refusal releases it. Limits use a rolling 12 months, calendar or fiscal month, quarter or year. 'Once a year', from staff or from an import that names no period, means rolling 12 months. A one-run deliberate inclusion may be made by the owner, an admin or the donor's assigned relationship manager. It needs a reason and is audited, and it never grants channel consent or changes the restriction. After a merge, histories are unioned and SMS permission is reconfirmed. The authenticated donor portal may only strengthen a restriction: a full stop, no asks on chosen channels, or a limit of at most N asks in a period. It never loosens or clears one.

Rolling windows exclude asks on the 12-month anniversary and include today. Fiscal boundaries follow the saved fiscal start, clamping its day in shorter months; prior calendar-year answers migrate to the ruled rolling default, with immutable answers retained. The portal retains earlier starts and every merged original; replacing a channel restriction requires a superset, and tightening a limit requires the same period and no higher maximum. Current donor search, saved lists and by-state reporting filter active restrictions including merged originals. Owner/admin list.solicitation atomically sets or clears up to 500 current saved-list constituents with a reason and per-record history; constituent CSVs carry every original restriction.

Future doors in COMM-003/004/007, STEW-001/003, DEV-005, DONOR-007, REPORT-004, DATA-002, API-001 and MOVE-004 to MOVE-008 inherit the same ask classification, exclusions, audit, limit and custody obligations; wider TEAM-001 roles inherit the authority matrix before shipping. Topics and per-channel frequency preferences stay with COMM-001.

## Text messages

Staff record SMS permission with evidence, capture date, current phone and donor
time zone. SMS and phone answers join the shared append-only channel history;
SMS send eligibility also requires permission bound to that current phone.
The owner and admins prepare an appeal, thank-you or own-pledge reminder text, review its
frozen recipients and message, explicitly approve, then send. Preparation sends
nothing. A pledge reminder requires an unpaid installment. Appeals exclude
restricted donors; thank-yous and own-pledge reminders still require current
SMS consent and active status.

Self-hosted sending requires the Twilio account SID, auth token and sender
bindings named TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM. The operator
connects an existing Twilio account. Under Settings, SMS sender registration
checks the Messaging Service and existing A2P campaign against Twilio and shows
its status and exact sender membership. Campaign approval alone never approves a
number. Configure Twilio Event Streams for all six number registration and
deregistration events at the webhook shown in Settings. The owner or admin
explicitly reviews the CM number-event campaign reference alongside the separate
QE A2P reference; Coffer does not guess a mapping between these distinct IDs.
Only a signed event bound to the exact configured account, service, phone number
SID, current phone and reviewed event campaign confirms registration. Configure
this binding before number registration so a new event follows its review.
Pending, failed or deregistered number events block sending; older success or a
same-time success cannot reverse them. Changed configuration clears confirmation.
After a registered event, refresh registration explicitly before sending.
The adopted cross-reference binding awaits ct approval with the other SMS defaults.
Complete brand and campaign registration
in Twilio Console; Coffer never self-certifies it. Every outreach send rechecks
Twilio. Pending, mock, wrong-account, missing-sender or unavailable verification
blocks submission. Connection-bound registration evidence stays out of archives
and must be verified on the restored installation.

Texts are held outside 8 a.m. to 9 p.m. in each donor's recorded time zone. After
approval, an owner or admin can explicitly schedule a UTC time. The scheduled
job holds the 10 p.m. recipient until 8 a.m. and resumes without another human
send. It rechecks the current scheduling authority and the frozen consent,
phone, donor and restriction facts. Changes pause the schedule for review.
Cancellation or discarding the run stops it. An unscheduled quiet-hour hold
still waits for a person to send or schedule it.

A durable recipient claim prevents duplicate submission. Twilio acceptance is
labelled **submitted**, with its returned status separate; it does not prove
delivery. Lost or ambiguous responses remain **uncertain**, including a claim
interrupted before its outcome was saved, and are never automatically retried.
A definitive 4xx refusal reads failed. The signed Twilio form webhook verifies
the exact request URL and parameters, account and destination. STOP and its
supported equivalents append withdrawals to the SMS preference and shared
consent histories once per message, preventing subsequent texts. Signed HELP
gets one organization-labelled response inviting a support question and naming
STOP. Ordinary replies from a uniquely identified current phone become a donor
timeline note and an ordinary non-ask follow-up task. Existing relationship
routing selects the active portfolio manager, then the active opportunity owner,
then the installation owner. Replays do not duplicate records; unknown or shared
phones never guess a donor. Neither HELP nor a reply grants SMS consent. These SMS reply identity, routing,
HELP and explicit scheduling defaults are adopted pending ct approval;
COMM-006 remains partial until that ruling.

Backups preserve SMS runs and histories while leaving credentials out. Pending
or held runs must be discarded before merge; a submission in progress must be
reconciled. Merge never transfers SMS permission to the survivor: staff must
explicitly reconfirm the current phone and donor time zone. Clean undo restores
original history, while later staff decisions fence undo. Erasure removes
private phone, identity and message data, including runs that only excluded the
erased donor. Replies use the existing note and task custody. Merged SMS
permission is reconfirmed under the ct 22 October DONOR-015 ruling.

## Welcome journeys

Publish thank-you, impact and second-ask messages from Appeals. Only a first
gift recorded after publication and dated on or after launch enrolls; historical and merged donors do not
restart the series. The thank-you is due immediately; impact and ask are due at
the saved day offsets. The actual Worker minute scheduler runs due steps, and
**Run due welcome steps** uses the same path. A second gift stops the remaining
series even if later reversed. Missing consent, erasure and merge cancel pending
steps. Current topics and per-channel appeal caps are checked at the outbound
claim; a newsletter or transactional notice never consumes an appeal slot.
A solicitation restriction skips the ask step while preserving eligible
thank-you/impact steps. Publication is refused while a journey is active so its messages cannot
change underneath it. Submission claims and unique message keys prevent repeats;
uncertain submissions require human investigation.

## Other stewardship journeys

In Appeals, open **Build a three-stage journey**. Choose a strict gift threshold,
a twelve-calendar-month lapse, the live LYBUNT or SYBUNT list, a saved list,
new recurring giving, a giving anniversary or a recorded event check-in.
Registration alone is not attendance. A gift amount must exceed the threshold;
a gift equal to it does not enroll. First gifts keep their existing welcome editor.

Each stage can send marketing email through the connected Mango or Mailchimp,
create an ordinary owned call task, or wait. Mark each stage as an ask or not,
and choose whether a recorded human reply is required. A new gift ends an
active series instead of sending more stages. Each stage gets a permanent
response code; gifts without that code are never inferred to be responses.
Messages and stage settings stay fixed after publication. Review all three
stages and explicitly publish them. Each donor joins a published series once.
Another anniversary series requires another publication.

The minute scheduler and **Run due journeys** share durable claims. Before a
submission they check active status, current email consent, new gifts, current
list membership, topic preferences and solicitation restrictions. Missing merge
fields hold the stage, with every held recipient listed for correction.
An ask skip records its reason and allows later stages that are not asks.
Uncertain submissions are visible and never automatically retried; **Stop journey**
cancels remaining pending stages without resubmitting any message.

Settings contains **Journey email frequency**. The conservative adopted default
is one reserved email per donor per organization calendar day across the
welcome series and all other journeys. A confirmed setting can lengthen that
window. Held stages remain pending; handoffs and uncertain outcomes keep their
reservation. Tasks, waits and transactional notices are separate. Merge preserves
the cap across the original identities. This cap and recorded-reply branch
semantic await ct approval, so STEW-003 remains partial. No personal-style mail
stage or real provider-delivery proof is claimed.

Published journeys, enrollments, steps, response codes and cap reservations are
portable. Erasure removes constituent-linked work. A status undo restores the
record; resuming earlier pending work needs a separate audited confirmation.

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
hold and automatic morning resumption, registered-sender checks, HELP, exact
reply notes and assigned tasks, signed STOP and replay, stale and uncertain holds,
merge union, permission reconfirmation, restore, undo, erasure and native text
screens. "STEW-005: reviewed rules act once on live gifts and never on historical imports"
runs giftRulesJourney in `tests/gift-rules-journey.mjs`, asserting reviewed
publication, 48-hour non-ask tasks, first-gift tags, historical suppression,
minimal Slack handoff and native rules at 1440/390. Only paid/network edges are
faked; these checks establish Coffer's side, with no live Twilio or Slack
acceptance or delivery claim.

## Postal address checks and mailing passes

On Addresses, an owner or administrator can enable connected address processing
with the signed Processing Acknowledgement Form (PAF) signer, signing date, licensee and reference, and an
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

Every new mail appeal requires an enabled reviewed address connection and a
completed unconsumed NCOA pass no older than 95 days at first export. Receipts, acknowledgments and statements never wait for address processing. Preparation consumes the pass and freezes
each recipient’s verified address fingerprint and check version in its reviewed
content. A changed check or address stops approval/export and requires a new
pass. Older prepared or approved mail without address-check snapshots cannot be
approved or first exported; already exported historical downloads remain
available. Disconnected and restore-disabled installations cannot prepare new
postal mail. Current matching known-undeliverable results remain excluded.

Ruled (ct 22 Oct): an owner or admin authorizes processing by recording the PAF's signer, signing date and licensee. Coffer shows the renewal as due 12 months after signing, and a licensee's PAF refusal stops processing without changing any address. Every new mail appeal needs a completed pass that it alone consumes, finished no more than 95 days before export. Receipts, acknowledgments and statements never wait on address processing. A move starts on the organization day it was observed. The provider's move month is shown beside it, and the by-state report counts gifts dated between the start of that month and the observed day. Errors and uncertain results never mark an address undeliverable.

Legacy enabled connections are disabled by the upgrade until an owner/admin records these PAF fields. Renewals are due on the signing anniversary (February 29 clamps to February 28); a due label alone never claims that the licensee rejected the PAF. Melissa SE25–SE29 refusals stop processing without changing the batch’s addresses or checks. The completion bound is exactly 95 × 24 hours, inclusive, using UTC instants; future completion timestamps are refused. A previously exported historical download remains available. Distinct gift counts in move windows are appended to the state report and CSV, without changing monetary state attribution. Earlier observations lacking an explicit observed day use their audit timestamp in the organization time zone.

Disabled entry remains honestly unverified. Future every-entry and importer doors, including DONOR-013 and MOVE-001 to MOVE-006/MOVE-008 expansions, inherit verification, sourced old-address history and before-mail pass/check obligations before shipping.

`tests/coffer.test.mjs` — "DONOR-009: verified entry and licensed scheduled address passes preserve moves and exclude undeliverable mail"
runs addressVerificationJourney in `tests/state-report-journey.mjs`. It proves
standardized entry, the genuine 100-constituent scheduled pass, moved and
undeliverable results, mail exclusions/export, sourced history and earlier-gift
state attribution, malformed/outage refusal, replay/changed-check fences,
donor-file privacy, disconnected/restore-disabled mail refusals and erasure.
`tests/demo.test.mjs` — "the demo preserves frozen work, holds unverified postal mail and sends no invitation"
asserts that an older approved mail appeal cannot first export without verified
address snapshots. Native address-pass,
mover/history, undeliverable and mail-review screens run at 1440/390. The Smarty
and Melissa network edges are faked; no live provider delivery or acceptance is
claimed. Root’s recorded run is 20261021T235854381977Z-heavy-slot-c1263138;
final candidate validation follows integration.

The authenticated giving portal supports a full stop, no asks on chosen channels and an ask limit. It only strengthens existing choices, retains merged originals and channel consent, and rejects removing channels, raising limits or changing an existing limit's period. The hashed unexpired session, own current identity and unambiguous email are checked in the write transaction. Histories retain the donor audit role, source and opaque request reference.

The existing recurring/portal journey in `tests/giving.test.mjs` also proves
this source, forged-target/stale/clear refusals, unchanged consent, ongoing
card/cancellation access, shared-email denial and erasure. Native entry and
saved states run at 1440/390. The solicitationJourney additionally exercises
month and quarter resets across UTC and New York midnight, cross-channel
counting, competing approved exports, versioned period changes and native
period controls.

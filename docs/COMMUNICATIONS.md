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

## Welcome journeys

Publish thank-you, impact and second-ask messages from Appeals. Only a first
gift recorded after publication and dated on or after launch enrolls; historical and merged donors do not
restart the series. The thank-you is due immediately; impact and ask are due at
the saved day offsets. The actual Worker minute scheduler runs due steps, and
**Run due welcome steps** uses the same path. A second gift stops the remaining
series even if later reversed. Missing consent, erasure and merge cancel pending
steps. Publication is refused while a journey is active so its messages cannot
change underneath it. Submission claims and unique message keys prevent repeats;
uncertain submissions require human investigation.

This implements the first-gift series. Other triggers, branching, inactive and
deceased statuses, topic preferences and cross-journey frequency caps remain
outside this implementation. Mango also enforces its own sender and frequency
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
deploy token. The clause remains partial until configured; stop-request
recognition and proposed withdrawal are also not implemented.

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

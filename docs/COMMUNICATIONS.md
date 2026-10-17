# Appeals, welcome series and replies

Open **Appeals** to prepare an audience by fund, giving date and amount. Email
messages accept `{{donor_name}}`, `{{total_given}}`, `{{gift_count}}` and
`{{last_gift}}`. Preparation freezes the message, recipient names and giving
figures in the approval hash. Approve that exact version, then send up to eight
remaining recipients at a time. Each recipient gets a separate provider
campaign so both the merged content and the frozen audience stay exact.

A saved submission is never sent twice automatically. A campaign accepted for
scheduling is **submitted**, not delivered. Refresh results to read the
provider's recipient disposition. A lost response stays **uncertain**; a
confirmed refusal is **rejected**. Inspect the campaign in the sender before
contacting the donor again. CSV export remains available for postal appeals.

## Connect the sender

RER Managed has no integration egress relay yet. Provider actions say
“Email marketing is not available yet on RER Managed.” and make no provider
request. Self-hosted installs configure private environment values, then deploy:

| Setting | Purpose |
| --- | --- |
| `COMMUNICATIONS_PROVIDER` | `mango` (default), or `mailchimp` |
| `MANGO_ORIGIN` | Bare HTTPS Mango origin; HTTP is allowed only on loopback |
| `MANGO_SESSION_COOKIE` | Active native Mango operator session cookie; a secret |
| `MANGO_DEV_KEY` | Optional local Mango gate key; never used outside loopback |
| `COFFER_REPLY_ADDRESS` | Address routed by Cloudflare Email Routing to this Coffer Worker |
| `MAILCHIMP_API_KEY` | Mailchimp key, including its datacenter suffix |
| `MAILCHIMP_LIST_ID` | Mailchimp audience |
| `MAILCHIMP_FROM_NAME` | Mailchimp sender name |
| `MAILCHIMP_FROM_EMAIL` | Mailchimp sender address, equal to the reply address |

The Worker includes Cloudflare’s [`global_fetch_strictly_public` flag](https://developers.cloudflare.com/workers/runtime-apis/fetch/) so self-hosted Workers can call a sibling Worker through its public HTTPS origin.

Mango currently exposes native authenticated product routes, not a scoped
integration credential. Its operator sessions expire (normally after seven
days), and removing that operator revokes the connection. Renew the secret when
it expires. Coffer never signs in as a person automatically or bypasses Mango's
sender checks. The reply address must exactly match Mango's saved sender
identity. Mango's normal local runtime disables real mail; a hosted Mango with
verified provider, DNS and receiving-inbox evidence is needed to send.

Coffer uses Mango's existing contact search, consent capture, reviewed opt-out
CSV import, campaign creation/composition/approval and recipient report routes.
A new subscriber must complete Mango's confirmation flow. Coffer never invents
confirmation evidence or turns an existing opt-out back into a subscription.
Mailchimp uses its Marketing API with the same restriction, a one-recipient
static segment, and its managed unsubscribe/footer fields. Its fixtures are
explicitly documentation-derived; no Mailchimp account or live send is claimed.
See `tests/fixtures/mailchimp/README.md`.

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

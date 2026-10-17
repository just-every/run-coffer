# Coffer contract

Target edition: 17 October 2026. Coffer is the nonprofit fundraising CRM a US nonprofit buys instead of Bloomerang, Blackbaud Raiser's Edge NXT, Little Green Light or Neon CRM, and instead of collecting gifts through Givebutter or Zeffy: donor and household relationships, online and recurring giving, gift processing and receipts, appeals and stewardship journeys that are actually sent, major-gift moves management, and retention reporting reconciled with the books. It stays its own product; neighbouring products the market sells separately are connected, not rebuilt.

This is a target contract: the product Coffer is being built towards, not a description of today's release. Every named clause states the behaviour a buyer gets and the acceptance evidence that proves it through a public door. The [Status](#status) table marks how close the current code is. The nine released clauses keep their IDs and guarantees; where the wider scope changed them (sending, live payments, agent grants), the change is written into the clause. This round changes no homepage, interface or runtime behaviour.

## Product target

| | |
| --- | --- |
| Category | Nonprofit donor management / fundraising CRM |
| Incumbents a buyer switches from | Bloomerang, Blackbaud Raiser's Edge NXT, Little Green Light, Neon CRM, Givebutter, Zeffy |
| First buyer | A US 501(c)(3) development lead with 500 to 20,000 donor records and a fundraising team of one to ten, moving from Little Green Light or Bloomerang; amounts in USD, IRS receipt rules, the nonprofit's own Cloudflare and Stripe accounts |

Givebutter and Zeffy are the up-and-comers: they bundle collection with a donor CRM at no platform fee. Coffer has to beat them on giving and the incumbents on records, stewardship and reporting. Switching means a buyer of any of them finds the whole job:

- **Know every supporter.** People and organizations, households and relationships, a timeline of every touch, custom fields, duplicates merged, saved lists, documents, verified addresses and volunteer history (`DONOR-001` to `DONOR-011`).
- **Record every gift exactly.** An immutable ledger with batch entry, attribution, splits, pledges with installments, soft credits, matching, tribute, in-kind, stock, DAF and IRA gifts (`GIFT-001` to `GIFT-010`).
- **Take gifts online.** Forms, campaign pages, recurring giving, card, ACH, wallets, PayPal and Venmo, a donor portal, failed-payment recovery, fraud protection and text-to-give; campaigns, events, peer-to-peer pages and memberships (`GIVE-*`, `CAMP-*`).
- **Reconcile with the books.** Live Stripe and other platforms with payouts, fees, refunds and disputes, posted by fund to QuickBooks Online or Pantry and reconciled to the cent (`PAY-*`, `FIN-*`).
- **Thank and receipt.** Immediate email receipts, delivered acknowledgements, print-ready letters, year-end statements, US receipt rules and delivery tracking (`ACK-001`, `RCPT-*`).
- **Reach donors and hear back.** Consent on every channel, appeals sent through Mango or Mailchimp, one-to-one email, replies routed to the right person, SMS and direct mail, with results (`CONSENT-001`, `APPEAL-001`, `COMM-*`).
- **Follow up.** Tasks, recurring tasks, stewardship journeys, pledge reminders, gift-triggered rules and meetings (`STEW-*`), and the major-gift pipeline with portfolios, plans, scores, research, grants and planned giving (`MAJOR-*`).
- **Report.** Retention, LYBUNT and SYBUNT, dashboards, a report builder, scheduled reports, recurring health and Form 990 support (`REPORT-*`).
- **Move in and own it.** Importers from Little Green Light, Bloomerang, Raiser's Edge NXT, Neon CRM, Givebutter, Zeffy and any spreadsheet with a checked cutover; roles, SSO and an audit log; an API, webhooks and MCP; phone and native apps; and free, open-source ownership with exports and erasure (`MOVE-*`, `TEAM-*`, `API-*`, `MOBILE-*`, `DATA-*`, `OWN-*`).
- **Go further.** A development agent that reconciles every gift, rescues failed monthly gifts, sends missing receipts, drafts stewardship from the nonprofit's own history and shows who needs a human call next, under named grants (`DEV-001` to `DEV-012`).

### Neighbouring products stay separate

Where the market sells a neighbouring product separately, Coffer connects to it; when the neighbour is a Run Edit Run sibling, Coffer links to that sibling first and to the US incumbent second.

| Job | Owned by | How Coffer meets it |
| --- | --- | --- |
| Email marketing at volume | [Mango](https://github.com/just-every/run-mango) (or Mailchimp, Constant Contact) | Audience sync, approved campaign sends, results and unsubscribes back (`COMM-002`, `COMM-003`) |
| Accounting and the general ledger | [Pantry](https://github.com/just-every/run-pantry) (or QuickBooks Online) | Deposits per payout and batch with fund mapping, and reconciliation (`FIN-001`, `FIN-002`, `FIN-005`) |
| General forms and surveys | [Pencil](https://github.com/just-every/run-pencil) (or Typeform, Jotform) | Donor surveys link to constituents through the API; donation forms are Coffer's own (`GIVE-001`) |
| The nonprofit's website | [Pane](https://github.com/just-every/run-pane) (or Squarespace, WordPress) | Embeddable forms and campaign pages (`GIVE-001`, `GIVE-002`) |
| Sales pipeline for businesses | [Orbit](https://github.com/just-every/run-orbit) (or HubSpot, Salesforce) | Not rebuilt; Coffer's major-gift pipeline is fundraising-specific (`MAJOR-001`) |
| Meeting scheduling | [Dial](https://github.com/just-every/run-dial) (or Calendly) | Booking links from donor pages (`STEW-006`) |
| Workflow automation | [Crank](https://github.com/just-every/run-crank) (or Zapier) | Triggers and actions (`API-003`) |
| Team chat | [Nook](https://github.com/just-every/run-nook) (or Slack) | Task and gift notifications (`STEW-001`, `STEW-005`) |
| Signed pledge agreements | [Inkwell](https://github.com/just-every/run-inkwell) (or Docusign) | Signed documents attach to pledges (`DONOR-008`) |

### How to read this contract

Each clause is `AREA-NNN — Title.`, then the behaviour, its *Acceptance* (an HTTP route under `/api/coffer`, the browser at 1440 and 390 pixels, a donor-facing page, a provider webhook, a native app, or an import or export file) and its *Status*. `done` means the code implements the clause and a cited test exercises it; `partial` means part of it ships, with the cited file or test and the gap; `missing` means no code yet. Fakes are allowed only at a paid or network edge (Stripe, PayPal, QuickBooks Online, Pantry, Mango, Mailchimp, Twilio, mail delivery, Smarty, DonorSearch, a model); a provider fake proves Coffer's side only, never live provider behaviour, and local checks never prove hosted deployment. The release gate is [ACCEPTANCE.md](ACCEPTANCE.md).

## Released guarantees

The first release's clauses, kept and widened where the target changed them.

#### HTTP-001 — Private app boundary.

Hono serves `/health` and owns `/api`; native owner/operator sessions protect `/app` and `/api/coffer`. Every handler checks the actor's role, the exact host and, for cookie changes, the same `Origin`. Each write batch re-checks the session or key inside the same D1 transaction, so a revoked session, role change or revoked key stops a request in flight. Unknown paths return real 404s. Public donor-facing pages added by the target (`GIVE-001`, `GIVE-005`, `CAMP-002`) live outside `/app` under their own rules and never widen this boundary.

*Acceptance:* The role-boundary test signs in as owner, member and agent, sends cross-origin writes, revokes a key and deactivates a member, and every refused request returns 401 or 403.

*Status:* done. Evidence: `tests/coffer.test.mjs`, `src/coffer/auth.ts`.

#### DONOR-001 — Donors and households.

A donor has one unique email (or none). A household is found by name or created. Members, admins and the owner add and edit donors; edits are versioned, and a stale version is refused rather than overwritten.

*Acceptance:* A member adds donors through HTTP and the browser journey adds, edits and opens donors; the donor page lists household members.

*Status:* done. Evidence: `src/coffer/donors.ts`, `tests/coffer.test.mjs`, `tests/browser-journey.mjs`.

#### GIFT-001 — Immutable ledger.

A gift is an integer-cent line with its date, method, fund, optional pledge and goods-or-services answer. Database triggers refuse changes to amounts, dates, donors or references; a correction is a reversal line of the opposite amount, once per gift. Dollar input is parsed exactly; the API takes `<field>Cents` for exact integers. Every later gift kind in this contract (online, recurring, split, soft-credited, in-kind, refunded) is written as lines in this one ledger.

*Acceptance:* The ledger test records exact-cent gifts, refuses sub-cent, future-dated and duplicate-reference gifts, reverses one once and reads the lifetime and per-year totals back.

*Status:* done. Evidence: `src/coffer/gifts.ts`, `migrations/core/0016_coffer.sql`, `tests/coffer.test.mjs`.

#### CONSENT-001 — Consent history.

Consent is append-only per donor and channel with method, evidence, capture date and who recorded it; the newest row is the current answer. Rows are removed only by erasure. The target adds SMS and phone channels, donor self-service changes and sender-synced unsubscribes as further rows of this same history (`COMM-001`).

*Acceptance:* The appeal test records grants and withdrawals for several donors and channels and the donor history shows the newest answer per channel.

*Status:* done. Evidence: `src/coffer/donors.ts`, `tests/coffer.test.mjs`.

#### ACK-001 — Acknowledgement letters.

Gifts at or over the threshold (default $250) without a live letter are due within the target days (default 14). No letter is prepared until a person has saved the settings; the letter must state donor name, amount, gift date, organization and the goods-or-services statement. A batch freezes its letters and content hash. A person approves the exact hash; export, then a recorded sent date. Imported gifts with an unknown goods answer wait for a person's answer. This is the reviewed letter path for printed and hand-mailed acknowledgements; delivering the same approved letters by email is `RCPT-002` and print layouts are `RCPT-003`.

*Acceptance:* The acknowledgement test has an agent prepare a batch, refuses preparation before settings are reviewed, lets only a person approve, exports the CSV with the exact letter text and records the sent date.

*Status:* done. Evidence: `src/coffer/acknowledgements.ts`, `src/coffer/settings.ts`, `tests/coffer.test.mjs`.

#### APPEAL-001 — Consent-checked appeals.

An audience includes only donors whose newest consent for the channel is yes and who have the needed address; exclusions are counted by reason. Each recipient is frozen with the exact consent row; approval, export and sending refuse if any of those rows is no longer current. Sending the approved audience through Mango or Mailchimp is `COMM-002`; this clause is the consent gate every send passes.

*Acceptance:* The appeal test prepares an audience, counts exclusions by reason, refuses approval after a withdrawal and exports only consenting recipients.

*Status:* done. Evidence: `src/coffer/appeals.ts`, `tests/coffer.test.mjs`.

#### AGENT-001 — Prepare, then a person decides.

An expiring, revocable bearer key reads records and runs only `ack.prepare` and `appeal.prepare`. Approvals keep the preparer's and approver's identity and role with the content hash. Wider, separately granted agent work is `DEV-012`; no agent key gains an action this clause does not name unless that grant says so.

*Acceptance:* The role-boundary and acknowledgement tests create a key, prepare with it, are refused every other command, record agent and owner roles on the approval and stop working on revocation.

*Status:* done. Evidence: `src/coffer/commands.ts`, `src/coffer/auth.ts`, `tests/coffer.test.mjs`.

#### IMPORT-001 — Reviewed Stripe move-in.

Saved Stripe customer and charge list pages go through Base's import kit. Preview writes nothing; apply needs the exact reviewed fingerprint; the journal retains the original pages; undo stops at anything a person has since built on. Failed, refunded, non-USD, duplicate and already-imported objects are skipped with reasons and never enter the plan. This saved-page path stays for history a live connection (`PAY-001`) is not granted, and for nonprofits that never give Coffer API access.

*Acceptance:* The move-in test previews 15 gifts with every skip reason, refuses a wrong fingerprint, applies, reads the journal and undoes; a second test proves undo stops at a donor a person has since changed.

*Status:* done. Evidence: `src/coffer/imports/service.ts`, `src/coffer/imports/snapshots.ts`, `tests/coffer.test.mjs`.

#### DATA-001 — Custody and erasure.

Base portability backs up product records, approvals and import custody, excluding identity and credentials, and restores only into an empty installation. The owner erases a donor with explicit `ERASE`: personal data, consent, letter text, gift notes and affected Stripe originals go; gifts move to an anonymous placeholder; hashed suppression stops re-import; a later journal fences older archives. Every record the target adds (interactions, tasks, opportunities, receipts, provider events) joins the same backup and the same erasure.

*Acceptance:* The backup test restores into a fresh installation and compares donor histories and approvals; the erasure tests remove personal data, keep anonymous gifts, refuse re-import and fence an older archive.

*Status:* done. Evidence: `src/coffer/archive-policy.mjs`, `src/coffer/imports/erasure.ts`, `tests/coffer.test.mjs`.

## Target clauses

These clauses complete the category job alongside the released guarantees.

### Supporter records

The constituent record a Little Green Light or Bloomerang user expects on day one: people, organizations, the ties between them and every touch.

#### DONOR-002 — Organization records.

A constituent is a person or an organization (business, foundation, church, school, government body, donor-advised fund sponsor). An organization has its own address, website, EIN and giving history, and named contacts who are person records linked to it with a role. Gifts from an organization credit the organization; its contacts see the gift on their timeline as related.

*Acceptance:* An HTTP and browser journey creates a foundation with two contacts, records a $10,000 grant payment from it, and reads the gift on the foundation, not the contacts, with both contacts listing it as related.

*Status:* partial. Every constituent is a person-shaped donor record; there is no organization type, EIN, website or contact role. Evidence: `src/coffer/donors.ts`.

#### DONOR-003 — Relationships.

Any two constituents can be related with a reciprocal type (spouse/spouse, parent/child, employee/employer, board member/organization, friend, advisor/client) that shows from both sides. Households keep a head of household, a formal and informal salutation and an addressee for letters, and household giving totals combine members without double-counting a gift shared by two of them.

*Acceptance:* An HTTP journey relates a donor to an employer and a spouse, reads the reciprocal relationship from both records, and checks that the household total counts a joint gift once.

*Status:* partial. Only household membership by name exists; no reciprocal relationship types, salutations or household totals. Evidence: `src/coffer/donors.ts`.

#### DONOR-004 — Interaction timeline.

Each constituent has one timeline of everything that happened: gifts, pledges, receipts sent and delivered, appeal sends, opens and replies, logged calls, meetings, visits, notes, tasks, event attendance and volunteer hours, newest first and filterable. A person logs a call, meeting or note in under ten seconds from the donor page or a phone. Notes marked confidential are visible only to the roles `TEAM-001` allows.

*Acceptance:* A browser journey at 1440 and 390 pixels logs a call and a confidential note on a donor, sees both on the timeline with the gift and receipt events, and a data-entry user is refused the confidential note through HTTP.

*Status:* partial. The donor page shows gifts, consent, letters, appeals and the change history; there are no logged calls, meetings, notes or a filterable timeline. Evidence: `src/coffer/donors.ts`, `src/coffer/ui/donors.ts`.

#### DONOR-005 — Custom fields and tags.

An admin adds custom fields (text, number, date, single and multi choice, checkbox) to constituents, gifts and opportunities, and defines tags and categories (board member, volunteer, alumni, legacy society). Fields and tags are searchable, segmentable, importable and exportable, and appear in reports.

*Acceptance:* An HTTP journey defines a choice field and two tags, sets them on donors, finds the donors by field and tag in search and an appeal segment, and sees them in a CSV export.

*Status:* missing. No custom fields, tags or categories.

#### DONOR-006 — Duplicate detection and merge.

Coffer flags likely duplicates (same email, same name and postal address, same phone, near-name matches) when a record is added, imported or comes in from a form, and in a review queue. A person compares two records side by side, picks the surviving value per field and merges: gifts, pledges, consent rows, interactions, relationships and provider links move to the survivor, the ledger is untouched and the merge is undoable from the audit log.

*Acceptance:* An HTTP and browser journey creates two records for one person through a form gift and a manual entry, finds them in the duplicates queue, merges them, reads one combined history with unchanged ledger totals, then undoes the merge.

*Status:* partial. Duplicate emails are refused and same-email Stripe imports attach to the existing donor; there is no duplicate queue, comparison or merge. Evidence: `src/coffer/imports/snapshots.ts`, `tests/coffer.test.mjs`.

#### DONOR-007 — Saved searches and lists.

A person filters constituents on any field, tag, giving range, date of last gift, fund, campaign, relationship manager, consent, engagement score and lapsed status, and saves the filter as a named list that stays current. Lists drive appeals, journeys, reports, tasks and exports.

*Acceptance:* An HTTP journey saves a list of donors who gave $500 or more last year with email consent, adds a qualifying gift, and sees the list grow without editing it; the list feeds an appeal audience.

*Status:* partial. Search covers name, email and household, and appeal segments filter on giving since a date; there are no general filters or saved lists. Evidence: `src/coffer/donors.ts`, `src/coffer/appeals.ts`.

#### DONOR-008 — Documents on records.

A person attaches files (signed pledge agreements, grant letters, estate documents, photos) to a constituent, gift, pledge or opportunity. Files are stored in the installation's own R2 bucket, previewed in the browser, restricted by role, exported with the record and removed by erasure.

*Acceptance:* A browser journey attaches a PDF pledge agreement to a pledge, previews it, and a backup, restore and erasure include and then remove it.

*Status:* missing. No attachments.

#### DONOR-009 — Address verification and NCOA.

Postal addresses are standardised and verified against USPS data through Smarty when entered, and a scheduled National Change of Address pass through an NCOA licensee updates movers before each mail appeal. Each change keeps the old address in history with its source and date, and undeliverable addresses are flagged so mail appeals exclude them.

*Acceptance:* An HTTP journey with the Smarty and NCOA edges faked enters an address that standardises, runs an NCOA pass that moves one donor and flags one as undeliverable, and a mail appeal excludes the flagged donor with that reason.

*Status:* missing. No address verification or NCOA.

#### DONOR-010 — Volunteer history.

A constituent's volunteer roles, hours and dates are recorded or imported (CSV, or VolunteerHub and Galaxy Digital exports), totalled per year, shown on the timeline and usable in segments, engagement scores and reports.

*Acceptance:* An HTTP journey imports a volunteer-hours CSV, reads per-donor yearly hours on the donor page and filters a list of volunteers who have never given.

*Status:* missing. No volunteer records.

#### DONOR-011 — Giving summary.

Every constituent shows lifetime giving, first gift, largest gift, last gift, number of gifts, consecutive giving years, recurring status, open pledge balance, soft credits and the current fiscal year against last, all derived from the ledger. The fiscal year start is a setting.

*Acceptance:* An HTTP journey records gifts across three years with a July fiscal year and reads each summary figure back from the donor API and page.

*Status:* partial. Lifetime and calendar-year totals exist; first, largest and last gift, consecutive years, recurring status, soft credits and fiscal years do not. Evidence: `src/coffer/donors.ts`, `tests/coffer.test.mjs`.

### Gifts and pledges

Every way US donors give, entered fast and attributed exactly.

#### GIFT-002 — Batch gift entry and deposits.

Staff enter a stack of checks or cash as a batch: shared defaults (date, fund, campaign, appeal, method), keyboard-only entry with donor lookup and add-new inline, a running total checked against the expected deposit total, and a batch that closes only when it balances. A closed batch is one bank deposit for `FIN-001`.

*Acceptance:* A browser journey enters a 12-check batch at 1440 pixels with defaults, is refused closing it while it is $50 off the expected total, corrects it, closes it, and sees one deposit with 12 gifts.

*Status:* missing. Gifts are entered one at a time; no batches or deposit totals.

#### GIFT-003 — Campaign, appeal, fund and channel attribution.

Every gift carries a fund (designation), a campaign, an appeal and its source (form, event, mail piece, email, text-to-give) as structured references, not free text. Funds are restricted or unrestricted with an accounting mapping (`FIN-003`). Online gifts take these from the form and tracked link; imported gifts from the source mapping.

*Acceptance:* An HTTP journey defines funds, a campaign and two appeals, records gifts against them through entry, a form and an import, and reads totals by each dimension that sum to the ledger.

*Status:* partial. Each gift has one free-text fund; no campaigns, appeals or source as structured references. Evidence: `src/coffer/gifts.ts`.

#### GIFT-004 — Split gifts.

One payment can be split across several funds or campaigns in exact cents that sum to the payment. The receipt shows one payment; reports and accounting count each part where it belongs.

*Acceptance:* An HTTP journey splits a $1,000 check $600/$400 across two funds, refuses a split that sums to $999.99, issues one receipt for $1,000 and reads each fund's total.

*Status:* missing. No split gifts.

#### GIFT-005 — Pledges, installments and balances.

A pledge has a total, a schedule (one date, or monthly, quarterly or annual installments), a fund and campaign, and links to the gifts that pay it. Coffer shows paid, due and overdue amounts per installment, writes pledges off or reduces them with a reason (never by deleting), and lets a pledge be paid by a recurring plan (`GIVE-003`). Reminders are `STEW-004`.

*Acceptance:* An HTTP journey creates a $12,000 pledge in four quarterly installments, pays two, sees the third overdue on the pledge and the donor page, reduces the balance with a reason, and reads the full history.

*Status:* partial. A pledge has an amount, an optional due date and linked gifts with a remaining balance; no installment schedule, overdue state or write-off, and no test exercises pledges. Evidence: `src/coffer/donors.ts`, `src/coffer/gifts.ts`.

#### GIFT-006 — Soft credits.

A gift can soft-credit other constituents (a spouse, the board member who solicited it, the donor-advised fund advisor, a peer-to-peer fundraiser) for a full or partial amount. Soft credits appear on the credited record, in its giving summary and in reports as soft credit, never in hard-credit totals or on a tax receipt.

*Acceptance:* An HTTP journey records a DAF grant hard-credited to the sponsor and soft-credited to the advisor, and reads the advisor's soft-credit total separately from hard credit in the donor API and a retention report.

*Status:* missing. No soft credits.

#### GIFT-007 — Matching gifts.

A gift can be marked as eligible for an employer match, with the employer looked up through Double the Donation (360MatchPro) from the donor's email domain or employer field. Coffer tracks the match from eligible to submitted to received, links the employer's payment to the original gift, soft-credits the employee, and reminds the donor (with consent) to submit.

*Acceptance:* An HTTP journey with the Double the Donation edge faked records a $500 gift, finds the employer's 1:1 program, moves the match through submitted to received when the employer's $500 check arrives, and reads the linked gifts and soft credit.

*Status:* missing. No matching-gift tracking or Double the Donation connection.

#### GIFT-008 — Tribute gifts.

A gift can be made in honor or in memory of someone, with an optional person to notify. Coffer records the tribute on the gift, groups gifts by tribute (a memorial fund for one person), and prepares a notification letter or email to the named family without disclosing the amount unless the donor allowed it.

*Acceptance:* A form gift in memory of a named person with a notify-address produces a tribute record, a notification for approval that omits the amount, and a tribute total of all gifts in that name.

*Status:* missing. No tribute records; a gift note can only mention one.

#### GIFT-009 — In-kind gifts.

A non-cash gift records a description, quantity and the donor's stated value for internal reporting. Its acknowledgement describes the property and states no dollar value, as IRS guidance expects; gifts over $5,000 raise a reminder that the donor may need the organization's Form 8283 signature, and selling donated property within three years raises a Form 8282 reminder.

*Acceptance:* An HTTP journey records a donated laptop and a $6,000 artwork, reads acknowledgements that describe each without a value, sees the Form 8283 reminder on the artwork, and a Form 8282 reminder when the artwork is marked sold a year later.

*Status:* missing. Gifts are monetary only.

#### GIFT-010 — Stock, DAF grants and IRA distributions.

Gifts of publicly traded securities (shares, symbol, transfer date, the mean of high and low as the recorded value, and sale proceeds when sold), grants from donor-advised funds (hard credit to the sponsor, soft credit to the advisor, an acknowledgement without deductibility language) and IRA qualified charitable distributions (custodian, acknowledgement stating no goods or services) each have their own gift type and receipt wording.

*Acceptance:* An HTTP journey records one of each, reads the right hard and soft credits, and checks each acknowledgement's wording, including the absence of deductibility language on the DAF grant.

*Status:* missing. No stock, DAF or QCD gift types.

### Online giving

Coffer takes donations itself through the nonprofit's own Stripe account (and PayPal), so a buyer of Givebutter, Zeffy or Bloomerang's forms can switch.

#### GIVE-001 — Donation forms.

An admin builds branded donation forms (logo, colors, copy, suggested amounts, one-time and recurring toggle, designation picker, tribute fields, employer field, comment, optional fee cover) and publishes them as a hosted page and an embeddable script for any website, including Pane, WordPress and Squarespace. Forms are accessible (WCAG 2.2 AA), work at 390 pixels, load in under one second and record each gift with its form, campaign and source.

*Acceptance:* A browser journey builds a form, embeds it on a test page, and gives $50 at 1440 and 390 pixels with the Stripe edge in test mode; the gift, donor, consent answer and receipt appear in Coffer, and an axe check of the form passes.

*Status:* missing. No donation forms; Coffer takes no payments.

#### GIVE-002 — Campaign pages.

A campaign page tells the story with images and video, shows a goal thermometer and donor count from the ledger, lists recent donors who chose to be shown, and holds a form. Pages have a custom path on the nonprofit's domain and close on a date.

*Acceptance:* A browser journey publishes a campaign page with a $60,000 goal, gives twice through it, and sees the thermometer, donor count and opt-in donor wall update; after the close date the page refuses new gifts with a message.

*Status:* missing. No campaign pages.

#### GIVE-003 — Recurring giving.

Donors choose monthly, quarterly or annual giving on any form. Coffer schedules each installment itself against the donor's saved Stripe payment method (or keeps an adopted Stripe subscription running), records every successful installment as a gift linked to its plan, and shows plan status (active, past due, paused, cancelled) with its history. Staff can create a plan from a signed pledge form, change amount or date, pause and cancel, each recorded.

*Acceptance:* An HTTP journey with Stripe in test mode and a test clock starts a $25 monthly plan, advances three months, reads three linked gifts, pauses and resumes the plan, and cancels it.

*Status:* missing. No recurring plans.

#### GIVE-004 — Card, bank, wallet and PayPal checkout.

Forms accept cards, US bank accounts through ACH Direct Debit with instant verification, Apple Pay and Google Pay through Stripe, and PayPal and Venmo through PayPal Checkout. ACH gifts are pending until they settle and become ledger lines only when funds arrive; a later return (insufficient funds, closed account) reverses the gift and opens follow-up. Coffer never sees or stores card or account numbers.

*Acceptance:* A browser journey with provider test modes gives by card, ACH (with a later R01 return that writes a reversal and a task), Apple Pay on a WebKit device profile and PayPal, and an inspection of stored records finds no card or account numbers.

*Status:* missing. No checkout.

#### GIVE-005 — Donor portal.

Donors sign in with an emailed link (no password) to see their gifts, download receipts and year-end statements, update the card or bank account behind a recurring plan through a Stripe-hosted update, change amount or frequency, pause or cancel, and set their communication preferences. Every change is recorded on their timeline and reaches staff when it matters (a cancellation opens a task).

*Acceptance:* A browser journey at 390 pixels signs a donor in by link, downloads last year's statement, replaces an expiring card, lowers the monthly amount and withdraws email consent; staff see each change on the timeline and a cancellation task.

*Status:* missing. No donor-facing portal.

#### GIVE-006 — Failed recurring payments.

When an installment fails, Coffer retries on a schedule (or follows Stripe's retry outcome for an adopted subscription), emails the donor a link to update their payment method, warns donors a month before a saved card expires, marks the plan past due, and opens a task for the plan's relationship manager when retries run out. A recovered plan records which step recovered it.

*Acceptance:* An HTTP journey with the Stripe edge faked fails a monthly installment, sends the donor notice, recovers on the second retry and records it; a second plan exhausts retries and opens a task; an expiring card sends the warning a month ahead.

*Status:* missing. No recurring payments, retries, notices or expiry warnings.

#### GIVE-007 — Fraud and card-testing protection.

Donation forms resist card testing: Cloudflare Turnstile challenges, per-address and per-card rate limits, Stripe Radar rules, a minimum amount, and an automatic pause of a form whose failure rate spikes, with an alert to the admin. Fraudulent gifts that slip through are refunded and kept out of donor records and retention figures.

*Acceptance:* An HTTP journey sends 30 small card attempts from one address in a minute; attempts after the limit are refused, the form pauses and the admin is alerted, and no donor records are created for the failures.

*Status:* missing. No forms to protect.

#### GIVE-008 — Text-to-give.

A nonprofit claims a keyword on its Twilio number; a donor who texts it gets a link to a mobile form prefilled with their phone number, and the gift is attributed to the text-to-give source. Replies of STOP end messages at once.

*Acceptance:* An HTTP journey with the Twilio edge faked texts a keyword, follows the link, gives, and sees the gift attributed to text-to-give; a STOP reply records SMS consent as withdrawn.

*Status:* missing. No text-to-give.

### Campaigns, events and memberships

The fundraising programmes the incumbents run gifts through.

#### CAMP-001 — Campaigns with goals.

A campaign has a goal, dates, funds, appeals and forms under it; progress is counted from the ledger (gifts, pledges outstanding, soft credits shown separately), with donors, new donors, recurring donors and average gift. Campaigns can nest (a capital campaign with yearly phases).

*Acceptance:* An HTTP journey creates a spring appeal campaign with a $60,000 goal, records form, check and pledge gifts against it, and reads raised, pledged, donor and recurring counts that match the ledger.

*Status:* missing. No campaigns or goals.

#### CAMP-002 — Fundraising events.

An event has ticket types with the fair market value of the benefit, registration through a hosted page with attendee names and dietary notes, sponsorship and table packages, a guest list, and check-in on a phone. A ticket's contribution part (price minus fair market value) is receipted with the quid pro quo disclosure (`RCPT-005`); attendance joins each guest's timeline.

*Acceptance:* A browser journey sells a $150 gala ticket with a $60 dinner value, checks the guest in at 390 pixels, and reads a receipt stating $90 deductible and the attendance on the guest's timeline.

*Status:* missing. No events.

#### CAMP-003 — Peer-to-peer fundraising.

Supporters create personal or team fundraising pages under a campaign, share them, and see their totals on a leaderboard. Each gift is hard-credited to its donor and soft-credited to the fundraiser; fundraisers get thank-you and milestone emails.

*Acceptance:* A browser journey creates a team and two personal pages, gives through each, and reads the leaderboard, the donor hard credits and the fundraiser soft credits.

*Status:* missing. No peer-to-peer pages.

#### CAMP-004 — Memberships.

Membership levels with price, term and benefits; joins and renewals through forms or entry; automatic renewal on a recurring plan; expiry, grace period and lapsed status; renewal reminders; and member counts by level. The contribution part of a membership is receipted like any gift with its benefits disclosed.

*Acceptance:* An HTTP journey sells an annual membership with auto-renew, advances a test clock past the term, sees the renewal charge, then lets a second membership lapse and receives its reminder and lapsed status.

*Status:* missing. No memberships.

### Payments

Gifts, fees, refunds and payouts arrive from the processor by themselves and match to the cent.

#### PAY-001 — Live Stripe connection.

The owner connects the nonprofit's Stripe account (Stripe Connect OAuth or a restricted key). Coffer registers a signed webhook, processes each event once by its id, backfills history through the list APIs, and runs a daily sweep of balance transactions that catches any missed event. Payments made outside Coffer (Payment Links, Stripe Checkout elsewhere, an existing subscription) become gifts matched to donors by email, with unclear matches waiting in a review queue.

*Acceptance:* An HTTP journey with Stripe in test mode connects an account, receives charge and refund webhooks (one replayed, one with a bad signature refused), drops one event and sees the daily sweep add it, and reviews an ambiguous donor match.

*Status:* partial. Only saved Stripe customer and charge pages can be moved in; there is no connection, webhook, backfill or sweep. Evidence: `src/coffer/imports/snapshots.ts`, `src/coffer/imports/service.ts`.

#### PAY-002 — Payouts with their gifts.

Each Stripe payout is recorded with every gift, refund, dispute and fee it contains, so a bank deposit opens to the exact gifts behind it. A payout whose contents do not sum to the deposited amount is flagged with the difference explained.

*Acceptance:* An HTTP journey with the Stripe edge faked receives a payout of 14 charges, two fees and one refund, opens it in Coffer, and reads gross, fees, refunds and net equal to the deposit.

*Status:* missing. No payouts.

#### PAY-003 — Refunds and disputes.

A refund or dispute from the processor (or a staff-initiated refund through Coffer, which calls Stripe) writes a reversal line against the original gift, voids or corrects its receipt (`RCPT-008`), notifies the relationship manager, and for a dispute tracks evidence due dates and the outcome. A won dispute reinstates the gift as a new line.

*Acceptance:* An HTTP journey with the Stripe edge faked refunds half a gift, opens a dispute on another and wins it, and reads the reversal lines, the corrected receipt and the reinstated gift.

*Status:* partial. Reversal lines exist, and move-in nets partial refunds and skips full refunds; no live refunds, disputes or receipt corrections. Evidence: `src/coffer/gifts.ts`, `src/coffer/imports/snapshots.ts`.

#### PAY-004 — Processing fees and fee cover.

Each online gift records its processing fee from the processor's balance transaction. A donor who covers the fee gives the grossed-up amount and is receipted for the full amount paid. Reports show gross, fees and net by fund, form and campaign.

*Acceptance:* An HTTP journey gives $100 with fee cover, reads the gift, fee and receipt amounts, and a fee report by form that sums to the payouts.

*Status:* missing. No fees recorded.

#### PAY-005 — Other giving platforms.

A nonprofit that keeps Givebutter, Donorbox, PayPal Giving Fund or a workplace-giving platform such as Benevity for some gifts connects it (Givebutter's API and webhooks, Donorbox's API, CSV disbursement reports otherwise); those gifts arrive in the same ledger with their source, fees and payout, matched to donors with the same review queue as `PAY-001`.

*Acceptance:* An HTTP journey with the Givebutter edge faked ingests transactions and a changed transaction, and imports a Benevity disbursement CSV, reading gifts with source, fees and payout matched to donors.

*Status:* missing. No other platform connections.

### Accounting

Coffer reconciles to the books; the general ledger stays in Pantry or QuickBooks Online.

#### FIN-001 — QuickBooks Online sync.

The owner connects QuickBooks Online and maps each fund to an income account and class (or location), fees to an expense account, and the Stripe and checking accounts. Coffer posts one deposit per payout and per check batch with lines per fund and a fee line, so each deposit matches the bank feed; refunds and disputes post as their own entries. Posts are idempotent, a failed post retries and is shown, and nothing posts twice.

*Acceptance:* An HTTP journey with the QuickBooks Online edge faked maps three funds, posts a payout and a check batch, replays the post without a duplicate, and reads deposits whose lines and totals equal Coffer's.

*Status:* missing. No accounting connection.

#### FIN-002 — Pantry sync.

The same mapping and deposit posting as `FIN-001` into Pantry, Run Edit Run's accounting product, through its API, so a nonprofit on Pantry reconciles donations without a spreadsheet.

*Acceptance:* An HTTP journey with the Pantry edge faked posts a payout and a check batch and reads matching deposits.

*Status:* missing. No Pantry connection.

#### FIN-003 — Restricted funds.

Funds are marked restricted (purpose or time) or unrestricted; restricted gifts carry the restriction to accounting, and a release-of-restriction report shows what was given, spent (entered or synced from accounting) and still held per restricted fund.

*Acceptance:* An HTTP journey records restricted and unrestricted gifts, enters a spend against a restricted fund, and reads the release report.

*Status:* partial. Every gift has a free-text fund (default Unrestricted); no restriction type, mapping or release report. Evidence: `src/coffer/gifts.ts`.

#### FIN-004 — Journal export for other ledgers.

Nonprofits on QuickBooks Desktop, Xero, Aplos or Sage Intacct download the same deposits as a journal file (IIF, CSV) per period with their account and class mapping.

*Acceptance:* An HTTP journey downloads a month's journal and checks its totals by account against the ledger.

*Status:* missing. No journal export.

#### FIN-005 — Reconciliation report.

For any period Coffer shows gifts in the ledger, money received by the processor, payouts deposited and amounts posted to accounting side by side by fund, with every difference listed and explained (pending ACH, unposted batch, refund after payout).

*Acceptance:* An HTTP journey builds a month with a pending ACH gift and a refund after payout and reads a report whose listed differences account for every cent.

*Status:* missing. No reconciliation report.

### Receipts and acknowledgements

Every donor is thanked and receipted, correctly for US tax rules, and Coffer knows it arrived.

#### RCPT-001 — Immediate email receipts.

Every online gift gets an emailed receipt within a minute from the nonprofit's verified domain, with the form's or campaign's thank-you text, the IRS language of `RCPT-005` and a PDF. Receipts are transactional: they are sent even to donors who unsubscribed from appeals. Offline gifts get one when the batch closes, if the admin turns that on.

*Acceptance:* An HTTP journey with the mail edge faked gives online and reads one receipt message with the right amount, statement and PDF within a minute; a donor who withdrew email consent for appeals still receives it.

*Status:* missing. Coffer sends no donor email.

#### RCPT-002 — Acknowledgements delivered by email.

An approved acknowledgement batch (`ACK-001`) is sent by email from Coffer to every recipient with an address, one message per letter, through the installation's mail provider; the rest go to print (`RCPT-003`). The batch is sent only after approval of its exact hash, and its status is the delivery result, not a person's assertion.

*Acceptance:* An HTTP journey with the mail edge faked approves a batch of three letters, sends it, and reads two delivered emails and one letter routed to print, with the batch status computed from delivery.

*Status:* partial. Letters are prepared, approved and exported as CSV, and a person records a sent date; Coffer does not send them. Evidence: `src/coffer/acknowledgements.ts`, `tests/coffer.test.mjs`.

#### RCPT-003 — Print-ready letters, labels and envelopes.

Letters render to a print-ready PDF on letterhead (one per page, window-envelope address placement), with mailing labels (Avery 5160) and #10 envelopes, and a Word mail-merge file for nonprofits that prefer it. Optional sending through Lob prints and mails them and records USPS tracking events.

*Acceptance:* An HTTP journey downloads the PDF, labels and merge file for a batch and checks page count, addresses and placement; with the Lob edge faked the batch is mailed and tracking events land on each donor's timeline.

*Status:* partial. A CSV with letter text and postal fields exists for a mail merge; no PDF, labels, envelopes or Lob. Evidence: `src/coffer/acknowledgements.ts`.

#### RCPT-004 — Year-end giving statements.

In January Coffer prepares one statement per donor (or household) for the prior calendar year listing each gift, its goods-or-services value and deductible part, excluding DAF grants and soft credits, for approval; then emails it, routes no-email donors to print, and publishes it in the donor portal. Donors can request a copy any time; corrections reissue with the change shown.

*Acceptance:* An HTTP journey approves and sends statements for donors with one-time, monthly and event gifts, reads each statement's gift lines and totals, and downloads one from the portal.

*Status:* missing. No year-end statements.

#### RCPT-005 — US receipt rules.

Receipt templates must state the organization's name and EIN, the amount or a description of non-cash property, the date, and whether goods or services were provided with their good-faith value. Coffer applies the $250 written-acknowledgement rule, the quid pro quo disclosure for any payment over $75 that is partly a contribution, the token-benefit exception at the IRS's current inflation-adjusted figures (a setting), and intangible religious benefit wording for religious organizations.

*Acceptance:* An HTTP journey receipts a $250 gift, an $80 ticket with $50 of dinner (disclosure required though under $250), a gift with a token mug, and a non-cash gift, and checks each statement against the rule it exercises.

*Status:* partial. Templates must carry donor, amount, date, organization and the goods-or-services statement, and the $250 threshold works; no quid pro quo rule for payments over $75, token-benefit or religious-benefit wording. Evidence: `src/coffer/settings.ts`, `src/coffer/acknowledgements.ts`, `tests/coffer.test.mjs`.

#### RCPT-006 — Delivery tracking.

Every receipt, acknowledgement and statement keeps its delivery result from the provider: delivered, bounced, complained, opened where tracked, and for mail the print vendor's events. A bounce opens a task to fix the address and offers print instead; the donor page shows each document's delivery.

*Acceptance:* An HTTP journey with the mail edge faked sends three receipts, one bounces, and the bounced one shows on the donor page with a task and a print option.

*Status:* partial. A person records a sent date and method per batch; no provider delivery, bounce or open results. Evidence: `src/coffer/acknowledgements.ts`.

#### RCPT-007 — Thank-you templates.

Admins keep several reviewed templates: per form and campaign, first gift, recurring start, major gift, tribute, in-kind and year-end. Each template is checked for the required receipt facts before it can be used, and its version is recorded with every message sent.

*Acceptance:* An HTTP journey saves a first-gift template, refuses one missing the goods-or-services statement, gives a first and a second gift, and reads the different templates and their versions on each receipt.

*Status:* partial. One reviewed letter template with required facts exists; no templates per form, campaign or gift type. Evidence: `src/coffer/settings.ts`, `tests/coffer.test.mjs`.

#### RCPT-008 — Corrected and voided receipts.

When a gift is reversed, refunded, split differently or reassigned, its receipt is voided or reissued with a corrected copy that says what changed, and the donor is told when a corrected receipt is sent. Receipt numbers are sequential per year and never reused.

*Acceptance:* An HTTP journey refunds half a receipted gift and reads a corrected receipt with the next number referencing the original, and a voided one for a fully reversed gift.

*Status:* missing. No receipt numbering, voiding or reissue.

### Communication

Appeals and donor conversations actually go out, through the sender the nonprofit already uses, and replies come back.

#### COMM-001 — Preferences and unsubscribes everywhere.

Consent covers email, postal mail, SMS and phone, with frequency preferences and topic subscriptions (newsletter, appeals, events). Every marketing email carries a one-click unsubscribe; unsubscribes and preference changes from the donor portal, Mango, Mailchimp, Constant Contact and Twilio arrive as new consent rows with their source, and every send in Coffer checks the current answer.

*Acceptance:* An HTTP journey with sender edges faked has a donor unsubscribe in Mailchimp, reply STOP by text and change topics in the portal, and the next appeal of each channel excludes them with the reason.

*Status:* partial. Append-only email and postal consent gates appeals; no SMS or phone channel, topics, unsubscribe links or provider sync. Evidence: `src/coffer/donors.ts`, `src/coffer/appeals.ts`, `tests/coffer.test.mjs`.

#### COMM-002 — Appeals sent through Mango or Mailchimp.

Coffer syncs consenting constituents into Mango (Run Edit Run's email product) or Mailchimp as an audience with giving merge fields and tags; an approved appeal (`APPEAL-001`) is created there as a campaign to exactly the frozen audience, sent on approval or schedule, and its sends, bounces, opens, clicks and unsubscribes return to each donor's timeline. Donation links carry the appeal's source code so resulting gifts are attributed.

*Acceptance:* An HTTP journey with the Mango and Mailchimp edges faked syncs an audience, sends an approved appeal to exactly its frozen recipients, receives results and an unsubscribe, and attributes a gift made from the tracked link.

*Status:* partial. An approved audience exports as CSV for any sender; no sender connection, sending, results or attribution. Evidence: `src/coffer/appeals.ts`, `tests/coffer.test.mjs`.

#### COMM-003 — Constant Contact.

The same audience sync, campaign send and results return as `COMM-002` through Constant Contact's v3 API, for nonprofits already on it.

*Acceptance:* An HTTP journey with the Constant Contact edge faked syncs, sends and receives results.

*Status:* missing. No Constant Contact connection.

#### COMM-004 — One-to-one email and mailbox logging.

Staff connect Gmail or Microsoft 365; messages to and from known constituents are logged on their timelines (subject, excerpt, link), and staff write personal emails from the donor page that send from their own mailbox. A BCC address logs mail from any client.

*Acceptance:* An HTTP journey with the Gmail and Microsoft Graph edges faked logs a received and a sent message on the right donor, sends a personal email from the donor page, and logs one through the BCC address.

*Status:* missing. No mailbox connection or personal email.

#### COMM-005 — Replies reach the right person.

Replies to receipts, acknowledgements and appeals arrive at a Coffer inbound address (Cloudflare Email Routing), are logged on the donor's timeline and assigned to the donor's relationship manager as a task; out-of-office replies are recognised and filed, and a reply that asks to stop is proposed as a consent withdrawal for one click to confirm.

*Acceptance:* An HTTP journey with inbound mail faked receives a thank-you reply, an out-of-office and a "please remove me", and sees a task for the manager, a filed auto-reply and a proposed withdrawal.

*Status:* missing. No inbound mail.

#### COMM-006 — SMS outreach.

Thank-you and reminder texts through Twilio from a registered 10DLC number, only to donors with SMS consent, within quiet hours (8 a.m. to 9 p.m. in the donor's time zone), with STOP and HELP handled and replies logged and assigned.

*Acceptance:* An HTTP journey with the Twilio edge faked sends a thank-you text, holds one scheduled at 10 p.m. donor time until morning, records a reply as a task and a STOP as withdrawn consent.

*Status:* missing. No SMS.

#### COMM-007 — Direct mail appeals.

A mail appeal produces a mail-house file (or a Lob send) with names, verified addresses, salutations, ask amounts based on last gift, and a response code per piece; returned reply cards and gifts entered with that code attribute to the appeal, and mailing history is kept per donor.

*Acceptance:* An HTTP journey prepares a mail appeal with ask amounts and codes, enters two coded reply gifts in a batch, and reads the appeal's response rate and the mailing on each donor.

*Status:* partial. Mail-channel audiences with postal addresses export as CSV; no ask amounts, response codes or mailing history. Evidence: `src/coffer/appeals.ts`, `tests/coffer.test.mjs`.

#### COMM-008 — Appeal results.

Each appeal shows recipients, delivered, opened, clicked, responded, gifts, dollars, average gift, cost and return, with a comparison to earlier appeals, from the ledger and the sender results.

*Acceptance:* An HTTP journey runs an email and a mail appeal with gifts from each and reads results that match the ledger and sender events.

*Status:* missing. No appeal results.

### Stewardship and follow-up

Every donor gets the next touch, and the team knows who owes it.

#### STEW-001 — Tasks with owners and reminders.

Tasks (call, meeting, thank-you, follow-up, data fix) are assigned to a person with a due date and a linked constituent, gift or opportunity; overdue tasks escalate to the assignee's manager; each person has a daily list and email or Nook and Slack reminders. Completing a task logs it on the timeline.

*Acceptance:* A browser journey assigns a thank-you call due tomorrow, receives the reminder, completes it with a note that lands on the timeline, and lets a second task go overdue to see the escalation.

*Status:* missing. No tasks.

#### STEW-002 — Recurring tasks.

A task can repeat (quarterly board-member check-in, monthly donor-retention review); the next one is created when the last is completed or its due date passes.

*Acceptance:* An HTTP journey completes a quarterly task and reads the next one dated three months on.

*Status:* missing. No tasks.

#### STEW-003 — Stewardship journeys.

Admins build journeys triggered by first gift, recurring start, a gift over an amount, giving anniversary, lapse (no gift in twelve months), event attendance or joining a list. Steps send email (personal-style through `RCPT-001`'s path or marketing through Mango or Mailchimp), create tasks, wait, and branch on whether the donor gave or replied; a donor leaves when they give, unsubscribe or are moved. A journey runs only after a person publishes it, enrollment is visible per donor, and a frequency cap applies across journeys.

*Acceptance:* An HTTP journey with sender edges faked publishes a three-step first-gift welcome, enrols a new donor, advances time through each step, and sees the donor leave when they give again; a second journey respects the frequency cap.

*Status:* missing. No journeys.

#### STEW-004 — Pledge reminders and invoices.

Before each installment is due Coffer sends the donor a reminder or invoice (email with a pay link, or print), records it, and after the due date follows up on a schedule and opens a task for the relationship manager.

*Acceptance:* An HTTP journey creates a quarterly pledge, receives the reminder a week before an installment, pays through the link, and lets the next installment go overdue to see the follow-up and task.

*Status:* missing. No pledge reminders.

#### STEW-005 — Gift-triggered rules.

Simple rules act on gifts as they arrive: a gift of $1,000 or more creates a call task for the executive director within 48 hours; a first gift adds a tag; a gift to a fund notifies its program lead in Nook or Slack. Imported historical gifts never fire rules.

*Acceptance:* An HTTP journey defines two rules, gives through a form and imports old gifts, and sees the rules fire for the new gift only.

*Status:* missing. No rules.

#### STEW-006 — Meetings and calendars.

Staff connect Google Calendar or Microsoft 365; meetings with constituents log on their timelines, and staff share a Dial or Calendly scheduling link from the donor page whose booking lands as a meeting and a task.

*Acceptance:* An HTTP journey with the calendar edge faked logs a meeting with a donor and receives a Dial booking that creates a meeting record and a preparation task.

*Status:* missing. No calendar connection.

### Major gifts and moves management

The pipeline Raiser's Edge NXT and Bloomerang sell to development directors.

#### MAJOR-001 — Opportunity pipeline.

An opportunity has a prospect, ask amount, expected amount, probability, target date, fund and stage (identify, qualify, cultivate, solicit, steward, closed won or lost, configurable). Pipeline boards and lists filter by manager, stage and campaign; a closed-won opportunity links to its pledge or gift so the forecast never double-counts.

*Acceptance:* A browser journey creates three opportunities, moves one through to solicit, closes it won with a pledge, and reads a pipeline total that excludes the closed amount from the forecast.

*Status:* missing. No opportunities or pipeline.

#### MAJOR-002 — Portfolios and moves.

Each major-gift prospect has a relationship manager and a portfolio; Coffer counts each manager's moves (meaningful contacts) per period, flags prospects with no contact in a set number of days, and shows portfolio size, pipeline and dollars raised per manager.

*Acceptance:* An HTTP journey assigns two portfolios, logs contacts on some prospects, and reads moves counts and a flagged list of untouched prospects per manager.

*Status:* missing. No portfolios.

#### MAJOR-003 — Action plans and proposals.

A cultivation plan is a template of steps (tour, lunch with the board chair, proposal, ask) applied to an opportunity as dated tasks; proposals are drafted and attached, sent, and their response recorded.

*Acceptance:* An HTTP journey applies a four-step plan to an opportunity, completes two steps, attaches a proposal and records it as sent.

*Status:* missing. No plans or proposals.

#### MAJOR-004 — Engagement and retention scores.

Every constituent gets a transparent engagement score from recency, frequency and amount of giving plus opens, replies, events, volunteering and meetings, and a retention-risk flag; the formula and each donor's contributing factors are shown, and the weights are an admin setting.

*Acceptance:* An HTTP journey builds donors with different histories and reads scores and factors that follow the stated formula, then changes a weight and sees the scores change.

*Status:* missing. No scores.

#### MAJOR-005 — Prospect research.

An admin screens selected records through DonorSearch or WealthEngine; ratings, capacity ranges and philanthropic indicators are stored with provider and date, visible only to permitted roles, never shown to donors, and removed by erasure.

*Acceptance:* An HTTP journey with the DonorSearch edge faked screens a list, reads stored ratings with provenance as an admin, is refused them as a data-entry user, and erases one donor's results.

*Status:* missing. No prospect research.

#### MAJOR-006 — Grants from foundations and corporations.

A grant request has a funder, program, amount requested, deadlines (letter of inquiry, proposal, report), status and documents; an award becomes a restricted pledge with its payment schedule and reporting tasks.

*Acceptance:* An HTTP journey tracks a request from letter of inquiry to award, reads the restricted pledge and the report-due task, and records the payment against it.

*Status:* missing. No grant tracking.

#### MAJOR-007 — Planned giving.

Bequest and other planned-gift intentions are recorded with vehicle, estimated value, documentation status and legacy-society membership; a realized estate gift links to its intention.

*Acceptance:* An HTTP journey records a bequest intention, enrols the donor in the legacy society, and links a later estate distribution to it.

*Status:* missing. No planned-giving records.

### Reporting

The numbers boards and development committees ask for, reconciled with the ledger.

#### REPORT-001 — Donor retention.

Retention, new, retained, recaptured, upgraded, downgraded and lapsed donors and dollars per year, following the Fundraising Effectiveness Project's definitions, by fiscal or calendar year, for any list, fund or campaign; each figure opens to its donors.

*Acceptance:* An HTTP journey builds three years of giving and reads retention figures that match a hand calculation, then opens the lapsed figure to its donors.

*Status:* partial. Per-donor lifetime and yearly totals exist; no organization-wide retention, cohorts or lapse. Evidence: `src/coffer/donors.ts`, `tests/coffer.test.mjs`.

#### REPORT-002 — LYBUNT and SYBUNT lists.

Donors who gave last year but not this year (LYBUNT) and some year but not this year (SYBUNT), with last gift and amount, as lists that feed appeals, journeys and call tasks.

*Acceptance:* An HTTP journey reads both lists for a built history and sends the LYBUNT list to an appeal.

*Status:* missing. No lapse lists.

#### REPORT-003 — Fundraising dashboards.

A home dashboard and report pages show raised this fiscal year against last and goal, by fund, campaign, appeal, form, channel and month, with recurring revenue, new donors, retention and pipeline; every number opens to its gifts.

*Acceptance:* A browser journey at 1440 and 390 pixels reads the dashboard for a built year and opens a fund total to the gifts that make it.

*Status:* partial. Today shows the current calendar year's total and acknowledgement backlog; no breakdowns, goals, comparisons or drill-down. Evidence: `src/coffer/ui/home.ts`.

#### REPORT-004 — Report builder.

Staff build reports on constituents, gifts, pledges, opportunities and interactions with columns, filters, grouping and totals, save and share them, and export CSV or Excel; definitions are editable and portable.

*Acceptance:* An HTTP journey saves a gifts-by-fund-by-month report, shares it with a member, and exports it with totals that match the ledger.

*Status:* missing. No report builder.

#### REPORT-005 — Scheduled reports.

Any saved report or dashboard is emailed to chosen people on a schedule (weekly to the director, monthly to the board) as a link and attachment.

*Acceptance:* An HTTP journey schedules a weekly report with the mail edge faked, advances a week and reads the delivered report.

*Status:* missing. No scheduled reports.

#### REPORT-006 — Recurring giving health.

Active recurring donors, monthly recurring revenue, new and cancelled plans, failed and recovered payments, and average plan length, by month.

*Acceptance:* An HTTP journey runs plans through starts, failures, recoveries and cancellations on a test clock and reads matching monthly figures.

*Status:* missing. No recurring plans to report.

#### REPORT-007 — IRS Form 990 support.

A contributor report for Schedule B (contributors at or above the $5,000 general rule, or the 2% special rule for publicly supported organizations, a setting), five-year giving per donor for the Schedule A public support test, and noncash contribution totals for Schedule M, for the accountant who prepares the return.

*Acceptance:* An HTTP journey with a built five-year history reads the Schedule B list under both rules and five-year totals that match the ledger.

*Status:* missing. No Form 990 reports.

### Moving in

A buyer of each named incumbent moves in with full history, checked before the switch.

#### MOVE-001 — From Little Green Light.

Coffer reads Little Green Light's exports (constituents with all fields, gifts with funds, campaigns and appeals, split and soft-credit details, pledges and installments, relationships and households, notes and contact reports, groups and categories, memberships, volunteer time, mailing history and email preferences) with a saved mapping, previews without writing, applies the reviewed plan and can undo, as `IMPORT-001` does for Stripe.

*Acceptance:* An HTTP journey imports a fixture LGL export set, previews counts and totals by year and fund, applies, reads a donor's full history with relationships, soft credits and notes, and undoes.

*Status:* missing. Only the Stripe importer exists.

#### MOVE-002 — From Bloomerang.

Coffer reads Bloomerang through its REST API with the nonprofit's key (or its exports): constituents, households, relationships, transactions with designations, soft credits, pledges, recurring donation records, interactions, notes, tasks and communication preferences, with the same preview, apply and undo.

*Acceptance:* An HTTP journey with the Bloomerang edge faked imports a fixture account, reads totals by year and designation equal to the source, and undoes.

*Status:* missing. No Bloomerang importer.

#### MOVE-003 — From Raiser's Edge NXT.

Coffer reads Raiser's Edge NXT through Blackbaud's SKY API (or database view exports): constituents, relationships, gifts with splits and soft credits, funds, campaigns and appeals, pledges, actions, opportunities, notes and solicit codes, with preview, apply and undo.

*Acceptance:* An HTTP journey with the SKY API edge faked imports a fixture database, reads gifts with splits and opportunities equal to the source, and undoes.

*Status:* missing. No Raiser's Edge NXT importer.

#### MOVE-004 — From Neon CRM.

Coffer reads Neon CRM through its API (or exports): accounts, households, donations, pledges, recurring donations, memberships, event registrations, activities and soft credits, with preview, apply and undo.

*Acceptance:* An HTTP journey with the Neon edge faked imports a fixture organization with memberships and events and reads matching totals.

*Status:* missing. No Neon CRM importer.

#### MOVE-005 — From Givebutter and Zeffy.

Coffer reads Givebutter (API: contacts, transactions, recurring plans, campaigns) and Zeffy (exports) history, keeping each gift's campaign and fees.

*Acceptance:* An HTTP journey imports fixture Givebutter and Zeffy data and reads gifts with campaign and fee totals equal to the source.

*Status:* missing. No Givebutter or Zeffy importer.

#### MOVE-006 — Any spreadsheet.

A CSV or Excel file of constituents, gifts or interactions maps column by column, with saved mappings, value translation (fund names, payment methods), the same duplicate checks as `DONOR-006`, preview, apply and undo.

*Acceptance:* A browser journey maps a gifts spreadsheet, translates two fund names, previews matches to existing donors, applies and undoes.

*Status:* missing. No general importer.

#### MOVE-007 — Totals checked before the switch.

Every move-in ends in a reconciliation: donors, gifts and dollars by year and fund in the source against Coffer, open pledges, active recurring plans, consent counts and receipts already sent, with each difference listed. Recurring plans on the nonprofit's own Stripe account are adopted without donor action; plans on a processor Coffer cannot adopt get a reauthorization campaign (`DEV-007`) and are never cancelled at the source until the replacement is confirmed. The owner signs off the cutover.

*Acceptance:* An HTTP journey imports a fixture with one deliberate gap, reads the difference in the reconciliation, adopts two Stripe subscriptions, lists one plan for reauthorization, and records the owner's sign-off.

*Status:* partial. The Stripe move-in preview shows donors, gifts, totals and every skip before apply; no per-year and fund reconciliation, recurring adoption or cutover sign-off. Evidence: `src/coffer/imports/service.ts`, `src/coffer/ui/move-in.ts`, `tests/coffer.test.mjs`.

#### MOVE-008 — Consent and preferences moved with provenance.

Every importer carries each donor's email, mail, SMS and phone preferences as consent rows marked with the source system and date, so `APPEAL-001` and `COMM-001` honour them from the first send; an unknown preference is imported as unknown, never as yes.

*Acceptance:* An HTTP journey imports an LGL fixture with opted-out and unknown donors and prepares an appeal that excludes both with their reasons.

*Status:* missing. No importer carries consent.

### Team and access

Roles a small development shop and its volunteers need.

#### TEAM-001 — Roles and record-level access.

Roles cover owner, admin, fundraiser, finance, data entry, volunteer and read-only, plus agents; a fundraiser can be limited to their portfolio, confidential notes and prospect research are restricted, finance can post and reconcile but not export donor lists, and exports of donor data are permitted per role and logged.

*Acceptance:* An HTTP journey signs in as each role and is allowed or refused each listed action, including a portfolio-limited fundraiser opening another portfolio's prospect.

*Status:* partial. Owner, admin, member and agent roles guard every command; no fundraiser, finance, volunteer or read-only roles, portfolio scoping or confidential fields. Evidence: `src/coffer/commands.ts`, `src/coffer/auth.ts`, `tests/coffer.test.mjs`.

#### TEAM-002 — Single sign-on and two-step sign-in.

Staff sign in with Google Workspace or Microsoft Entra ID, the owner can require it, and accounts without a provider use a second factor.

*Acceptance:* A browser journey with the identity edge faked signs in through an OIDC provider, is refused password-only sign-in after the owner requires SSO, and completes a second factor on a non-SSO account.

*Status:* partial. Base sign-in supports an OIDC provider; requiring SSO and a second factor are not offered in Coffer. Evidence: `src/modules/operator-auth/identity/oidc`.

#### TEAM-003 — Audit log.

Every change, approval, export, sign-in and agent action is in an audit log the owner can browse, filter by person, record and action, and export.

*Acceptance:* An HTTP journey makes changes as two people and an agent and reads them in the audit log filtered by person and exported as CSV.

*Status:* partial. Every command writes an event shown per donor and per batch; no organization-wide log, filters or export. Evidence: `src/coffer/db.ts`, `src/coffer/ui/donors.ts`.

### Integrations and API

Coffer joins the rest of the nonprofit's stack.

#### API-001 — Public REST API.

A versioned REST API with an OpenAPI document covers constituents, gifts, pledges, plans, interactions, tasks, opportunities, funds and campaigns, with scoped keys (read only, gift entry, full), rate limits and idempotency keys on writes.

*Acceptance:* An HTTP journey creates a read-only key and a gift-entry key, reads donors with the first, is refused a write, records a gift idempotently with the second, and validates responses against the OpenAPI document.

*Status:* partial. Authenticated donor reads and a command API exist; no versioned public API, OpenAPI document, scoped keys or idempotency keys. Evidence: `src/coffer/http.ts`, `src/coffer/commands.ts`, `tests/coffer.test.mjs`.

#### API-002 — Webhooks.

Signed webhooks for gift created and reversed, donor created and updated, plan failed and cancelled, task assigned and form submitted, retried with backoff and replayable from a delivery log.

*Acceptance:* An HTTP journey subscribes an endpoint, records a gift, verifies the signature, fails one delivery and sees the retry and replay.

*Status:* missing. No webhooks.

#### API-003 — Zapier and Crank.

A published Zapier app and a Crank connector expose the webhook triggers and API actions, so nonprofits automate with their existing tools.

*Acceptance:* A Zapier CLI validation of the app passes, and a Crank flow triggered by a Coffer gift creates a task through the API.

*Status:* missing. No Zapier app or Crank connector.

#### API-004 — MCP endpoint.

An MCP endpoint lets a nonprofit's own AI assistant read donor context and propose records under the same keys, roles and approvals as `AGENT-001` and `DEV-012`.

*Acceptance:* An MCP client lists donors and drafts an acknowledgement batch through the endpoint, which a person then approves; a write outside its grant is refused.

*Status:* missing. No MCP endpoint.

### Mobile

Development work happens at events, in cars and over coffee.

#### MOBILE-001 — Phone-ready web app.

Every staff screen works at 390 pixels, and the phone views put donor lookup, the giving summary, log a call or meeting, record a gift and today's tasks within two taps.

*Acceptance:* The browser journey asserts no horizontal scroll at 390 pixels on every screen, and a phone journey looks up a donor, logs a call and records a gift within two taps each.

*Status:* partial. Every current screen fits 390 pixels with no horizontal scroll; no phone-first views, call logging or task list. Evidence: `tests/browser-journey.mjs`.

#### MOBILE-002 — Native iOS and Android apps.

Native apps keep the signed-in staff member's portfolio and today's tasks available offline, sync logged calls and notes when back online, and push notifications for new major gifts, assigned tasks and replies.

*Acceptance:* A native test on iOS and Android simulators logs a call offline, reconnects and sees it on the web timeline, and receives a push notification for an assigned task.

*Status:* missing. No native apps.

#### MOBILE-003 — In-person giving.

At events, staff take card gifts on a phone with Stripe Terminal Tap to Pay on iPhone and Android, and the gift, donor and receipt are recorded as for an online gift.

*Acceptance:* A native test with Stripe Terminal's simulated reader takes a $100 gift and reads the gift, donor and emailed receipt in Coffer.

*Status:* missing. No in-person payments.

### Data and ownership

The nonprofit owns the system and every record in it.

#### DATA-002 — Exports by record type.

Constituents, gifts, pledges, plans, consent, interactions, tasks and opportunities export as CSV for any list or report, alongside the full open archive of `DATA-001`.

*Acceptance:* An HTTP journey exports each record type for a saved list and checks counts and totals against the API.

*Status:* partial. The owner downloads the full NDJSON archive, and letters and audiences export as CSV; no per-type or per-list CSV exports. Evidence: `src/coffer/http.ts`, `src/coffer/acknowledgements.ts`, `tests/coffer.test.mjs`.

#### DATA-003 — A donor's own data on request.

On a donor's request staff produce a file of everything held about them (record, gifts, consent, interactions, documents) and log the request, alongside erasure in `DATA-001`.

*Acceptance:* An HTTP journey produces one donor's file, checks it holds every record type for them and nobody else, and reads the logged request.

*Status:* missing. No per-donor access export.

#### OWN-001 — Free, open source and owned.

Coffer is MIT licensed and runs in the nonprofit's own Cloudflare account on its own D1 database: no platform fee, no per-record or per-user pricing and no donor tip prompt on forms. The nonprofit pays only its processor and infrastructure costs, and nothing is locked in.

*Acceptance:* The repository carries the MIT licence, deploys to the owner's account with the documented commands, and the donation form journey (`GIVE-001`) shows no tip prompt.

*Status:* done. Evidence: `LICENSE`, `wrangler.jsonc`, `README.md`.

#### OWN-002 — Runs on the nonprofit's own computer.

One command starts Coffer locally with its own database for evaluation or a small office, signed in as the owner.

*Acceptance:* The nightly fresh-clone journey starts Coffer with `rer dev` from a new clone and completes the first-week browser journey.

*Status:* done. Evidence: `RUN-LOCALLY.md`, `tests/clone-journey.mjs`.

## Push further

Up-and-comers write appeal copy and suggest ask amounts. Coffer's development agent does the follow-through a small team never has time for, on the nonprofit's own records, under rules that hold for every clause here: it works only within a named grant (`DEV-012`); it cites the records behind every claim and never invents wealth, intent or impact; money, ledger corrections, merges and sensitive outreach wait for the named human role; consent, frequency limits and stop requests always win; and an approved step is not complete until the agent has checked that it happened.

### Development agent

#### DEV-001 — Reconciles every gift.

The agent compares, every night, each gift in the ledger with its processor event, its payout, its bank deposit as posted to QuickBooks Online or Pantry, and its fund allocation; it explains each difference in plain words (pending ACH, refund after payout, check batch not posted, fee missing) and prepares the correcting entry. The finance lead approves any correction; the agent never edits the ledger, moves money or invents a deposit, and every proposal cites the raw events.

*Acceptance:* An HTTP journey with processor and accounting edges faked seeds four kinds of mismatch, runs the agent, and reads four explained exceptions with source citations and prepared corrections that apply only after a finance-role approval.

*Status:* missing. No reconciliation agent; agent keys only prepare letters and audiences.

#### DEV-002 — Rescues failed monthly gifts.

For each failed or expiring recurring plan the agent reads plan history, consent and past messages, prepares the right notice on the donor's permitted channel, follows up on a schedule until the donor updates their payment method, the plan resumes or a person closes it, and records which step recovered it. Notices to major donors and any revised amount wait for the development lead's approval; frequency limits and stop requests always hold.

*Acceptance:* An HTTP journey with the Stripe edge faked fails three plans (one major donor), runs the agent, sends two notices automatically under a standing approval, holds the major donor's for approval, recovers one plan and reports the outcome per plan.

*Status:* missing. No recurring plans or recovery agent.

#### DEV-003 — Sends missing receipts.

The agent finds gifts without a receipt or acknowledgement past target, receipts that bounced and year-end statements not yet delivered, prepares the batch in the approved template, and sends standard receipts under the admin's standing approval of that template version; anything unusual (goods value unknown, address missing, a large gift) waits for a person.

*Acceptance:* An HTTP journey seeds overdue and bounced receipts, runs the agent, sees standard ones sent under the standing approval and the unusual ones queued for a person with reasons.

*Status:* partial. An agent key can prepare due acknowledgement letters for a person to approve; it cannot find bounced or missing receipts, and nothing is sent. Evidence: `src/coffer/commands.ts`, `src/coffer/acknowledgements.ts`, `tests/coffer.test.mjs`.

#### DEV-004 — Drafts stewardship from the nonprofit's own history.

For each donor due a touch the agent drafts the thank-you call notes, personal email or handwritten-card text from that donor's actual gifts, interactions, event attendance and replies, citing each fact, and schedules it as a task for the relationship manager. It never invents wealth, intent, family facts or impact claims; the fundraiser edits and approves every message, and confidential notes stay within their role.

*Acceptance:* An HTTP journey with the model edge faked drafts touches for three donors; every claim in each draft links to a record, a draft citing a non-existent fact is rejected by the check, and nothing is sent until a fundraiser approves.

*Status:* missing. No interaction history or drafting agent.

#### DEV-005 — Shows who needs a human call next.

Each week the agent ranks, per relationship manager, the donors most worth a call (lapse risk, upgrade signals, anniversaries, unanswered replies, overdue pledges) with the reason for each, creates call tasks within each manager's capacity, and measures donor by donor whether calls were made and whether retention moved.

*Acceptance:* An HTTP journey builds a history with lapsing, upgrading and silent donors, runs the agent, reads ranked call tasks with reasons per manager, completes some, and reads the follow-through and retention measurement a period later.

*Status:* missing. No call list, scores or retention measurement.

#### DEV-006 — Briefs before a meeting.

Before a scheduled donor meeting the agent prepares a one-page brief: giving summary, recent interactions, open opportunities and pledges, relationships, and questions left open last time, each line linked to its source. It does not speculate about capacity beyond stored prospect research the reader may see.

*Acceptance:* An HTTP journey schedules a meeting, receives the brief a day ahead, and checks every line against its linked record and that a data-entry user's brief omits research.

*Status:* missing. No meetings or briefs.

#### DEV-007 — Proves the move-in and the cutover.

During a migration the agent compares source and Coffer totals, finds duplicates, missing acknowledgements and consent gaps, lists recurring plans that need donor reauthorization and drafts that campaign, and tracks each plan until the donor has re-authorized; it never cancels a source plan. The owner approves merges, the reauthorization message and the cutover.

*Acceptance:* An HTTP journey imports a fixture with gaps and a non-adoptable plan, runs the agent, reads the exception list and drafted campaign, re-authorizes the plan and records the owner's cutover.

*Status:* partial. The Stripe move-in previews totals and skips for a person to approve; no comparison agent, recurring reauthorization or cutover. Evidence: `src/coffer/imports/service.ts`, `tests/coffer.test.mjs`.

#### DEV-008 — Keeps the database clean.

The agent proposes duplicate merges, address updates from NCOA and returned mail, deceased flags from returned mail and family notes, and missing salutations, each with its evidence; a person accepts or rejects in a queue, and accepted changes go through the normal audited commands.

*Acceptance:* An HTTP journey seeds duplicates, a returned letter and a missing salutation, runs the agent, and reads proposals that change nothing until accepted and then appear in the audit log.

*Status:* missing. No data hygiene agent.

#### DEV-009 — Confirms appeals actually reached donors.

After an approved appeal or journey step the agent checks the sender's results against the frozen audience, flags recipients not sent or bounced, and reconciles responses to gifts; an approved send is not complete until it has.

*Acceptance:* An HTTP journey with the Mailchimp edge faked sends an appeal where five recipients were dropped, runs the agent, and reads the five flagged with a prepared resend for approval.

*Status:* missing. No sender connection.

#### DEV-010 — Follows pledges and grants to the end.

The agent watches pledge installments, grant reports and matching-gift submissions, sends approved reminders, escalates to the relationship manager when replies stop, and records the resolution (paid, revised with approval, written off with a reason).

*Acceptance:* An HTTP journey lets a pledge installment, a grant report and a match go overdue, runs the agent, and reads reminders, an escalation and a recorded resolution for each.

*Status:* missing. No installments, grants or matching gifts to follow.

#### DEV-011 — Writes the development report.

Monthly, the agent drafts a board-ready report (raised against goal, retention, recurring health, pipeline, notable gifts, overdue follow-up) in which every number links to the report it came from; the director edits and approves before it is sent.

*Acceptance:* An HTTP journey runs the agent on a built month, checks every number against `REPORT-*` outputs, and sends only after approval.

*Status:* missing. No reports for the agent to draw on.

#### DEV-012 — Agent grants and autonomy.

Each agent has a named grant: which records it may read, which commands it may prepare, and which it may run under a standing approval (for example, sending standard receipts in an approved template version), with daily limits and a kill switch. Every agent action is audited with the grant that allowed it, and a person can revoke or narrow a grant at once.

*Acceptance:* An HTTP journey grants an agent receipt sending under a template version, sees it send within limits, refuses a send over the daily limit and a send after the template changes, and stops it with the kill switch.

*Status:* partial. Expiring, revocable agent keys can only read and prepare; no named grants, standing approvals, limits or kill switch. Evidence: `src/coffer/auth.ts`, `src/coffer/commands.ts`, `tests/coffer.test.mjs`.

## Honest boundaries

Coffer does not do these itself; buyers get them as follows, US-first.

| Coffer does not | How buyers get it |
| --- | --- |
| Card and bank credentials, ACH rails and holding charitable funds | Stripe and PayPal collect, verify and pay out; Coffer keeps provider references and settlement records only (`GIVE-004`, `PAY-001`). |
| The general ledger, audits and tax advice | Pantry or QuickBooks Online keep the books (`FIN-001`, `FIN-002`); receipt rules follow IRS Publication 1771 as templates the nonprofit reviews, and its CPA prepares Form 990 from `REPORT-007` data. |
| Bulk email infrastructure | Mango, Mailchimp or Constant Contact send appeals at volume (`COMM-002`, `COMM-003`); Coffer sends transactional receipts and personal email through the installation's mail provider. |
| Printing and postage | A mail house or Lob prints and mails (`RCPT-003`, `COMM-007`); Coffer produces the files and records the events. |
| Postal address data | Smarty and an NCOA licensee supply verification and change-of-address data (`DONOR-009`). |
| Wealth data | DonorSearch or WealthEngine supply screening (`MAJOR-005`); Coffer never infers wealth. |
| Donor-advised funds, brokerage, appraisals, vehicle donations and planned-giving instruments | DAF sponsors, brokers, qualified appraisers, vehicle-donation partners (Form 1098-C) and attorneys handle the regulated transfer or document; Coffer records the gift and the stewardship (`GIFT-009`, `GIFT-010`, `MAJOR-007`). |
| Volunteer shift scheduling and online auctions | VolunteerHub or Galaxy Digital schedule volunteers and an auction platform runs bidding; Coffer imports hours (`DONOR-010`) and auction proceeds as gifts with their fair market value. |
| Charitable solicitation registration | A compliance service such as Harbor Compliance files state registrations; Coffer reports what was raised by state. |
| Merchandise and sales tax | Stall sells merchandise with its sales tax; Coffer records only the contribution part of any purchase. |
| Generic sales CRM, email marketing, website, forms and surveys, e-signature and team chat | Orbit, Mango, Pane, Pencil, Inkwell and Nook (or HubSpot, Mailchimp, Squarespace, Typeform, Docusign and Slack) stay separate products that Coffer connects to. |
| Receipts outside the US | Canadian, UK and other receipting rules are not offered in the US-first edition. |

## Scope mapping

Each item the owner-approved scope (16 October 2026) names, and the clauses that cover it.

| Scope item | Clauses |
| --- | --- |
| Online donation forms and campaign pages with recurring gifts, card/ACH/wallet checkout via Stripe and a donor self-service portal | `GIVE-001`, `GIVE-002`, `GIVE-003`, `GIVE-004`, `GIVE-005`, `GIVE-006`, `GIVE-007` |
| Live Stripe sync of gifts, payouts, fees, refunds and failed recurring payments, with QuickBooks Online/Pantry deposit reconciliation by fund | `PAY-001`, `PAY-002`, `PAY-003`, `PAY-004`, `GIVE-006`, `FIN-001`, `FIN-002`, `FIN-003`, `FIN-005` |
| Acknowledgements and year-end tax receipts delivered by email (and print-ready mail merge) with IRS goods-and-services language and delivery tracking | `ACK-001`, `RCPT-001`, `RCPT-002`, `RCPT-003`, `RCPT-004`, `RCPT-005`, `RCPT-006`, `RCPT-008` |
| Appeals and automated stewardship journeys sent through Mango or Mailchimp, with unsubscribe and reply handling | `APPEAL-001`, `COMM-001`, `COMM-002`, `COMM-005`, `STEW-003` |
| Moves management: major-gift pipeline, tasks, soft credits, tribute and matching gifts, and donor engagement/retention scores | `MAJOR-001`, `MAJOR-002`, `MAJOR-003`, `MAJOR-004`, `STEW-001`, `GIFT-006`, `GIFT-007`, `GIFT-008`, `REPORT-001` |
| Migration from Little Green Light, Bloomerang and Raiser's Edge with full gift history | `MOVE-001`, `MOVE-002`, `MOVE-003`, `MOVE-004`, `MOVE-007`, `MOVE-008` |
| Push further: a development agent that reconciles every gift, catches failed recurring donations and unsent receipts, drafts and schedules stewardship touches from the nonprofit's own interaction history, and measures retention by donor | `DEV-001`, `DEV-002`, `DEV-003`, `DEV-004`, `DEV-005`, `DEV-012` |

## Homepage claims

Every capability claim on the run site's homepage (the desk's owner-accepted copy, `src/site/landing/`) and the clauses that deliver it. A claim's status is its clauses' statuses.

| # | Claim | Clauses | Status |
| ---: | --- | --- | --- |
| 1 | Coffer takes donations | `GIVE-001`, `GIVE-003`, `GIVE-004` | missing |
| 2 | keeps every donor's story | `DONOR-001`, `DONOR-004` | `DONOR-001` done · `DONOR-004` partial |
| 3 | sends the receipts | `ACK-001`, `RCPT-001`, `RCPT-002` | `ACK-001` done · `RCPT-001` missing · `RCPT-002` partial |
| 4 | and thank-yous | `RCPT-002`, `RCPT-007` | partial |
| 5 | shows who needs a call | `DEV-005`, `REPORT-002` | missing |
| 6 | 100% free, open source alternative to Bloomerang, Little Green Light and Neon CRM | `OWN-001`, `MOVE-001`, `MOVE-002`, `MOVE-004` | `OWN-001` done · `MOVE-001` missing · `MOVE-002` missing · `MOVE-004` missing |
| 7 | Spring appeal $48,210 of $60,000, gifts and recurring donors | `CAMP-001`, `REPORT-003` | `CAMP-001` missing · `REPORT-003` partial |
| 8 | Monthly $25 · Active | `GIVE-003` | missing |
| 9 | Failed card · Retried successfully | `GIVE-006` | missing |
| 10 | Receipt sent · Gift $250.00 · No goods or services provided | `RCPT-001`, `RCPT-005` | `RCPT-001` missing · `RCPT-005` partial |
| 11 | Call Tom Okafor · lapsed 14 months | `DEV-005`, `STEW-001` | missing |
| 12 | Donation forms and campaign pages | `GIVE-001`, `GIVE-002` | missing |
| 13 | monthly giving | `GIVE-003` | missing |
| 14 | card, bank and Apple Pay checkout | `GIVE-004` | missing |
| 15 | a portal where donors update their own card | `GIVE-005` | missing |
| 16 | Households | `DONOR-001` | done |
| 17 | relationships | `DONOR-003` | partial |
| 18 | every gift | `GIFT-001` | done |
| 19 | every conversation in one place | `DONOR-004`, `COMM-004`, `COMM-005` | `DONOR-004` partial · `COMM-004` missing · `COMM-005` missing |
| 20 | soft credits | `GIFT-006` | missing |
| 21 | tributes | `GIFT-008` | missing |
| 22 | employer matches | `GIFT-007` | missing |
| 23 | Lifetime giving and first gift | `DONOR-011` | partial |
| 24 | Gifts sync from Stripe as they happen | `PAY-001` | partial |
| 25 | fees, refunds | `PAY-003`, `PAY-004` | `PAY-003` partial · `PAY-004` missing |
| 26 | failed monthly payments | `GIVE-006` | missing |
| 27 | each payout matches its deposit in QuickBooks Online or Pantry | `PAY-002`, `FIN-001`, `FIN-002` | missing |
| 28 | split by fund | `GIFT-004`, `FIN-003` | `GIFT-004` missing · `FIN-003` partial |
| 29 | Thank-you letters | `ACK-001`, `RCPT-002` | `ACK-001` done · `RCPT-002` partial |
| 30 | year-end tax receipts | `RCPT-004` | missing |
| 31 | by email | `RCPT-001`, `RCPT-002` | `RCPT-001` missing · `RCPT-002` partial |
| 32 | print-ready for mail | `RCPT-003` | partial |
| 33 | with the right IRS language | `ACK-001`, `RCPT-005` | `ACK-001` done · `RCPT-005` partial |
| 34 | proof of delivery | `RCPT-006` | partial |
| 35 | Thank-yous sent · 48 donors tonight | `RCPT-002` | partial |
| 36 | Appeals and welcome journeys go out through Mango or Mailchimp | `COMM-002`, `STEW-003` | `COMM-002` partial · `STEW-003` missing |
| 37 | welcome journeys | `STEW-003` | missing |
| 38 | Unsubscribes are honored everywhere | `CONSENT-001`, `APPEAL-001`, `COMM-001` | `CONSENT-001` done · `APPEAL-001` done · `COMM-001` partial |
| 39 | replies land with the right person | `COMM-005` | missing |
| 40 | major-gift pipeline with next steps, owners and engagement scores | `MAJOR-001`, `MAJOR-002`, `MAJOR-004` | missing |
| 41 | reconciles every gift | `DEV-001` | missing |
| 42 | rescues failed monthly gifts | `DEV-002` | missing |
| 43 | sends missing receipts | `DEV-003` | partial |
| 44 | drafts stewardship from your own history | `DEV-004` | missing |
| 45 | tracks retention donor by donor | `DEV-005`, `REPORT-001` | `DEV-005` missing · `REPORT-001` partial |
| 46 | Move from Little Green Light | `MOVE-001` | missing |
| 47 | Bloomerang | `MOVE-002` | missing |
| 48 | Raiser's Edge NXT | `MOVE-003` | missing |
| 49 | with every donor, household and gift | `MOVE-001`, `MOVE-002`, `MOVE-003`, `IMPORT-001` | `MOVE-001` missing · `MOVE-002` missing · `MOVE-003` missing · `IMPORT-001` done |
| 50 | check the totals before you switch | `IMPORT-001`, `MOVE-007` | `IMPORT-001` done · `MOVE-007` partial |
| 51 | Run Coffer on your own computer | `OWN-002` | done |
| 52 | keep every donor record / Your donors, your database | `OWN-001`, `DATA-001` | done |
| 53 | Export everything, any time | `DATA-001`, `DATA-002` | `DATA-001` done · `DATA-002` partial |
| 54 | Soft credits | `GIFT-006` | missing |
| 55 | Tribute gifts | `GIFT-008` | missing |
| 56 | Matching gifts | `GIFT-007` | missing |
| 57 | Pledges: schedules, reminders and balances kept current | `GIFT-005`, `STEW-004` | `GIFT-005` partial · `STEW-004` missing |
| 58 | Consent: email and mail preferences honored everywhere | `CONSENT-001`, `APPEAL-001` | done |
| 59 | Gift ledger: every change recorded; no gift is silently edited | `GIFT-001` | done |
| 60 | Open source donor management for every nonprofit | `OWN-001` | done |
| 61 | Free and open source, MIT licensed | `OWN-001` | done |

## Status

Judged from the code and tests at commit `b7437e87b8f6bea2f8e1e425202a3e69a7629543` (17 October 2026).

| Clauses | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Published | 9 | 0 | 0 | 9 |
| Target and push further | 2 | 31 | 78 | 111 |
| All | 11 | 31 | 78 | 120 |

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `HTTP-001` | Private app boundary | published | done | `tests/coffer.test.mjs`, `src/coffer/auth.ts` |  |
| `DONOR-001` | Donors and households | published | done | `src/coffer/donors.ts`, `tests/coffer.test.mjs`, `tests/browser-journey.mjs` |  |
| `GIFT-001` | Immutable ledger | published | done | `src/coffer/gifts.ts`, `migrations/core/0016_coffer.sql`, `tests/coffer.test.mjs` |  |
| `CONSENT-001` | Consent history | published | done | `src/coffer/donors.ts`, `tests/coffer.test.mjs` |  |
| `ACK-001` | Acknowledgement letters | published | done | `src/coffer/acknowledgements.ts`, `src/coffer/settings.ts`, `tests/coffer.test.mjs` |  |
| `APPEAL-001` | Consent-checked appeals | published | done | `src/coffer/appeals.ts`, `tests/coffer.test.mjs` |  |
| `AGENT-001` | Prepare, then a person decides | published | done | `src/coffer/commands.ts`, `src/coffer/auth.ts`, `tests/coffer.test.mjs` |  |
| `IMPORT-001` | Reviewed Stripe move-in | published | done | `src/coffer/imports/service.ts`, `src/coffer/imports/snapshots.ts`, `tests/coffer.test.mjs` |  |
| `DATA-001` | Custody and erasure | published | done | `src/coffer/archive-policy.mjs`, `src/coffer/imports/erasure.ts`, `tests/coffer.test.mjs` |  |
| `DONOR-002` | Organization records | target | partial | `src/coffer/donors.ts` | Every constituent is a person-shaped donor record; there is no organization type, EIN, website or contact role. |
| `DONOR-003` | Relationships | target | partial | `src/coffer/donors.ts` | Only household membership by name exists; no reciprocal relationship types, salutations or household totals. |
| `DONOR-004` | Interaction timeline | target | partial | `src/coffer/donors.ts`, `src/coffer/ui/donors.ts` | The donor page shows gifts, consent, letters, appeals and the change history; there are no logged calls, meetings, notes or a filterable timeline. |
| `DONOR-005` | Custom fields and tags | target | missing |  | No custom fields, tags or categories. |
| `DONOR-006` | Duplicate detection and merge | target | partial | `src/coffer/imports/snapshots.ts`, `tests/coffer.test.mjs` | Duplicate emails are refused and same-email Stripe imports attach to the existing donor; there is no duplicate queue, comparison or merge. |
| `DONOR-007` | Saved searches and lists | target | partial | `src/coffer/donors.ts`, `src/coffer/appeals.ts` | Search covers name, email and household, and appeal segments filter on giving since a date; there are no general filters or saved lists. |
| `DONOR-008` | Documents on records | target | missing |  | No attachments. |
| `DONOR-009` | Address verification and NCOA | target | missing |  | No address verification or NCOA. |
| `DONOR-010` | Volunteer history | target | missing |  | No volunteer records. |
| `DONOR-011` | Giving summary | target | partial | `src/coffer/donors.ts`, `tests/coffer.test.mjs` | Lifetime and calendar-year totals exist; first, largest and last gift, consecutive years, recurring status, soft credits and fiscal years do not. |
| `GIFT-002` | Batch gift entry and deposits | target | missing |  | Gifts are entered one at a time; no batches or deposit totals. |
| `GIFT-003` | Campaign, appeal, fund and channel attribution | target | partial | `src/coffer/gifts.ts` | Each gift has one free-text fund; no campaigns, appeals or source as structured references. |
| `GIFT-004` | Split gifts | target | missing |  | No split gifts. |
| `GIFT-005` | Pledges, installments and balances | target | partial | `src/coffer/donors.ts`, `src/coffer/gifts.ts` | A pledge has an amount, an optional due date and linked gifts with a remaining balance; no installment schedule, overdue state or write-off, and no test exercises pledges. |
| `GIFT-006` | Soft credits | target | missing |  | No soft credits. |
| `GIFT-007` | Matching gifts | target | missing |  | No matching-gift tracking or Double the Donation connection. |
| `GIFT-008` | Tribute gifts | target | missing |  | No tribute records; a gift note can only mention one. |
| `GIFT-009` | In-kind gifts | target | missing |  | Gifts are monetary only. |
| `GIFT-010` | Stock, DAF grants and IRA distributions | target | missing |  | No stock, DAF or QCD gift types. |
| `GIVE-001` | Donation forms | target | missing |  | No donation forms; Coffer takes no payments. |
| `GIVE-002` | Campaign pages | target | missing |  | No campaign pages. |
| `GIVE-003` | Recurring giving | target | missing |  | No recurring plans. |
| `GIVE-004` | Card, bank, wallet and PayPal checkout | target | missing |  | No checkout. |
| `GIVE-005` | Donor portal | target | missing |  | No donor-facing portal. |
| `GIVE-006` | Failed recurring payments | target | missing |  | No recurring payments, retries, notices or expiry warnings. |
| `GIVE-007` | Fraud and card-testing protection | target | missing |  | No forms to protect. |
| `GIVE-008` | Text-to-give | target | missing |  | No text-to-give. |
| `CAMP-001` | Campaigns with goals | target | missing |  | No campaigns or goals. |
| `CAMP-002` | Fundraising events | target | missing |  | No events. |
| `CAMP-003` | Peer-to-peer fundraising | target | missing |  | No peer-to-peer pages. |
| `CAMP-004` | Memberships | target | missing |  | No memberships. |
| `PAY-001` | Live Stripe connection | target | partial | `src/coffer/imports/snapshots.ts`, `src/coffer/imports/service.ts` | Only saved Stripe customer and charge pages can be moved in; there is no connection, webhook, backfill or sweep. |
| `PAY-002` | Payouts with their gifts | target | missing |  | No payouts. |
| `PAY-003` | Refunds and disputes | target | partial | `src/coffer/gifts.ts`, `src/coffer/imports/snapshots.ts` | Reversal lines exist, and move-in nets partial refunds and skips full refunds; no live refunds, disputes or receipt corrections. |
| `PAY-004` | Processing fees and fee cover | target | missing |  | No fees recorded. |
| `PAY-005` | Other giving platforms | target | missing |  | No other platform connections. |
| `FIN-001` | QuickBooks Online sync | target | missing |  | No accounting connection. |
| `FIN-002` | Pantry sync | target | missing |  | No Pantry connection. |
| `FIN-003` | Restricted funds | target | partial | `src/coffer/gifts.ts` | Every gift has a free-text fund (default Unrestricted); no restriction type, mapping or release report. |
| `FIN-004` | Journal export for other ledgers | target | missing |  | No journal export. |
| `FIN-005` | Reconciliation report | target | missing |  | No reconciliation report. |
| `RCPT-001` | Immediate email receipts | target | missing |  | Coffer sends no donor email. |
| `RCPT-002` | Acknowledgements delivered by email | target | partial | `src/coffer/acknowledgements.ts`, `tests/coffer.test.mjs` | Letters are prepared, approved and exported as CSV, and a person records a sent date; Coffer does not send them. |
| `RCPT-003` | Print-ready letters, labels and envelopes | target | partial | `src/coffer/acknowledgements.ts` | A CSV with letter text and postal fields exists for a mail merge; no PDF, labels, envelopes or Lob. |
| `RCPT-004` | Year-end giving statements | target | missing |  | No year-end statements. |
| `RCPT-005` | US receipt rules | target | partial | `src/coffer/settings.ts`, `src/coffer/acknowledgements.ts`, `tests/coffer.test.mjs` | Templates must carry donor, amount, date, organization and the goods-or-services statement, and the $250 threshold works; no quid pro quo rule for payments over $75, token-benefit or religious-benefit wording. |
| `RCPT-006` | Delivery tracking | target | partial | `src/coffer/acknowledgements.ts` | A person records a sent date and method per batch; no provider delivery, bounce or open results. |
| `RCPT-007` | Thank-you templates | target | partial | `src/coffer/settings.ts`, `tests/coffer.test.mjs` | One reviewed letter template with required facts exists; no templates per form, campaign or gift type. |
| `RCPT-008` | Corrected and voided receipts | target | missing |  | No receipt numbering, voiding or reissue. |
| `COMM-001` | Preferences and unsubscribes everywhere | target | partial | `src/coffer/donors.ts`, `src/coffer/appeals.ts`, `tests/coffer.test.mjs` | Append-only email and postal consent gates appeals; no SMS or phone channel, topics, unsubscribe links or provider sync. |
| `COMM-002` | Appeals sent through Mango or Mailchimp | target | partial | `src/coffer/appeals.ts`, `tests/coffer.test.mjs` | An approved audience exports as CSV for any sender; no sender connection, sending, results or attribution. |
| `COMM-003` | Constant Contact | target | missing |  | No Constant Contact connection. |
| `COMM-004` | One-to-one email and mailbox logging | target | missing |  | No mailbox connection or personal email. |
| `COMM-005` | Replies reach the right person | target | missing |  | No inbound mail. |
| `COMM-006` | SMS outreach | target | missing |  | No SMS. |
| `COMM-007` | Direct mail appeals | target | partial | `src/coffer/appeals.ts`, `tests/coffer.test.mjs` | Mail-channel audiences with postal addresses export as CSV; no ask amounts, response codes or mailing history. |
| `COMM-008` | Appeal results | target | missing |  | No appeal results. |
| `STEW-001` | Tasks with owners and reminders | target | missing |  | No tasks. |
| `STEW-002` | Recurring tasks | target | missing |  | No tasks. |
| `STEW-003` | Stewardship journeys | target | missing |  | No journeys. |
| `STEW-004` | Pledge reminders and invoices | target | missing |  | No pledge reminders. |
| `STEW-005` | Gift-triggered rules | target | missing |  | No rules. |
| `STEW-006` | Meetings and calendars | target | missing |  | No calendar connection. |
| `MAJOR-001` | Opportunity pipeline | target | missing |  | No opportunities or pipeline. |
| `MAJOR-002` | Portfolios and moves | target | missing |  | No portfolios. |
| `MAJOR-003` | Action plans and proposals | target | missing |  | No plans or proposals. |
| `MAJOR-004` | Engagement and retention scores | target | missing |  | No scores. |
| `MAJOR-005` | Prospect research | target | missing |  | No prospect research. |
| `MAJOR-006` | Grants from foundations and corporations | target | missing |  | No grant tracking. |
| `MAJOR-007` | Planned giving | target | missing |  | No planned-giving records. |
| `REPORT-001` | Donor retention | target | partial | `src/coffer/donors.ts`, `tests/coffer.test.mjs` | Per-donor lifetime and yearly totals exist; no organization-wide retention, cohorts or lapse. |
| `REPORT-002` | LYBUNT and SYBUNT lists | target | missing |  | No lapse lists. |
| `REPORT-003` | Fundraising dashboards | target | partial | `src/coffer/ui/home.ts` | Today shows the current calendar year's total and acknowledgement backlog; no breakdowns, goals, comparisons or drill-down. |
| `REPORT-004` | Report builder | target | missing |  | No report builder. |
| `REPORT-005` | Scheduled reports | target | missing |  | No scheduled reports. |
| `REPORT-006` | Recurring giving health | target | missing |  | No recurring plans to report. |
| `REPORT-007` | IRS Form 990 support | target | missing |  | No Form 990 reports. |
| `MOVE-001` | From Little Green Light | target | missing |  | Only the Stripe importer exists. |
| `MOVE-002` | From Bloomerang | target | missing |  | No Bloomerang importer. |
| `MOVE-003` | From Raiser's Edge NXT | target | missing |  | No Raiser's Edge NXT importer. |
| `MOVE-004` | From Neon CRM | target | missing |  | No Neon CRM importer. |
| `MOVE-005` | From Givebutter and Zeffy | target | missing |  | No Givebutter or Zeffy importer. |
| `MOVE-006` | Any spreadsheet | target | missing |  | No general importer. |
| `MOVE-007` | Totals checked before the switch | target | partial | `src/coffer/imports/service.ts`, `src/coffer/ui/move-in.ts`, `tests/coffer.test.mjs` | The Stripe move-in preview shows donors, gifts, totals and every skip before apply; no per-year and fund reconciliation, recurring adoption or cutover sign-off. |
| `MOVE-008` | Consent and preferences moved with provenance | target | missing |  | No importer carries consent. |
| `TEAM-001` | Roles and record-level access | target | partial | `src/coffer/commands.ts`, `src/coffer/auth.ts`, `tests/coffer.test.mjs` | Owner, admin, member and agent roles guard every command; no fundraiser, finance, volunteer or read-only roles, portfolio scoping or confidential fields. |
| `TEAM-002` | Single sign-on and two-step sign-in | target | partial | `src/modules/operator-auth/identity/oidc` | Base sign-in supports an OIDC provider; requiring SSO and a second factor are not offered in Coffer. |
| `TEAM-003` | Audit log | target | partial | `src/coffer/db.ts`, `src/coffer/ui/donors.ts` | Every command writes an event shown per donor and per batch; no organization-wide log, filters or export. |
| `API-001` | Public REST API | target | partial | `src/coffer/http.ts`, `src/coffer/commands.ts`, `tests/coffer.test.mjs` | Authenticated donor reads and a command API exist; no versioned public API, OpenAPI document, scoped keys or idempotency keys. |
| `API-002` | Webhooks | target | missing |  | No webhooks. |
| `API-003` | Zapier and Crank | target | missing |  | No Zapier app or Crank connector. |
| `API-004` | MCP endpoint | target | missing |  | No MCP endpoint. |
| `MOBILE-001` | Phone-ready web app | target | partial | `tests/browser-journey.mjs` | Every current screen fits 390 pixels with no horizontal scroll; no phone-first views, call logging or task list. |
| `MOBILE-002` | Native iOS and Android apps | target | missing |  | No native apps. |
| `MOBILE-003` | In-person giving | target | missing |  | No in-person payments. |
| `DATA-002` | Exports by record type | target | partial | `src/coffer/http.ts`, `src/coffer/acknowledgements.ts`, `tests/coffer.test.mjs` | The owner downloads the full NDJSON archive, and letters and audiences export as CSV; no per-type or per-list CSV exports. |
| `DATA-003` | A donor's own data on request | target | missing |  | No per-donor access export. |
| `OWN-001` | Free, open source and owned | target | done | `LICENSE`, `wrangler.jsonc`, `README.md` |  |
| `OWN-002` | Runs on the nonprofit's own computer | target | done | `RUN-LOCALLY.md`, `tests/clone-journey.mjs` |  |
| `DEV-001` | Reconciles every gift | push-further | missing |  | No reconciliation agent; agent keys only prepare letters and audiences. |
| `DEV-002` | Rescues failed monthly gifts | push-further | missing |  | No recurring plans or recovery agent. |
| `DEV-003` | Sends missing receipts | push-further | partial | `src/coffer/commands.ts`, `src/coffer/acknowledgements.ts`, `tests/coffer.test.mjs` | An agent key can prepare due acknowledgement letters for a person to approve; it cannot find bounced or missing receipts, and nothing is sent. |
| `DEV-004` | Drafts stewardship from the nonprofit's own history | push-further | missing |  | No interaction history or drafting agent. |
| `DEV-005` | Shows who needs a human call next | push-further | missing |  | No call list, scores or retention measurement. |
| `DEV-006` | Briefs before a meeting | push-further | missing |  | No meetings or briefs. |
| `DEV-007` | Proves the move-in and the cutover | push-further | partial | `src/coffer/imports/service.ts`, `tests/coffer.test.mjs` | The Stripe move-in previews totals and skips for a person to approve; no comparison agent, recurring reauthorization or cutover. |
| `DEV-008` | Keeps the database clean | push-further | missing |  | No data hygiene agent. |
| `DEV-009` | Confirms appeals actually reached donors | push-further | missing |  | No sender connection. |
| `DEV-010` | Follows pledges and grants to the end | push-further | missing |  | No installments, grants or matching gifts to follow. |
| `DEV-011` | Writes the development report | push-further | missing |  | No reports for the agent to draw on. |
| `DEV-012` | Agent grants and autonomy | push-further | partial | `src/coffer/auth.ts`, `src/coffer/commands.ts`, `tests/coffer.test.mjs` | Expiring, revocable agent keys can only read and prepare; no named grants, standing approvals, limits or kill switch. |

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

- **Know every supporter.** People and organizations with name parts, salutations and envelope names, several emails, phones and addresses each, households and relationships, a timeline of every touch, custom fields on records, gifts and interactions, duplicates merged, saved lists with bulk actions, documents, verified addresses, volunteer history, an active, inactive or deceased status every send honours, and a do-not-solicit restriction every ask honours while receipts and statements still go (`DONOR-001` to `DONOR-015`).
- **Record every gift exactly.** An immutable ledger with batch entry, attribution, splits, pledges with installments, soft credits, matching, tribute, in-kind, stock, DAF and IRA gifts, and anonymous gifts with recognition names (`GIFT-001` to `GIFT-011`).
- **Take gifts online and by phone.** Forms, campaign pages, recurring giving, card, ACH, wallets, PayPal and Venmo, staff-entered card and bank payments, a donor portal, failed-payment recovery, fraud protection and text-to-give; campaigns, events with auction results, peer-to-peer pages and memberships (`GIVE-*`, `CAMP-*`).
- **Reconcile with the books.** Live Stripe, other giving platforms and shop orders with payouts, fees, refunds and disputes, posted by fund to QuickBooks Online or Pantry and reconciled to the cent (`PAY-*`, `FIN-*`).
- **Thank and receipt.** Immediate email receipts, delivered acknowledgements, print-ready letters, year-end statements, one piece per household, an acknowledgement status on every gift and soft credit that imports carry and staff can set by hand, every template merging names, salutations and custom fields, US receipt rules and delivery tracking (`ACK-001`, `RCPT-*`).
- **Reach donors and hear back.** Consent on every channel, no ask to a donor marked do not solicit, appeals sent through Mango or Mailchimp, one-to-one email, replies routed to the right person, SMS and direct mail, with results (`CONSENT-001`, `APPEAL-001`, `COMM-*`).
- **Follow up.** Tasks, recurring tasks, stewardship journeys, pledge reminders, gift-triggered rules and meetings (`STEW-*`), and the major-gift pipeline with portfolios, plans, scores, research, grants and planned giving (`MAJOR-*`).
- **Report.** Retention, LYBUNT and SYBUNT, dashboards, a report builder, scheduled reports, recurring health, Form 990 support and giving by state (`REPORT-*`).
- **Move in and own it.** Importers from Little Green Light, Bloomerang, Raiser's Edge NXT, Neon CRM, Givebutter, Zeffy and any spreadsheet, custom fields and name fields included, with a step-by-step switching guide and a checked cutover, monthly donors moved with their cards and bank accounts; roles, SSO and an audit log; an API, webhooks and MCP; phone and native apps; and free, open-source ownership with exports and erasure (`MOVE-*`, `TEAM-*`, `API-*`, `MOBILE-*`, `DATA-*`, `OWN-*`).
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
| Merchandise and online shop | [Stall](https://github.com/just-every/run-stall) (or Shopify) | Donation lines and charity-priced items from orders become gifts (`PAY-006`) |
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

A donor has an email (or none) that no unrelated record shares. A household is found by name or created. Several emails, phones and postal addresses per constituent with one primary of each, and an email shared by members of one household, are `DONOR-013`; a person's name parts, salutations and envelope name are `DONOR-014`. Members, admins and the owner add and edit donors; edits are versioned, and a stale version is refused rather than overwritten.

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

Gifts at or over the threshold (default $250) without a live letter are due within the target days (default 14). No letter is prepared until a person has saved the settings; the letter must state donor name, amount, gift date, organization and the goods-or-services statement. A batch freezes its letters and content hash. A person approves the exact hash; export, then a recorded sent date. Imported gifts with an unknown goods answer wait for a person's answer. `RCPT-011` and the importers widen this: an imported gift takes its goods answer from the source's non-deductible amount (`MOVE-001` to `MOVE-006`), so only a gift whose source holds no answer waits; and a gift is due only while its acknowledgement status is "not acknowledged", so a gift acknowledged in Coffer or in the incumbent before the move, marked do not acknowledge, or received before the acknowledge-from date (`MOVE-007`) is never due or overdue, and recording a batch's sent date marks each of its gifts acknowledged by letter with the batch linked. This is the reviewed letter path for printed and hand-mailed acknowledgements; delivering the same approved letters by email is `RCPT-002`, print layouts are `RCPT-003` and one letter per household is `RCPT-009`.

*Acceptance:* The acknowledgement test has an agent prepare a batch, refuses preparation before settings are reviewed, lets only a person approve, exports the CSV with the exact letter text and records the sent date.

*Status:* done. Evidence: `src/coffer/acknowledgements.ts`, `src/coffer/settings.ts`, `tests/coffer.test.mjs`.

#### APPEAL-001 — Consent-checked appeals.

An audience includes only donors whose newest consent for the channel is yes and who have the needed address; exclusions are counted by reason. Each recipient is frozen with the exact consent row; approval, export and sending refuse if any of those rows is no longer current. Sending the approved audience through Mango or Mailchimp is `COMM-002`; this clause is the consent gate every send passes. Excluding inactive and deceased constituents is `DONOR-012`; excluding constituents with a solicitation restriction under the reason "do not solicit", and deliberately including one in a run, is `DONOR-015`; and one piece per household is `RCPT-009`.

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

A constituent is a person or an organization (business, foundation, church, school, government body, donor-advised fund sponsor). An organization has its own address, website, EIN and giving history, and named contacts who are person records linked to it with a role. Gifts from an organization credit the organization; its contacts see the gift on their timeline as related. An organization's letters and receipts are addressed to the organization with "Attn:" and its primary named contact, and open with that contact's salutation (`DONOR-014`).

*Acceptance:* An HTTP and browser journey creates a foundation with two contacts, records a $10,000 grant payment from it, and reads the gift on the foundation, not the contacts, with both contacts listing it as related; the grant's receipt is addressed to the foundation, attention its primary contact, and opens with that contact's informal salutation.

*Status:* partial. Every constituent is a person-shaped donor record; there is no organization type, EIN, website or contact role. Evidence: `src/coffer/donors.ts`.

#### DONOR-003 — Relationships.

Any two constituents can be related with a reciprocal type (spouse/spouse, parent/child, employee/employer, board member/organization, friend, advisor/client) that shows from both sides. Households keep a head of household, a formal and informal salutation and an addressee for letters, computed from the members' name parts (`DONOR-014`) by a default an admin sets ("Dr. Robert and Mrs. Jane Smith", "Bob and Jane") and overridable per household, and household giving totals combine members without double-counting a gift shared by two of them.

*Acceptance:* An HTTP journey relates a donor to an employer and a spouse, reads the reciprocal relationship from both records, reads the household addressee and informal salutation computed from both spouses' name parts, and checks that the household total counts a joint gift once.

*Status:* partial. Reciprocal spouse, employer, board member, foundation officer and introduced-by links show on both records and filter donor lists. Household salutations, head and combined totals remain. Evidence: `src/coffer/donor-depth.ts`, `src/coffer/ui/donor-depth.ts`, `docs/donor-depth.md`.

#### DONOR-004 — Interaction timeline.

Each constituent has one timeline of everything that happened: gifts, pledges, receipts sent and delivered, appeal sends, opens and replies, logged calls, meetings, visits, notes, tasks, event attendance and volunteer hours, newest first and filterable. Logging a call, meeting or note takes under ten seconds from the donor page or a phone: at most two taps or clicks plus the note text, with type, date and author defaulting to a call now by the signed-in person, and the entry shows on the timeline as soon as it is saved. Notes marked confidential are visible only to the roles `TEAM-001` allows.

*Acceptance:* A browser journey at 1440 and 390 pixels logs a call and a confidential note on a donor, counting at most two taps or clicks plus typing for each, and a timed run with a 30-character note typed at five characters a second takes under ten seconds from the first tap to the entry on the timeline; it sees both on the timeline with the gift and receipt events, filters the timeline to calls only and then to a date range and sees only the matching entries each time, and a data-entry user is refused the confidential note through HTTP.

*Status:* partial. Calls, meetings and emails record date, participants, notes, next step and author beside gifts, pledges and receipt events in one timeline. Confidential notes, timeline filters and the broader task/event integrations remain. Evidence: `src/coffer/donor-depth.ts`, `src/coffer/ui/donor-timeline.ts`, `docs/donor-depth.md`.

#### DONOR-005 — Custom fields and tags.

An admin adds custom fields to constituents, gifts, pledges, opportunities, interactions and notes. Each field has a type (text, number, currency in exact cents, date, year, checkbox) and an entry method (free-form, pick-one or pick-many from a pick list the admin edits). An admin also defines tags and categories (board member, volunteer, alumni, legacy society). A value is checked against its type and pick list wherever it enters: the record page, batch entry, a form question (`GIVE-001`), the API and every import. Fields and tags are searchable, segmentable in saved lists (`DONOR-007`), usable as report columns and groupings (`REPORT-004`), mergeable into every template (`RCPT-010`) and exportable, and the importers fill them from the incumbent's own custom fields (`MOVE-010`). Renaming a field or a pick-list value keeps every stored value.

*Acceptance:* An HTTP journey defines a pick-one and a pick-many constituent field, a currency gift field, a text interaction field and two tags; it refuses a value outside the pick list and a non-number in the currency field; it sets the fields on donors, a gift and a logged call, finds the donors by field and tag in a saved list and an appeal segment, sees them in a CSV export, groups a gifts report by the gift field (`REPORT-004`), and renames a pick-list value with every stored value following it.

*Status:* missing. No custom fields, tags or categories.

#### DONOR-006 — Duplicate detection and merge.

Coffer flags likely duplicates (same email, same name and postal address, same phone, near-name matches) when a record is added, imported or comes in from a form, and in a review queue. Members of one household who share an email, phone or address are not flagged for it (`DONOR-013`); unrelated records sharing any one of them are. A person compares two records side by side, picks the surviving value per field and merges: gifts, pledges, consent rows, interactions, relationships and provider links move to the survivor, the ledger is untouched and the merge is undoable from the audit log.

*Acceptance:* An HTTP and browser journey creates two records for one person through a form gift and a manual entry, finds them in the duplicates queue, merges them, reads one combined history with unchanged ledger totals, then undoes the merge; two spouses in one household who share an email never appear in the queue.

*Status:* partial. Reviewed manual merges combine gifts, pledges, conversations, relationships and provider links, preserve financial facts and retain source import aliases. Duplicate suggestions, field comparison and undo remain. Evidence: `src/coffer/donor-merge.ts`, `src/coffer/imports/service.ts`, `docs/donor-depth.md`.

#### DONOR-007 — Saved searches and lists.

A person filters constituents on any field, tag, giving range, date of last gift, fund, campaign, relationship manager, consent, engagement score and lapsed status, and saves the filter as a named list that stays current. Lists drive appeals, journeys, reports, tasks and exports. From a list, an admin applies a bulk action to every record in it (add or remove a tag, assign a relationship manager, set a custom field, change status, or set or clear a solicitation restriction) as one audited change that can be undone. A list can filter on the solicitation restriction (`DONOR-015`); a list used for an ask leaves restricted constituents out unless a person includes them for that run, recorded on the run as `DONOR-015` sets out.

*Acceptance:* An HTTP journey saves a list of donors who gave $500 or more last year with email consent, adds a qualifying gift, and sees the list grow without editing it; the list feeds an appeal audience; a bulk action adds a tag and assigns a relationship manager to every record in the list, and undoing it restores each record; a second bulk action sets "do not solicit" on every record of a list, a list filtered on the restriction returns exactly those records, and the audit log names who set it.

*Status:* partial. Donor search includes reciprocal relationship-type and connected-donor filters. General saved lists and undoable bulk actions remain. Evidence: `src/coffer/donors.ts`, `src/coffer/ui/donors.ts`.

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

*Status:* done. The donor API and record show ledger-derived lifetime, first/largest/last remaining gift, count, consecutive fiscal giving years, monthly plan states, open pledge balance and separate soft credits. An audited fiscal-year start setting drives current versus previous fiscal totals; signed corrections retain their ledger dates. Evidence: `src/coffer/giving-summary.ts`, `src/coffer/ui/giving-summary.ts`, `tests/giving-summary.test.mjs`, `tests/giving.test.mjs`.

#### DONOR-012 — Constituent status: active, inactive and deceased.

Every constituent has a status: active, inactive (with a reason, such as asked for no contact, moved away or no longer engaged) or deceased (with the date of death and who recorded it). Status changes are versioned and audited, and a deceased record keeps its whole history. Every send and print path excludes inactive and deceased constituents by default and counts them under that reason: email and mail appeals (`APPEAL-001`, `COMM-002`, `COMM-007`), journeys (`STEW-003`, which also removes donors already enrolled), SMS (`COMM-006`), pledge reminders (`STEW-004`), year-end statements (`RCPT-004`), saved lists unless a person asks to include them (`DONOR-007`), new tasks and the call list (`DEV-005`). Open tasks and journey enrolments on a donor marked deceased close with that reason and the relationship manager is told. A gift that is itself being receipted is still receipted: a gift from the estate or in the donor's memory is addressed to the estate or the surviving household member, never to the deceased. When a household member is marked deceased, the household addressee and salutations (`DONOR-003`) are recomputed for the survivor ("Mr. and Mrs. John Smith" becomes "Mrs. Jane Smith") and shown for a person to confirm before the next mailing; joint giving history stays with the household. Every importer (`MOVE-001` to `MOVE-006`) carries the incumbent's status and date of death. Inactive stops receipts and statements too; a donor who should still get them but never be asked carries a solicitation restriction (`DONOR-015`) instead.

*Acceptance:* An HTTP journey marks a consenting donor deceased with a date; the next email appeal, mail appeal and journey step exclude them with the reason "deceased", their open task closes with that reason, and the household addressee and salutation change to the surviving spouse; an inactive donor is excluded with the reason "inactive"; the Little Green Light and Bloomerang importers read fixture records marked deceased and inactive and carry both statuses and the date of death.

*Status:* missing. Constituents have no status; appeals exclude only on consent and address, and erasure is the only way to stop a record being used.

#### DONOR-013 — Several emails, phones and addresses.

A constituent holds any number of email addresses, phone numbers and postal addresses. Each has a type (email: personal, work, other; phone: mobile, home, work; address: home, work, vacation, seasonal, other) and each kind has exactly one primary: making another one primary demotes the old one in the same change, and every change is versioned and kept in history with its source and date. A seasonal address carries a yearly active range (for example 1 November to 31 March) and is the mailing address while it is active. Email receipts and acknowledgements (`RCPT-001`, `RCPT-002`), appeals and journeys (`APPEAL-001`, `COMM-002`, `STEW-003`), letters, statements and mail files (`RCPT-003`, `RCPT-004`, `COMM-007`) use the primary of the kind they need, or the type a run chooses (for example a work email for a matching-gift reminder), and record which contact point each message went to. Members of one household may share an email, phone or address: they are not flagged as duplicates for it and stay separate people, while an unrelated record with the same email, phone or address goes to the duplicates queue (`DONOR-006`). Consent (`CONSENT-001`, `COMM-001`) stays per person and channel even when the address is shared, so one spouse withdrawing never withdraws the other, and one appeal never sends the same message twice to one shared email (one piece per household is `RCPT-009`). Donor lookup, batch entry and form matching search every contact point, not only the primary. Every importer (`MOVE-001` to `MOVE-006`) carries all contact points with their types and primary flags.

*Acceptance:* An HTTP journey gives a donor a home and a work email, a mobile and a home phone, and a home and a vacation address, then makes the work email primary; the next receipt goes to the work email and records it, and a mail appeal file uses the primary address; a seasonal address active from November to March is used by a mail file dated in January and not by one dated in June; two spouses in one household are saved with the same email and neither is flagged as a duplicate, an unrelated record with that email lands in the duplicates queue, and withdrawing one spouse's email consent leaves the other's current answer yes; the Bloomerang and Little Green Light importers read a fixture constituent with three emails and two addresses and carry all five with their types and primaries.

*Status:* partial. A donor has one email (refused if any other record has it), one phone and one postal address; no further contact points, types, primaries, seasonal ranges or email shared within a household. Evidence: `src/coffer/donors.ts`, `migrations/core/0016_coffer.sql`.

#### DONOR-014 — Name parts, salutations and envelope name.

A person record has a prefix (Dr., Mr., Ms., Rev.), first, middle and last name, a suffix (Jr., III, PhD) and a nickname. From these it has an informal salutation ("Bob"), a formal salutation ("Dr. Smith") and an envelope name ("Dr. Robert A. Smith Jr."). Each is computed by a default an admin sets in settings (out of the box: informal is the nickname, else the first name; formal is the prefix and last name, else the first and last name; envelope is the prefix, first name, middle initial, last name and suffix), and each can be overridden on the record. An overridden value stays as typed when the name parts change; a computed one follows them. Changing a default recomputes every value that is not overridden and shows the count of changed records before it saves. The display name, search and duplicate checks (`DONOR-006`) use the name parts, and the recognition name for honour rolls is `GIFT-011`. An organization uses its primary named contact's salutation (`DONOR-002`), and a household has its own addressee and salutations (`DONOR-003`). Every receipt, acknowledgement, statement and journey template (`RCPT-007`), single letter, mail file and Lob send (`RCPT-003`, `COMM-007`) and the Mango, Mailchimp and Constant Contact audience sync (`COMM-002`, `COMM-003`) merges these fields as `RCPT-010` lists them; a household piece (`RCPT-009`) merges the household's. Every importer (`MOVE-001` to `MOVE-006`) carries the incumbent's name parts and its informal, formal and envelope names (Bloomerang's Name Title, Name Suffix, Informal Name and Envelope Name; Little Green Light's short and long salutations and addressee; Raiser's Edge NXT's primary addressee and salutation; Neon CRM's salutation), unchanged, as overrides wherever they differ from the computed value, and its recognition name into `GIFT-011`.

*Acceptance:* An HTTP journey creates "Dr. Robert A. Smith Jr." (prefix Dr., first Robert, middle A., last Smith, suffix Jr.) with the nickname "Bob" and no overrides, and reads the computed informal salutation "Bob", formal salutation "Dr. Smith" and envelope name "Dr. Robert A. Smith Jr."; it overrides the envelope name, and an acknowledgement batch and an email receipt render "Dear Bob," with the overridden envelope name on the PDF letter and the label; with the informal default set to the nickname only, a donor with no nickname renders "Dear Ms. Lee," from the formal salutation; the audience synced to the Mailchimp edge carries the informal-salutation merge field for each member; and the Bloomerang importer reads a fixture constituent's Informal Name and Envelope Name and carries both unchanged, as the Little Green Light importer does with a fixture's salutation and addressee.

*Status:* partial. A donor has one free-text name and letters merge only `{{donor_name}}`; no prefix, first, middle and last name, suffix or nickname, no computed or overridden salutations or envelope name, and no admin-set defaults. Evidence: `src/coffer/donors.ts`, `src/coffer/settings.ts`, `tests/coffer.test.mjs`.

#### DONOR-015 — Solicitation restrictions.

A constituent can carry a solicitation restriction, kept apart from channel consent (`CONSENT-001`, `COMM-001`): consent says which channels may be used; the restriction says whether the donor may be asked for money at all. It is "do not solicit" (no ask on any channel) or a limit instead of a full stop: no asks on chosen channels (for example "no mail appeals", while mailed receipts and statements still go), or at most a set number of asks in a period (for example "solicit once a year"), counted across every ask channel. Each restriction records its type, start date, optional end date, source (a person, the donor portal, a donor request logged as an interaction, or an import with its source system and date) and who set it; changes are versioned like consent and written to the audit log (`TEAM-003`), and only the roles `TEAM-001` allows (default: admin, owner and the relationship manager) can clear one. The restriction shows as a badge beside the name on the donor page, the phone view (`MOBILE-001`), the opportunity (`MAJOR-001`) and every call task; it is a filter in saved lists and reports (`DONOR-007`, `REPORT-004`), a column in exports (`DATA-002`), a value the `DONOR-007` bulk action sets or clears, and readable and writable through the API (`API-001`). Every outbound run is an ask or not. Email, mail and SMS appeals (`APPEAL-001`, `COMM-002`, `COMM-003`, `COMM-006`, `COMM-007`) are asks; journey steps (`STEW-003`) and call tasks (`STEW-001`, `DEV-005`) carry an ask flag set by whoever builds them, and ask and upgrade calls are asks. Every ask path excludes a restricted constituent by default and counts the exclusion under the reason "do not solicit" (or "solicitation limit" when a limit is used up, with the date of the last ask). The restriction never stops what is not an ask: email receipts and acknowledgements (`ACK-001`, `RCPT-001`, `RCPT-002`), year-end statements (`RCPT-004`), reminders and invoices for a pledge the donor made (`STEW-004`), failed-payment and card-expiry notices (`GIVE-006`), tribute notifications (`GIFT-008`), event confirmations, journey thank-you steps and newsletter sends marked as not an ask under the newsletter topic. A personal solicitation by the assigned relationship manager through the major-gift pipeline (`MAJOR-001` to `MAJOR-003`) is not blocked, and the badge shows there so the manager knows. A person preparing an ask can deliberately include a restricted constituent in that one run: they pick the record and give a reason, and the choice, its reason and who made it are recorded on the run and the donor's timeline; it never changes the restriction. Inactive status (`DONOR-012`) stops every send; the restriction is for a donor who still gets receipts, statements and the newsletter but is never asked. Every importer carries the incumbent's restrictions (`MOVE-001` to `MOVE-004`, `MOVE-008`), and the reconciliation counts them (`MOVE-007`).

*Acceptance:* An HTTP journey with sender edges faked sets "do not solicit" on a donor with email, mail and SMS consent and an open pledge; an email appeal, a mail appeal and an SMS appeal each exclude them with the reason "do not solicit"; their next gift is still receipted by email, their year-end statement is still prepared, their pledge reminder still goes and a newsletter send still includes them; a journey's ask step skips them while its thank-you step runs; the `DEV-005` call list gives them no ask task; a person who includes them in one email appeal on purpose sees that choice, its reason and its author recorded on the run and the timeline; a "solicit once a year" donor is included in a first appeal and excluded from a second that year with the reason "solicitation limit"; a "no mail appeals" donor is excluded from a mail appeal and included in an email appeal; a data-entry user is refused clearing a restriction; a saved list filtered on the restriction and a bulk action that sets it on every record of a list both work and are audited; the API reads and writes it; and the badge shows on the donor page at 1440 and 390 pixels.

*Status:* missing. No solicitation restriction: consent is per channel (email and postal) only, and appeals exclude only on consent and address.

### Gifts and pledges

Every way US donors give, entered fast and attributed exactly.

#### GIFT-002 — Batch gift entry and deposits.

Staff enter a stack of checks or cash as a batch: shared defaults (date, fund, campaign, appeal, method), keyboard-only entry with donor lookup and add-new inline, a running total checked against the expected deposit total, and a batch that closes only when it balances. A closed batch is one bank deposit for `FIN-001`. Each check keeps its check number, searchable and shown on the deposit for bank matching and donor questions. Donor lookup finds a record by name, any email or phone (`DONOR-013`) or the legacy ID every importer keeps (`MOVE-007`), so reply cards printed by the old system still match. A card or bank account written on a reply card is charged from the batch through `GIVE-009`.

*Acceptance:* A browser journey enters a 12-check batch at 1440 pixels with defaults, is refused closing it while it is $50 off the expected total, corrects it, closes it, and sees one deposit with 12 gifts, each with its check number; searching one check number finds its gift, and a reply card printed with a Bloomerang account number finds its donor by that number in batch lookup.

*Status:* missing. Gifts are entered one at a time; no batches or deposit totals.

#### GIFT-003 — Campaign, appeal, fund and channel attribution.

Every gift carries a fund (designation), a campaign, an appeal and its source (form, event, mail piece, email, text-to-give) as structured references, not free text. Funds are restricted or unrestricted with an accounting mapping (`FIN-003`). Online gifts take these from the form and tracked link; imported gifts from the source mapping.

*Acceptance:* An HTTP journey defines funds, a campaign and two appeals, records gifts against them through entry, a form and an import, and reads totals by each dimension that sum to the ledger.

*Status:* partial. Each gift has one free-text fund; no campaigns, appeals or source as structured references. Evidence: `src/coffer/gifts.ts`.

#### GIFT-004 — Split gifts.

One payment can be split across several funds or campaigns in exact cents that sum to the payment. The receipt shows one payment; reports and accounting count each part where it belongs.

*Acceptance:* An HTTP journey splits a $1,000 check $600/$400 across two funds, refuses a split that sums to $999.99, issues one receipt for $1,000 and reads each fund's total.

*Status:* done. One payment has immutable, exact-cent fund or campaign allocations that must sum to its amount. Donor totals and tax receipts count the payment once; fund/campaign reports, accounting CSV and payout accounting count each part, including signed reversals. Receipt and statement wording lists each allocation. Browser journeys at 1440 and 390 exercised entry, refusal, fund drill-down, printing and a real hosted receipt email. Evidence: `src/coffer/gift-splits.ts`, `migrations/core/0039_coffer_gift_splits.sql`, `src/coffer/fund-report.ts`, `tests/split-gifts.test.mjs`.

#### GIFT-005 — Pledges, installments and balances.

A pledge has a total, a schedule (one date, or monthly, quarterly or annual installments), a fund and campaign, and links to the gifts that pay it. Coffer shows paid, due and overdue amounts per installment, writes pledges off or reduces them with a reason (never by deleting), and lets a pledge be paid by a recurring plan (`GIVE-003`). Reminders are `STEW-004`.

*Acceptance:* An HTTP journey creates a $12,000 pledge in four quarterly installments, pays two, sees the third overdue on the pledge and the donor page, reduces the balance with a reason, and reads the full history.

*Status:* partial. Dated installments total the pledge, allocations match gifts by donor/fund without overpayment, and reversals reopen balances. Write-offs, reductions, campaign attribution and recurring-plan payment remain. Evidence: `src/coffer/pledges.ts`, `src/coffer/ui/pledges.ts`, `tests/pledges.test.mjs`.

#### GIFT-006 — Soft credits.

A gift can soft-credit other constituents (a spouse, the board member who solicited it, the donor-advised fund advisor, a peer-to-peer fundraiser) for a full or partial amount. Soft credits appear on the credited record, in its giving summary and in reports as soft credit, never in hard-credit totals or on a tax receipt. Each soft credit has its own acknowledgement status (`RCPT-011`), so a spouse or a soliciting board member can be thanked and recorded separately from the hard-credit donor.

*Acceptance:* An HTTP journey records a DAF grant hard-credited to the sponsor and soft-credited to the advisor, and reads the advisor's soft-credit total separately from hard credit in the donor API and a retention report.

*Status:* partial. Full or partial recognition links another donor to a gift and appears in a separate reversal-aware total without increasing received totals or tax receipts. Separate acknowledgement status and report integration remain. Evidence: `src/coffer/gift-depth.ts`, `tests/soft-credits.test.mjs`.

#### GIFT-007 — Matching gifts.

A gift can be marked as eligible for an employer match, with the employer looked up through Double the Donation (360MatchPro) from the donor's email domain or employer field. Coffer tracks the match from eligible to submitted to received, links the employer's payment to the original gift, soft-credits the employee, and reminds the donor (with consent) to submit.

*Acceptance:* An HTTP journey with the Double the Donation edge faked records a $500 gift, finds the employer's 1:1 program, moves the match through submitted to received when the employer's $500 check arrives, and reads the linked gifts and soft credit.

*Status:* partial. Expected employer amount/deadline links the original gift to a received employer ledger gift, with overdue and reversal-aware states. Program lookup, submission workflow, automatic employee recognition and submission reminders remain. Evidence: `src/coffer/gift-depth.ts`, `src/coffer/ui/gift-depth.ts`, `tests/soft-credits.test.mjs`.

#### GIFT-008 — Tribute gifts.

A gift can be made in honor or in memory of someone, with an optional person to notify. Coffer records the tribute on the gift, groups gifts by tribute (a memorial fund for one person), and prepares a notification letter or email to the named family without disclosing the amount unless the donor allowed it. Tribute history imported from an incumbent (`MOVE-001` to `MOVE-006`) counts toward each tribute's total, so a memorial fund does not restart at zero after the switch.

*Acceptance:* A form gift in memory of a named person with a notify-address produces a tribute record, a notification for approval that omits the amount, and a tribute total of all gifts in that name; after the `MOVE-002` import, a memorial tribute's total includes its imported gifts and equals the source.

*Status:* partial. Honor/memory, honoree and notification contact are recorded on gifts and included in approved gift/year-end receipt text. Tribute grouping, notification sending and incumbent tribute imports remain. Evidence: `src/coffer/gift-depth.ts`, `src/coffer/acknowledgements.ts`, `src/coffer/year-end.ts`, `tests/soft-credits.test.mjs`.

#### GIFT-009 — In-kind gifts.

A non-cash gift records a description, quantity and the donor's stated value for internal reporting. Its acknowledgement describes the property and states no dollar value, as IRS guidance expects; gifts over $5,000 raise a reminder that the donor may need the organization's Form 8283 signature, and selling donated property within three years raises a Form 8282 reminder.

*Acceptance:* An HTTP journey records a donated laptop and a $6,000 artwork, reads acknowledgements that describe each without a value, sees the Form 8283 reminder on the artwork, and a Form 8282 reminder when the artwork is marked sold a year later.

*Status:* missing. Gifts are monetary only.

#### GIFT-010 — Stock, DAF grants and IRA distributions.

Gifts of publicly traded securities (shares, symbol, transfer date, the mean of high and low as the recorded value, and sale proceeds when sold), grants from donor-advised funds (hard credit to the sponsor, soft credit to the advisor, an acknowledgement without deductibility language) and IRA qualified charitable distributions (custodian, acknowledgement stating no goods or services) each have their own gift type and receipt wording.

*Acceptance:* An HTTP journey records one of each, reads the right hard and soft credits, and checks each acknowledgement's wording, including the absence of deductibility language on the DAF grant.

*Status:* missing. No stock, DAF or QCD gift types.

#### GIFT-011 — Anonymous gifts and recognition names.

A donor or a single gift can be marked anonymous, and every constituent has a recognition name ("The Rivera Family", "Anonymous") for honour rolls. Anonymous gifts never appear under the donor's name on campaign pages, donor walls, peer-to-peer leaderboards or an exported honour roll, while staff still see the donor, and the gift counts in every total and receipt. An honour-roll report lists donors by giving level for a period under their recognition names.

*Acceptance:* An HTTP journey marks one donor anonymous and one gift anonymous, gives through a campaign page, and reads a donor wall and an honour-roll export that show "Anonymous" for both and recognition names for the others, while the staff donor page, totals and receipts include both gifts.

*Status:* missing. No anonymity flag or recognition name.

### Online giving

Coffer takes donations itself through the nonprofit's own Stripe account (and PayPal), so a buyer of Givebutter, Zeffy or Bloomerang's forms can switch.

#### GIVE-001 — Donation forms.

An admin builds branded donation forms (logo, colors, copy, suggested amounts, one-time and recurring toggle, designation picker, tribute fields, employer field, comment, optional fee cover) and publishes them as a hosted page and an embeddable script for any website, including Pane, WordPress and Squarespace. Custom questions on a form map to custom fields (`DONOR-005`). Forms are accessible (WCAG 2.2 AA), work at 390 pixels and record each gift with its form, campaign and source. A form loads in under one second: on a cold cache at 390 pixels over a 4G profile (9 Mbps down, 1.5 Mbps up, 85 ms round trip) with 4x CPU throttling, the form's own content is rendered and accepts input within one second of navigation, and the Stripe payment field is ready within two seconds.

*Acceptance:* A browser journey builds a form with a custom question, embeds it on a test page, and gives $50 at 1440 and 390 pixels with the Stripe edge in test mode; the gift, donor, consent answer, custom-field answer and receipt appear in Coffer, and an axe check of the form passes; a timing run of the hosted form under the stated profile (CDP network emulation and `Emulation.setCPUThrottlingRate` 4) records a median of five cold loads under one second to input-ready and under two seconds to payment-field-ready.

*Status:* partial. Hosted campaign forms collect once/monthly card and Link gifts and retain fund/campaign attribution. Advanced fields, embedding and the specified performance/accessibility acceptance remain outstanding. Evidence: `src/coffer/giving/`, `tests/giving.test.mjs`.

#### GIVE-002 — Campaign pages.

A campaign page tells the story with images and video, shows a goal thermometer and donor count from the ledger, lists recent donors who chose to be shown, and holds a form. Pages have a custom path on the nonprofit's domain and close on a date.

*Acceptance:* A browser journey publishes a campaign page with a $60,000 goal, an uploaded image and an embedded video, sees both on the published page at 1440 and 390 pixels, gives twice through it, and sees the thermometer, donor count and opt-in donor wall update; the page is served at the custom path set on the nonprofit's own domain (for example `/give/spring`); after the close date the page refuses new gifts with a message.

*Status:* partial. Custom-path public campaign stories, goals, ledger totals, gift counts and recurring donor counts ship. Uploaded media, donor walls and closing dates remain outstanding. Evidence: `src/coffer/giving/`, `tests/giving.test.mjs`.

#### GIVE-003 — Recurring giving.

Donors choose monthly, quarterly or annual giving on any form. Coffer schedules each installment itself against the donor's saved Stripe payment method (or keeps an adopted Stripe subscription running), records every successful installment as a gift linked to its plan, and shows plan status (active, past due, paused, cancelled) with its history. Staff create a plan from a signed pledge form or a phone call by collecting its card or bank account through staff payment entry (`GIVE-009`), and change amount or date, pause and cancel, each recorded.

*Acceptance:* An HTTP journey with Stripe in test mode and a test clock starts a $25 monthly plan, advances three months, reads three linked gifts, pauses and resumes the plan, and cancels it.

*Status:* partial. Monthly Stripe subscriptions record successful installments and show status and recovery; donors cancel at period end. Quarterly/annual plans, staff editing, pause/resume and the three-month test-clock acceptance remain outstanding. Evidence: `src/coffer/giving/`, `tests/giving.test.mjs`.

#### GIVE-004 — Card, bank, wallet and PayPal checkout.

Forms accept cards, US bank accounts through ACH Direct Debit with instant verification, Apple Pay and Google Pay through Stripe, and PayPal and Venmo through PayPal Checkout. ACH gifts are pending until they settle and become ledger lines only when funds arrive; a later return (insufficient funds, closed account) reverses the gift and opens follow-up. Staff take the same card and bank payments by phone or mail through `GIVE-009`. Coffer never sees or stores card or account numbers.

*Acceptance:* A browser journey with provider test modes gives by card, ACH (with a later R01 return that writes a reversal and a task), Apple Pay on a WebKit device profile and PayPal, and an inspection of stored records finds no card or account numbers.

*Status:* partial. Stripe-hosted card and Link checkout ships, with Apple Pay offered on supported devices. ACH is coming soon pending a US test account; Apple Pay device payment, PayPal/Venmo, ACH settlement/returns and staff entry remain outstanding. No card numbers enter Coffer. Evidence: `src/coffer/giving/`, `tests/giving.test.mjs`.

#### GIVE-005 — Donor portal.

Donors sign in with an emailed link (no password) to see their gifts, download receipts and year-end statements, update the card or bank account behind a recurring plan through a Stripe-hosted update, change amount or frequency, pause or cancel, and set their communication preferences. Every change is recorded on their timeline and reaches staff when it matters (a cancellation opens a task).

*Acceptance:* A browser journey at 390 pixels signs a donor in by link, downloads last year's statement, replaces an expiring card, lowers the monthly amount and withdraws email consent; staff see each change on the timeline and a cancellation task.

*Status:* partial. Emailed single-use links open a donor-only portal to view monthly plans, update cards at Stripe and cancel. Statements, amounts/frequencies, pause, communication preferences and cancellation tasks remain outstanding. Evidence: `src/coffer/giving/`, `tests/giving.test.mjs`.

#### GIVE-006 — Failed recurring payments.

When an installment fails, Coffer retries on a schedule (or follows Stripe's retry outcome for an adopted subscription), emails the donor a link to update their payment method, warns donors a month before a saved card expires, marks the plan past due, and opens a task for the plan's relationship manager when retries run out. A recovered plan records which step recovered it. These notices are not asks: they still go to a donor with a solicitation restriction (`DONOR-015`).

*Acceptance:* An HTTP journey with the Stripe edge faked fails a monthly installment, sends the donor notice, recovers on the second retry and records it; a second plan exhausts retries and opens a task; an expiring card sends the warning a month ahead; a do-not-solicit donor's failed-installment notice still goes.

*Status:* partial. Stripe schedules retries; verified failure outcomes email private card-update links and successful recovery is recorded. Expiry warnings and staff escalation after exhausted retries remain outstanding. Evidence: `src/coffer/giving/`, `tests/giving.test.mjs`.

#### GIVE-007 — Fraud and card-testing protection.

Donation forms resist card testing: Cloudflare Turnstile challenges, per-address and per-card rate limits, Stripe Radar rules, a minimum amount, and an automatic pause of a form whose failure rate spikes, with an alert to the admin. Fraudulent gifts that slip through are refunded and kept out of donor records and retention figures.

*Acceptance:* An HTTP journey sends 30 small card attempts from one address in a minute; attempts after the limit are refused, the form pauses and the admin is alerted, and no donor records are created for the failures; with the Stripe edge faked, a charge returned as blocked by a Radar rule is refused, creates no donor or gift and counts toward the form's failure rate.

*Status:* missing. No forms to protect.

#### GIVE-008 — Text-to-give.

A nonprofit claims a keyword on its Twilio number; a donor who texts it gets a link to a mobile form prefilled with their phone number, and the gift is attributed to the text-to-give source. Replies of STOP end messages at once.

*Acceptance:* An HTTP journey with the Twilio edge faked texts a keyword, follows the link, gives, and sees the gift attributed to text-to-give; a STOP reply records SMS consent as withdrawn.

*Status:* missing. No text-to-give.

#### GIVE-009 — Staff-entered card and bank payments.

A fundraiser takes a gift by phone or from a mailed reply card without the donor-facing form. From a donor page or a gift batch (`GIFT-002`), they open a payment entry and choose one of three ways to pay: key a card into Stripe Elements as a card-not-present (mail or telephone order) payment; enter a US bank account into Stripe's bank account element with the donor's spoken or written ACH authorization recorded (method, date, who took it, and the signed form attached under `DONOR-008` or the call logged on the timeline); or charge a payment method already saved on the donor. One step charges the payment and records the gift with the entering user, its source (phone, mail, in person), fund, campaign and appeal, and sends the usual receipt (`RCPT-001`); an ACH payment is pending until it settles, as in `GIVE-004`. The same entry can start a recurring plan (`GIVE-003`) on the new or saved payment method, which is how a signed monthly pledge form becomes a plan. Staff payments never pass through the public form, so the card-testing limits of `GIVE-007` neither count nor block them. They are limited by role (`TEAM-001`): fundraisers, admins and the owner may charge, data-entry, volunteer and read-only roles may not, and an admin can turn charging off for a role. Card and account numbers go from the browser straight to Stripe; Coffer stores only Stripe references, the last four digits and the card brand or bank name.

*Acceptance:* A browser journey with Stripe in test mode has a fundraiser key in a $100 card gift on a donor page, start a $20 monthly plan on an ACH test account with a spoken authorization recorded, and charge the donor's saved card for a second gift; it reads three ledger lines (the ACH one after its test settlement) with source "phone", the fundraiser as entering user and a receipt for each, and the plan active on the ACH payment method with its authorization; a data-entry user is refused the charge through HTTP, no `GIVE-007` limit counts the three payments, and an inspection of stored records finds no card or account number.

*Status:* missing. Coffer takes no payments; staff record a gift by hand after the money arrives elsewhere.

### Campaigns, events and memberships

The fundraising programmes the incumbents run gifts through.

#### CAMP-001 — Campaigns with goals.

A campaign has a goal, dates, funds, appeals and forms under it; progress is counted from the ledger (gifts, pledges outstanding, soft credits shown separately), with donors, new donors, recurring donors and average gift. Campaigns can nest (a capital campaign with yearly phases).

*Acceptance:* An HTTP journey creates a spring appeal campaign with a $60,000 goal, records form, check and pledge gifts against it, and reads raised, pledged, donor and recurring counts that match the ledger.

*Status:* partial. Published campaigns have a goal and fund, with ledger-derived raised/gift totals and distinct recurring donors. Dates, nested campaigns, pledges/soft credits, manual attribution and additional campaign statistics remain outstanding. Evidence: `src/coffer/giving/`, `tests/giving.test.mjs`.

#### CAMP-002 — Fundraising events.

An event has ticket types with the fair market value of the benefit, registration through a hosted page with attendee names, dietary notes and custom questions mapped to custom fields (`DONOR-005`), sponsorship and table packages, a guest list, and check-in on a phone. A ticket's contribution part (price minus fair market value) is receipted with the quid pro quo disclosure (`RCPT-005`); attendance joins each guest's timeline.

*Acceptance:* A browser journey sells a $150 gala ticket with a $60 dinner value, checks the guest in at 390 pixels, and reads a receipt stating $90 deductible and the attendance on the guest's timeline.

*Status:* missing. No events.

#### CAMP-003 — Peer-to-peer fundraising.

Supporters create personal or team fundraising pages under a campaign, share them, and see their totals on a leaderboard. Each gift is hard-credited to its donor and soft-credited to the fundraiser; fundraisers get thank-you and milestone emails.

*Acceptance:* A browser journey creates a team and two personal pages, gives through each, and reads the leaderboard, the donor hard credits and the fundraiser soft credits.

*Status:* missing. No peer-to-peer pages.

#### CAMP-004 — Memberships.

Membership levels with price, term and benefits; joins and renewals through forms or entry; automatic renewal on a recurring plan; expiry, grace period and lapsed status; renewal reminders; and member counts by level. The contribution part of a membership is receipted like any gift with its benefits disclosed.

*Acceptance:* An HTTP journey sells an annual membership with auto-renew, advances a test clock past the term, sees the renewal charge, then lets a second membership lapse and receives its reminder and lapsed status, and reads member counts by level.

*Status:* missing. No memberships.

#### CAMP-005 — Auction results as gifts.

After a gala, the auction platform's results (Qgiv, Givebutter, OneCause, GiveSmart, Handbid, or any CSV with lot, item, winning bidder, winning bid, fair market value and paid status) import into the event (`CAMP-002`) with preview, apply and undo. Each paid lot is recorded on the winning bidder, matched to donors by the review queue of `PAY-001`: the item's fair market value is its goods-or-services value and the excess of the bid over that value is a gift receipted with the quid pro quo disclosure (`RCPT-005`); a bid at or under fair market value is recorded as event revenue with no contribution. A lot without a fair market value waits for a person, as an unknown goods answer does in `ACK-001`. Fund-a-need paddle raises import as plain gifts, unpaid lots stay as open balances on the bidder, and donated auction items record their donors as in-kind gifts (`GIFT-009`).

*Acceptance:* An HTTP journey imports a fixture auction-results CSV with a $500 winning bid on a lot valued at $200, a $150 bid on a lot valued at $300, a $1,000 fund-a-need raise and one lot without a value; it reads a $500 payment with $300 deductible, a purchase with no contribution, a $1,000 gift and the valueless lot waiting for a person, and each receipt carries the quid pro quo statement.

*Status:* missing. No events or auction import.

### Payments

Gifts, fees, refunds and payouts arrive from the processor by themselves and match to the cent.

#### PAY-001 — Live Stripe connection.

The owner connects the nonprofit's Stripe account (Stripe Connect OAuth or a restricted key). Coffer registers a signed webhook, processes each event once by its id, backfills history through the list APIs, and runs a daily sweep of balance transactions that catches any missed event. Payments made outside Coffer (Payment Links, Stripe Checkout elsewhere, an existing subscription) become gifts matched to donors by email, with unclear matches waiting in a review queue.

*Acceptance:* An HTTP journey with Stripe in test mode connects an account, receives charge and refund webhooks (one replayed, one with a bad signature refused), drops one event and sees the daily sweep add it, and reviews an ambiguous donor match.

*Status:* partial. Signed live charge, refund, dispute, failure and payout events, external donor matching and replay-safe money entries ship alongside saved-page move-in. OAuth/automatic endpoint registration, scheduled backfill/sweep and an ambiguous-match review queue remain outstanding. Evidence: `src/coffer/payments/`, `src/coffer/giving/webhooks.ts`, `tests/payments.test.mjs`.

#### PAY-002 — Payouts with their gifts.

Each Stripe payout is recorded with every gift, refund, dispute and fee it contains, so a bank deposit opens to the exact gifts behind it. A payout whose contents do not sum to the deposited amount is flagged with the difference explained.

*Acceptance:* An HTTP journey with the Stripe edge faked receives a payout of 14 charges, two fees and one refund, opens it in Coffer, and reads gross, fees, refunds and net equal to the deposit.

*Status:* done. Payout detail retains every processor entry, gross, fees and fund split and flags differences; automatic membership comes from paginated Stripe balance APIs, manual membership is explicitly selected and validated. Posting requires a completed exact-cent match. Evidence: `src/coffer/payments/payouts.ts`, `tests/payments.test.mjs`.

#### PAY-003 — Refunds and disputes.

A refund or dispute from the processor (or a staff-initiated refund through Coffer, which calls Stripe) writes a reversal line against the original gift, voids or corrects its receipt (`RCPT-008`), notifies the relationship manager, and for a dispute tracks evidence due dates and the outcome. A won dispute reinstates the gift as a new line.

*Acceptance:* An HTTP journey with the Stripe edge faked refunds half a gift, opens a dispute on another and wins it, and reads the reversal lines, the corrected receipt and the reinstated gift.

*Status:* partial. Processor refunds and disputes append immutable contribution reversals and a dispute win reinstates the contribution. No receipt correction, staff-initiated refund, relationship-manager notice or evidence due-date workflow yet. Evidence: `src/coffer/payments/entries.ts`, `tests/payments.test.mjs`.

#### PAY-004 — Processing fees and fee cover.

Each online gift records its processing fee from the processor's balance transaction. A donor who covers the fee gives the grossed-up amount and is receipted for the full amount paid. Reports show gross, fees and net by fund, form and campaign.

*Acceptance:* An HTTP journey gives $100 with fee cover, reads the gift, fee and receipt amounts, and a fee report by form that sums to the payouts.

*Status:* partial. Immutable balance transactions record processor gross, fees and net, shown by fund in each payout. Donor fee-cover checkout and form/campaign fee reports remain outstanding. Evidence: `src/coffer/payments/entries.ts`, `src/coffer/payments/ui.ts`, `tests/payments.test.mjs`.

#### PAY-005 — Other giving platforms.

A nonprofit that keeps Givebutter, Donorbox, PayPal Giving Fund or a workplace-giving platform such as Benevity for some gifts connects it (Givebutter's API and webhooks, Donorbox's API, CSV disbursement reports otherwise); those gifts arrive in the same ledger with their source, fees and payout, matched to donors with the same review queue as `PAY-001`.

*Acceptance:* An HTTP journey with the Givebutter edge faked ingests transactions and a changed transaction, and imports a Benevity disbursement CSV, reading gifts with source, fees and payout matched to donors.

*Status:* missing. No other platform connections.

#### PAY-006 — Shop orders record only the contribution.

When the nonprofit sells through Stall (Run Edit Run's shop) or Shopify, Coffer receives each paid order by signed webhook and writes only its contribution as a gift: a donation line, a round-up, or the part of a charity-priced item above its stated fair market value. Merchandise, shipping and sales tax never enter the gift ledger or a receipt; the buyer is matched to a donor by the review queue of `PAY-001`, and a refunded order reverses only its contribution.

*Acceptance:* An HTTP journey with the Stall edge faked receives an order with a $40 T-shirt, $6 shipping, $3.20 sales tax and a $25 donation line, and writes one $25 gift with a receipt for $25 only; a $60 charity T-shirt with a stated value of $20 writes a $40 contribution; refunding the order reverses only the contribution; the same order from the Shopify edge writes the same gift.

*Status:* missing. No shop connection.

### Accounting

Coffer reconciles to the books; the general ledger stays in Pantry or QuickBooks Online.

#### FIN-001 — QuickBooks Online sync.

The owner connects QuickBooks Online and maps each fund to an income account and class (or location), fees to an expense account, and the Stripe and checking accounts. Coffer posts one deposit per payout and per check batch with lines per fund and a fee line, so each deposit matches the bank feed; refunds and disputes post as their own entries. Posts are idempotent, a failed post retries and is shown, and nothing posts twice.

*Acceptance:* An HTTP journey with the QuickBooks Online edge faked maps three funds, posts a payout and a check batch, replays the post without a duplicate, and reads deposits whose lines and totals equal Coffer's.

*Status:* partial. Mapped fund, bank and fee accounts export as a balanced QBO journal CSV with fund classes; Desktop IIF is separate. No QBO OAuth/API connection or check-batch posting yet. Evidence: `src/coffer/payments/exports.ts`, `tests/payments.test.mjs`.

#### FIN-002 — Pantry sync.

The same mapping and deposit posting as `FIN-001` into Pantry, Run Edit Run's accounting product, through its API, so a nonprofit on Pantry reconciles donations without a spreadsheet.

*Acceptance:* An HTTP journey with the Pantry edge faked posts a payout and a check batch and reads matching deposits.

*Status:* partial. Paid matched USD payouts become evidence-backed Pantry journal proposals; human Pantry approval posts the deposit, and Coffer refresh records its journal ID. Saved submission claims prevent duplicate or uncertain resends. Check batches remain outstanding; live Stripe-to-Pantry acceptance needs a USD-settling Stripe test account. Evidence: `src/coffer/payments/pantry.ts`, `tests/payments.test.mjs`, `docs/PAYMENTS.md`.

#### FIN-003 — Restricted funds.

Funds are marked restricted (purpose or time) or unrestricted; restricted gifts carry the restriction to accounting, and a release-of-restriction report shows what was given, spent (entered or synced from accounting) and still held per restricted fund.

*Acceptance:* An HTTP journey records restricted and unrestricted gifts, enters a spend against a restricted fund, and reads the release report.

*Status:* partial. Every gift has a free-text fund (default Unrestricted); payout fund names map to accounting accounts through installation settings. Restriction types and release reports remain outstanding. Evidence: `src/coffer/gifts.ts`, `src/coffer/payments/pantry.ts`.

#### FIN-004 — Journal export for other ledgers.

Nonprofits on QuickBooks Desktop, Xero, Aplos or Sage Intacct download the same deposits as a journal file (IIF, CSV) per period with their account and class mapping.

*Acceptance:* An HTTP journey downloads a month's journal and checks its totals by account against the ledger.

*Status:* partial. Each reconciled payout exports a mapped journal CSV or Desktop IIF. A combined per-period download remains outstanding. Evidence: `src/coffer/payments/exports.ts`, `tests/payments.test.mjs`.

#### FIN-005 — Reconciliation report.

For any period Coffer shows gifts in the ledger, money received by the processor, payouts deposited and amounts posted to accounting side by side by fund, with every difference listed and explained (pending ACH, unposted batch, refund after payout).

*Acceptance:* An HTTP journey builds a month with a pending ACH gift and a refund after payout and reads a report whose listed differences account for every cent.

*Status:* partial. Per-payout gifts, refunds, fees, net, match difference and Pantry destination/journal ID are visible. Period-wide ledger/processor/deposit reconciliation including pending ACH and check batches remains outstanding. Evidence: `src/coffer/payments/ui.ts`, `src/coffer/payments/payouts.ts`, `tests/payments.test.mjs`.

### Receipts and acknowledgements

Every donor is thanked and receipted, correctly for US tax rules, and Coffer knows it arrived.

#### RCPT-001 — Immediate email receipts.

Every online gift gets an emailed receipt within a minute from the nonprofit's verified domain, with the form's or campaign's thank-you text, the IRS language of `RCPT-005` and a PDF. Receipts are transactional: they are sent even to donors who unsubscribed from appeals. Offline gifts get one when the batch closes, if the admin turns that on.

*Acceptance:* An HTTP journey with the mail and DNS edges faked shows the sending domain unverified until its SPF and DKIM records check, then gives online and reads one receipt message from that domain with the right amount, statement and PDF within a minute; a donor who withdrew email consent for appeals still receives it; with the batch setting on, closing a batch of three offline gifts sends a receipt for each gift with an email address, and with it off sends none.

*Status:* partial. Every paid online gift's receipt is emailed from install SendGrid as soon as the gift is recorded, at any amount, unless Letter settings hold online receipts for approval; local and demo mode mark it not emailed. Domain verification and attached PDFs remain unbuilt. Managed integrations are not available yet. Evidence: `src/coffer/giving/online-receipt.ts`, `src/coffer/receipt-mail.ts`, `tests/giving.test.mjs`, `tests/receipts.test.mjs`.

#### RCPT-002 — Acknowledgements delivered by email.

An approved acknowledgement batch (`ACK-001`) is sent by email from Coffer to every recipient with an address, one message per letter, through the installation's mail provider; the rest go to print (`RCPT-003`). The batch is sent only after approval of its exact hash, and its status is the delivery result, not a person's assertion.

*Acceptance:* An HTTP journey with the mail edge faked approves a batch of three letters, sends it, and reads two delivered emails and one letter routed to print, with the batch status computed from delivery.

*Status:* done. Approved frozen batches send once per letter through self-hosted SendGrid, route donors without an address or with a known receipt bounce/complaint to print; marketing withdrawals still receive receipts, and show submitted versus signed provider delivery results. RER Managed sending is not available yet. Evidence: `src/coffer/letter-delivery.ts`, `tests/receipts.test.mjs`.

#### RCPT-003 — Print-ready letters, labels and envelopes.

Letters render to a print-ready PDF on letterhead (one per page, window-envelope address placement), with mailing labels (Avery 5160) and #10 envelopes, and a Word mail-merge file for nonprofits that prefer it, grouped one piece per gift, constituent or household (`RCPT-009`). Optional sending through Lob prints and mails them and records USPS tracking events. A person can also produce a single letter, with its label and envelope, for one constituent from their record with any template, and it is logged on their timeline.

*Acceptance:* An HTTP journey downloads the PDF, labels and merge file for a batch and checks page count, addresses and placement; with the Lob edge faked the batch is mailed and tracking events land on each donor's timeline; a single letter produced from one donor's page renders with that donor's envelope name and salutation and is logged on the timeline.

*Status:* partial. Single and batch print-styled US Letter documents support window-envelope placement and browser Save as PDF alongside CSV. Labels, envelope-only layouts, Word files, household grouping and Lob remain unbuilt. Evidence: `src/coffer/ui/print-letters.ts`, `tests/receipts.test.mjs`.

#### RCPT-004 — Year-end giving statements.

In January Coffer prepares one statement per donor, or per household as `RCPT-009` sets out, for the prior calendar year listing each gift, its goods-or-services value and deductible part, excluding DAF grants and soft credits, for approval; then emails it, routes no-email donors to print, and publishes it in the donor portal. A deceased donor's statement is addressed to the surviving household member or waits for a person (`DONOR-012`). For a year that spans the switch, the statement lists the imported gifts too, each with its deductible part taken as its amount less its imported goods value (`MOVE-001` to `MOVE-006`); only an imported gift whose source held no goods answer waits for a person. Donors can request a copy any time; corrections reissue with the change shown. A solicitation restriction never stops a statement (`DONOR-015`).

*Acceptance:* An HTTP journey approves and sends statements for donors with one-time, monthly and event gifts, reads each statement's gift lines and totals, and downloads one from the portal; a donor requests a copy from the portal and receives it; a gift corrected after sending reissues that statement marked as corrected with the change shown; a household run reads one statement for two spouses; and after the `MOVE-002` import a migration-year statement lists the imported $150 gala payment with $60 of goods and $90 deductible beside a gift given in Coffer.

*Status:* partial. Per-donor calendar-year statements itemize all unreversed gifts including imported gifts, goods values and deductible totals, then use approved email or print delivery. Unknown goods answers require review. Portal requests, automatic January scheduling, household grouping, deceased-recipient rules and corrected reissues remain unbuilt. Evidence: `src/coffer/year-end.ts`, `tests/receipts.test.mjs`.

#### RCPT-005 — US receipt rules.

Receipt templates must state the organization's name and EIN, the amount or a description of non-cash property, the date, and whether goods or services were provided with their good-faith value. Coffer applies the $250 written-acknowledgement rule, the quid pro quo disclosure for any payment over $75 that is partly a contribution, the token-benefit exception at the IRS's current inflation-adjusted figures (a setting), and intangible religious benefit wording for religious organizations.

*Acceptance:* An HTTP journey receipts a $250 gift, an $80 ticket with $50 of dinner (disclosure required though under $250), a gift with a token mug, and a non-cash gift, and checks each statement against the rule it exercises; with the organization set as religious, a $300 gift whose donor received only an intangible religious benefit is receipted with the statement that the benefit was solely intangible religious benefit and no value.

*Status:* partial. Templates must carry donor, amount, date, organization and the goods-or-services statement, and the $250 threshold works; no quid pro quo rule for payments over $75, token-benefit or religious-benefit wording. Evidence: `src/coffer/settings.ts`, `src/coffer/acknowledgements.ts`, `tests/coffer.test.mjs`.

#### RCPT-006 — Delivery tracking.

Every receipt, acknowledgement and statement keeps its delivery result from the provider: delivered, bounced, complained, opened where tracked, and for mail the print vendor's events. A bounce opens a task to fix the address and offers print instead; the donor page shows each document's delivery.

*Acceptance:* An HTTP journey with the mail edge faked sends three receipts, one bounces, and the bounced one shows on the donor page with a task and a print option.

*Status:* partial. Signed SendGrid delivered, bounce, dropped and complaint events are recorded per letter, deduplicated and shown on donor and batch; negative results route the donor to print. Configure the signed provider webhook and verification key, or explicitly fetch events with SendGrid Email Logs access. Open tracking, address-fix tasks and print-vendor events remain unbuilt. Evidence: `src/coffer/letter-delivery.ts`, `tests/receipts.test.mjs`.

#### RCPT-007 — Thank-you templates.

Admins keep several reviewed templates: per form and campaign, first gift, recurring start, major gift, tribute, in-kind and year-end. Each template is checked for the required receipt facts before it can be used, merges the fields `RCPT-010` lists, and its version is recorded with every message sent.

*Acceptance:* An HTTP journey saves a first-gift template, refuses one missing the goods-or-services statement, gives a first and a second gift, and reads the different templates and their versions on each receipt.

*Status:* partial. One reviewed letter template with required facts exists; no templates per form, campaign or gift type. Evidence: `src/coffer/settings.ts`, `tests/coffer.test.mjs`.

#### RCPT-008 — Corrected and voided receipts.

When a gift is reversed, refunded, split differently or reassigned, its receipt is voided or reissued with a corrected copy that says what changed, and the donor is told when a corrected receipt is sent. Receipt numbers are sequential per year and never reused.

*Acceptance:* An HTTP journey refunds half a receipted gift and reads a corrected receipt with the next number referencing the original, and a voided one for a fully reversed gift.

*Status:* missing. No receipt numbering, voiding or reissue.

#### RCPT-009 — One piece per household.

Every print and mail run (a mail appeal file or Lob send under `COMM-007`, an acknowledgement batch under `ACK-001` and `RCPT-003`, and the year-end statement run under `RCPT-004`) has a "one piece per" setting of gift, constituent or household, defaulting to household for appeals and statements. A household piece is addressed with the household addressee and formal or informal salutation (`DONOR-003`), merged as the household fields of `RCPT-010`, to the household's verified address, and lists the gifts of all its members with a gift two members share (hard credit to one, soft credit to the other) counted once. For an appeal, a household piece needs at least one member with current mail consent and is addressed to the consenting members only when another member has withdrawn; members at a different address get their own piece. Email receipts stay per donor. Recipient counts, exclusions and postage estimates show the piece count after grouping.

*Acceptance:* An HTTP journey with two consenting spouses at one address, a gift from each and a joint gift hard-credited to one and soft-credited to the other prepares a mail appeal and a year-end statement run per household, and reads one piece each addressed with the household addressee and salutation, with a statement total that counts the joint gift once; the same runs set per constituent read two pieces each.

*Status:* missing. Letters and appeal exports are one row per gift or per donor; no household grouping, addressee or combined totals.

#### RCPT-010 — Merge fields in every template.

Every template that renders donor-facing text merges from one published list of fields, each written `{{field}}`. That covers receipts and acknowledgements (`ACK-001`, `RCPT-001`, `RCPT-002`, `RCPT-007`), year-end statements (`RCPT-004`), single letters and mail files (`RCPT-003`, `COMM-007`), and journey and pledge-reminder emails (`STEW-003`, `STEW-004`). The list holds: prefix, first, middle and last name, suffix, nickname, informal and formal salutation and envelope name (`DONOR-014`); recognition name (`GIFT-011`); household addressee and salutations (`DONOR-003`), used in place of the person's on a household piece (`RCPT-009`); the primary or chosen email and postal address (`DONOR-013`); gift amount, date, fund, campaign, appeal, deductible amount, goods statement, tribute and soft-credit names; giving summary figures (`DONOR-011`); organization name and EIN; and every custom field on the constituent, gift or interaction as `{{custom.<field key>}}` (`DONOR-005`). The template editor lists the fields and inserts them, and a template naming an unknown field is refused on save. A salutation or name field that is empty on a record falls back to the formal salutation, then to an admin-set greeting ("Friend"), never to a blank; any other field may carry a default in the template (`{{custom.board_term|our board}}`), and before a batch is approved Coffer lists every record that would still print a blank. The same list is the merge-field set synced to Mango, Mailchimp and Constant Contact (`COMM-002`, `COMM-003`).

*Acceptance:* An HTTP journey reads the published field list from the API; saves a template using `{{informal_salutation}}`, `{{envelope_name}}`, `{{household_addressee}}` and a custom constituent field with a default; refuses a template with an unknown field; renders a batch in which a donor lacking the custom field gets the template default and a donor lacking an informal salutation gets the formal one; and reads the pre-approval list naming a record whose field without a default is empty.

*Status:* partial. Letter templates merge a fixed list of nine fields (date, donor name, amount, gift date, fund, goods statement, organization, EIN, deductible amount) and are refused for unknown, missing required or unclosed fields; no name parts, salutations, household, contact-point, giving-summary or custom fields, no fallbacks, field list API or blank check. Evidence: `src/coffer/settings.ts`, `tests/coffer.test.mjs`.

#### RCPT-011 — Acknowledgement status on every gift and soft credit.

Every gift and every soft credit (`GIFT-006`) has one acknowledgement status: acknowledged, with its date, method (email, letter, phone call, in person, handwritten note, other) and the letter, email or interaction that did it; not acknowledged; or do not acknowledge, with a reason (for example payroll gifts from board members or an internal transfer). Delivering an email receipt or acknowledgement (`RCPT-001`, `RCPT-002`), recording a printed batch sent (`ACK-001`, `RCPT-003`) or sending a journey thank-you step (`STEW-003`) sets it to acknowledged with that message linked. A person can set it by hand from the gift, from the donor page, or while logging a call, meeting or note on the timeline (`DONOR-004`), which links that interaction; marking a gift acknowledged needs the fundraiser role and marking it do not acknowledge the role `TEAM-001` allows (default: admin), and every change, including back to not acknowledged, is in the audit log (`TEAM-003`). Only a gift that is not acknowledged and was received on or after the acknowledge-from date (`MOVE-007`) is ever due or overdue under `ACK-001`, counted in the acknowledgement queue or picked up by `DEV-003`. Soft credits are listed in the queue for their credited constituent only when the admin turns on thanking soft-credited constituents (default off). The status, its date, method and link show on the gift, the donor page and the timeline, can be filtered on in saved lists and reports (`DONOR-007`, `REPORT-004`) and are read and written through the API (`API-001`). The importers carry each source's status (`MOVE-001` to `MOVE-006`).

*Acceptance:* An HTTP journey records a new $1,000 gift, and a fundraiser logs a thank-you call on its donor and marks the gift acknowledged by phone call from it: the gift leaves the acknowledgement queue with the call linked and the change in the audit log. An admin marks another $500 gift do not acknowledge with a reason, and it is never due as the test clock passes the target days, while a data-entry user is refused the same change. A soft credit on a $2,000 gift is marked acknowledged by handwritten note separately from the hard-credit gift, and with the soft-credit setting on, an unacknowledged soft credit appears in the queue for its credited constituent. Recording a prepared batch as sent reads each of its gifts as acknowledged by letter with the batch linked, and a saved list of not-acknowledged gifts over $250 returns only the gifts still waiting.

*Status:* partial. A gift is due until it sits in a live letter batch, and the donor page shows each gift's letter state (prepared, approved, exported, sent) or "Letter due"; there is no stored acknowledgement status, method or link, no way to mark a gift acknowledged outside a batch or do not acknowledge, no status on soft credits, and no imported status. Evidence: `src/coffer/donors.ts`, `src/coffer/ui/donors.ts`, `src/coffer/acknowledgements.ts`, `tests/coffer.test.mjs`.

### Communication

Appeals and donor conversations actually go out, through the sender the nonprofit already uses, and replies come back.

#### COMM-001 — Preferences and unsubscribes everywhere.

Consent covers email, postal mail, SMS and phone, with frequency preferences (at most one appeal a month or a quarter per channel) and topic subscriptions (newsletter, appeals, events). Every marketing email carries a one-click unsubscribe; unsubscribes and preference changes from the donor portal, Mango, Mailchimp, Constant Contact and Twilio arrive as new consent rows with their source, and every send in Coffer checks the current answer. Topics apply on every channel, not only marketing email: an email, mail or SMS appeal and a journey step or call task marked as an ask check the appeals topic, a newsletter checks the newsletter topic and an event invitation the events topic. Whether a donor may be asked for money at all is the solicitation restriction (`DONOR-015`), which every ask path checks as well.

*Acceptance:* An HTTP journey with sender edges faked has a donor unsubscribe in Mailchimp, reply STOP by text and change topics in the portal, and the next appeal of each channel excludes them with the reason; a donor who chose at most one appeal email a month is excluded from a second appeal that month with the reason "frequency"; a donor who left the appeals topic but kept the newsletter is excluded from a mail appeal with the reason "topic" and included in the next newsletter.

*Status:* partial. Email provider opt-outs append withdrawals and Coffer email withdrawals synchronize to Mango or Mailchimp; each marketing submission checks both sides. Receipts remain transactional. SMS/phone, topics, frequency preferences and other providers remain. Evidence: `src/coffer/communications/preferences.ts`, `tests/communications.test.mjs`, `tests/receipts.test.mjs`, `docs/COMMUNICATIONS.md`.

#### COMM-002 — Appeals sent through Mango or Mailchimp.

Coffer syncs consenting constituents into Mango (Run Edit Run's email product) or Mailchimp as an audience with merge fields for the name parts, informal and formal salutation and envelope name (`DONOR-014`), giving figures and chosen custom fields (`RCPT-010`), and tags; an approved appeal (`APPEAL-001`) is created there as a campaign to exactly the frozen audience, sent on approval or schedule, and its sends, bounces, opens, clicks and unsubscribes return to each donor's timeline. Donation links carry the appeal's source code so resulting gifts are attributed. An appeal is an ask: constituents with a solicitation restriction are left out of its audience with the reason "do not solicit" unless a person includes one for that run (`DONOR-015`); a newsletter send marked as not an ask includes them.

*Acceptance:* An HTTP journey with the Mango and Mailchimp edges faked syncs an audience whose members carry the informal-salutation, envelope-name and a custom-field merge field, sends an approved appeal to exactly its frozen recipients, receives results and an unsubscribe, and attributes a gift made from the tracked link; a second appeal approved with a send time is created on the edge as a campaign scheduled for that time and sent only when the test clock reaches it; a do-not-solicit donor with email consent is absent from both appeal campaigns and present in a newsletter campaign.

*Status:* partial. The owner connects Mango (scoped integration credential) or Mailchimp (API key and audience picker) on `/app/appeals/connect`; the connection lives in Coffer's database and is checked before saving. An approved appeal's consenting recipients join a Mango integration list named after the appeal, carrying Coffer's consent evidence and name, and a Mango operator approves the campaign for that list; Mailchimp gets one checked one-recipient segment campaign per donor with results back. Opt-outs flow both ways. Mailchimp remains fixture-only (no account). Name-part/custom-field merges beyond the name, tags, engagement/attribution, scheduled appeals and solicitation restrictions remain. Evidence: `src/coffer/communications/connect.ts`, `src/coffer/communications/mango.ts`, `src/coffer/communications/mailchimp.ts`, `tests/communications.test.mjs`, `docs/COMMUNICATIONS.md`, `docs/appeals.md`.

#### COMM-003 — Constant Contact.

The same audience sync, campaign send and results return as `COMM-002` through Constant Contact's v3 API, for nonprofits already on it, with the same "do not solicit" exclusion from asks (`DONOR-015`).

*Acceptance:* An HTTP journey with the Constant Contact edge faked syncs, sends and receives results, and the appeal audience excludes a do-not-solicit donor with that reason.

*Status:* missing. No Constant Contact connection.

#### COMM-004 — One-to-one email and mailbox logging.

Staff connect Gmail or Microsoft 365; messages to and from known constituents are logged on their timelines (subject, excerpt, link), and staff write personal emails from the donor page that send from their own mailbox. A BCC address logs mail from any client.

*Acceptance:* An HTTP journey with the Gmail and Microsoft Graph edges faked logs a received and a sent message on the right donor, sends a personal email from the donor page, and logs one through the BCC address.

*Status:* missing. No mailbox connection or personal email.

#### COMM-005 — Replies reach the right person.

Replies to receipts, acknowledgements and appeals arrive at a Coffer inbound address (Cloudflare Email Routing), are logged on the donor's timeline and assigned to the donor's relationship manager as a task; out-of-office replies are recognised and filed, and a reply that asks to stop is proposed as a consent withdrawal for one click to confirm.

*Acceptance:* An HTTP journey with inbound mail faked receives a thank-you reply, an out-of-office and a "please remove me", and sees a task for the manager, a filed auto-reply and a proposed withdrawal.

*Status:* partial. The actual Email Routing handler logs known-donor replies, assigns and forwards to an active prospect owner (or the installation owner), files automatic replies, and exposes follow-up tasks. Live routing was proven on 17 October 2026 (an Email Routing rule to a hosted Worker turned a donor’s appeal reply into a task for the prospect owner); forwarding a copy needs the assignee verified as an Email Routing destination, and proposed stop-request withdrawals remain. Evidence: `src/coffer/communications/replies.ts`, `src/coffer/communications/replies-ui.ts`, `docs/COMMUNICATIONS.md`.

#### COMM-006 — SMS outreach.

Thank-you and reminder texts through Twilio from a registered 10DLC number, only to donors with SMS consent, within quiet hours (8 a.m. to 9 p.m. in the donor's time zone), with STOP and HELP handled and replies logged and assigned. Text appeals go the same way and are asks: a donor with a solicitation restriction is excluded from them with the reason (`DONOR-015`), while their thank-you and pledge reminder texts still go.

*Acceptance:* An HTTP journey with the Twilio edge faked sends a thank-you text, holds one scheduled at 10 p.m. donor time until morning, records a reply as a task and a STOP as withdrawn consent; a text appeal excludes a do-not-solicit donor with that reason while their thank-you text still sends.

*Status:* missing. No SMS.

#### COMM-007 — Direct mail appeals.

A mail appeal produces a mail-house file (or a Lob send) with one piece per household or per constituent (`RCPT-009`), each with its household or personal addressee and salutation (`DONOR-003`, `DONOR-014`), a verified address (undeliverable, inactive and deceased records excluded with their reason, `DONOR-009`, `DONOR-012`, and constituents with a solicitation restriction excluded under "do not solicit", `DONOR-015`), ask amounts based on last gift, and a response code per piece; returned reply cards and gifts entered with that code attribute to the appeal, and mailing history is kept per donor.

*Acceptance:* An HTTP journey prepares a mail appeal with ask amounts and codes, reads each piece's envelope name and salutation, enters two coded reply gifts in a batch, and reads the appeal's response rate and the mailing on each donor; a do-not-solicit donor with mail consent gets no piece and is counted under that reason.

*Status:* partial. Mail-channel audiences with postal addresses export as CSV; no ask amounts, response codes or mailing history. Evidence: `src/coffer/appeals.ts`, `tests/coffer.test.mjs`.

#### COMM-008 — Appeal results.

Each appeal shows recipients, delivered, opened, clicked, responded, gifts, dollars, average gift, cost and return, with a comparison to earlier appeals, from the ledger and the sender results.

*Acceptance:* An HTTP journey runs an email and a mail appeal with gifts from each and reads results that match the ledger and sender events.

*Status:* missing. No appeal results.

### Stewardship and follow-up

Every donor gets the next touch, and the team knows who owes it.

#### STEW-001 — Tasks with owners and reminders.

Tasks (call, meeting, thank-you, follow-up, data fix) are assigned to a person with a due date and a linked constituent, gift or opportunity; a task overdue by the escalation delay (a setting, default two business days) escalates to the assignee's manager as set in `TEAM-001`, or to the owner when none is set, on the manager's daily list and reminder; each person has a daily list and email or Nook and Slack reminders. Completing a task logs it on the timeline.

*Acceptance:* A browser journey assigns a thank-you call due tomorrow, receives the reminder, completes it with a note that lands on the timeline, lets a second task go overdue past the delay and sees it on the assignee's manager's list and reminder, and sees a third, assigned to a person with no manager, escalate to the owner.

*Status:* partial. Owned, dated call tasks from lapses and unpaid due pledge installments support assignment, reassignment, snooze and atomic donor-timeline call completion. Recurring tasks, reminders, escalation and other task kinds remain. Evidence: `src/coffer/call-tasks.ts`, `src/coffer/ui/call-tasks.ts`, `tests/pipeline.test.mjs`.
#### STEW-002 — Recurring tasks.

A task can repeat (quarterly board-member check-in, monthly donor-retention review); the next one is created when the last is completed or its due date passes.

*Acceptance:* An HTTP journey completes a quarterly task and reads the next one dated three months on.

*Status:* missing. No tasks.

#### STEW-003 — Stewardship journeys.

Admins build journeys triggered by first gift, recurring start, a gift over an amount, giving anniversary, lapse (no gift in twelve months), event attendance or joining a list. Steps send email (personal-style through `RCPT-001`'s path or marketing through Mango or Mailchimp), create tasks, wait, and branch on whether the donor gave or replied; a donor leaves when they give, unsubscribe, are moved or become inactive or deceased (`DONOR-012`). Each step is marked as an ask or not: an ask step skips a constituent with a solicitation restriction under the reason "do not solicit" and the donor carries on to the next step that is not an ask (`DONOR-015`). A journey runs only after a person publishes it, enrollment is visible per donor, and a frequency cap applies across journeys.

*Acceptance:* An HTTP journey with sender edges faked publishes a three-step first-gift welcome, enrols a new donor, advances time through each step, and sees the donor leave when they give again; a gift-over-$1,000 journey enrols a donor when a $1,500 gift arrives, and a lapse journey enrols a donor whose last gift passes twelve months on the test clock; a second journey respects the frequency cap; a do-not-solicit donor enrolled in a journey receives its thank-you step and skips its ask step with that reason.

*Status:* partial. A person publishes the first-gift thank-you, impact and second-ask series. Durable due steps run through the provider on the minute Worker scheduler; another gift, unavailable email consent, merge or erasure stops pending work. Other triggers, branches, frequency caps, inactive/deceased statuses and solicitation restrictions remain. Evidence: `src/coffer/communications/welcome.ts`, `docs/COMMUNICATIONS.md`.

#### STEW-004 — Pledge reminders and invoices.

Before each installment is due Coffer sends the donor a reminder or invoice (email with a pay link, or print), records it, and after the due date follows up on a schedule and opens a task for the relationship manager. A reminder for a pledge the donor made is not an ask and still goes to a donor with a solicitation restriction (`DONOR-015`).

*Acceptance:* An HTTP journey creates a quarterly pledge, receives the reminder a week before an installment, pays through the link, and lets the next installment go overdue to see the follow-up and task; a do-not-solicit donor's installment reminder still goes.

*Status:* partial. Self-hosted SendGrid reminders run daily or by staff before each unpaid installment using current email permission, with durable single-attempt submission states. Managed email is not available yet. Unpaid due installments now feed the owned call list. Pay links, printable invoices and automatic overdue follow-up remain. Evidence: `src/coffer/pledges.ts`, `src/server.ts`, `tests/pledges.test.mjs`.

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

*Acceptance:* A browser journey creates three opportunities for two managers and two campaigns, filters the board by manager, by stage and by campaign and sees only the matching opportunities each time, moves one through to solicit, closes it won with a pledge, and reads a pipeline total that excludes the closed amount from the forecast.

*Status:* partial. Identify, qualify, cultivate, ask and stewardship opportunities carry ask amount, expected close, owner and next step; lists filter by owner and stage. Configurable stages, probability, campaign/fund forecasts and closed-won gift linkage remain. Evidence: `src/coffer/major-gifts.ts`, `src/coffer/ui/major-gifts.ts`, `tests/pipeline.test.mjs`.
#### MAJOR-002 — Portfolios and moves.

Each major-gift prospect has a relationship manager and a portfolio; Coffer counts each manager's moves (meaningful contacts) per period, flags prospects with no contact in a set number of days, and shows portfolio size, pipeline and dollars raised per manager.

*Acceptance:* An HTTP journey assigns two portfolios, logs contacts on some prospects, and reads moves counts and a flagged list of untouched prospects per manager.

*Status:* partial. Opportunities have staff owners, next steps and engagement inputs from recorded contacts. Portfolio definitions, manager moves reporting and untouched-prospect flags remain. Evidence: `src/coffer/major-gifts.ts`, `tests/pipeline.test.mjs`.
#### MAJOR-003 — Action plans and proposals.

A cultivation plan is a template of steps (tour, lunch with the board chair, proposal, ask) applied to an opportunity as dated tasks; proposals are drafted and attached, sent, and their response recorded.

*Acceptance:* An HTTP journey applies a four-step plan to an opportunity, completes two steps, attaches a proposal and records it as sent.

*Status:* missing. No plans or proposals.

#### MAJOR-004 — Engagement and retention scores.

Every constituent gets a transparent engagement score from recency, frequency and amount of giving plus opens, replies, events, volunteering and meetings, and a retention-risk flag; the formula with its current weights is shown on the scores settings page (and returned by its API), each donor's contributing factors are shown on the donor page, and the weights are an admin setting.

*Acceptance:* An HTTP journey builds donors with different histories and reads scores and factors that follow the formula as read from the scores settings page and its API, then changes a weight and sees the scores change.

*Status:* partial. Prospect scores expose recency, frequency, amount and conversation inputs with their points and the full fixed formula. Configurable weights, broader engagement sources and scores on every constituent remain. Evidence: `src/coffer/major-gifts.ts`, `src/coffer/ui/major-gifts.ts`, `tests/pipeline.test.mjs`.
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

*Status:* partial. Calendar-year retained, new, lapsed and recaptured counts and net amounts drill to every underlying donor; signed adjustments and erased identities reconcile to the contribution ledger. Fiscal years, list/fund/campaign filters and upgraded/downgraded cohorts remain. Evidence: `src/coffer/retention.ts`, `src/coffer/ui/retention.ts`, `tests/pipeline.test.mjs`.
#### REPORT-002 — LYBUNT and SYBUNT lists.

Donors who gave last year but not this year (LYBUNT) and some year but not this year (SYBUNT), with last gift and amount, as lists that feed appeals, journeys and call tasks.

*Acceptance:* An HTTP journey reads both lists for a built history and sends the LYBUNT list to an appeal.

*Status:* partial. LYBUNT and earlier-year SYBUNT lists show reasons, last gifts and annual amounts at risk, with stopped monthly-plan flags and owned call creation. Direct appeal and journey enrollment remain. Evidence: `src/coffer/lapses.ts`, `src/coffer/ui/lapses.ts`, `tests/pipeline.test.mjs`, `tests/giving.test.mjs`.
#### REPORT-003 — Fundraising dashboards.

A home dashboard and report pages show raised this fiscal year against last and goal, by fund, campaign, appeal, form, channel and month, with recurring revenue, new donors, retention and pipeline; every number opens to its gifts.

*Acceptance:* A browser journey at 1440 and 390 pixels reads the dashboard for a built year and opens a fund total to the gifts that make it; it reads raised by campaign and by month against last year and the goal, each figure equal to the ledger.

*Status:* partial. Today shows the current calendar year's total and acknowledgement backlog; no breakdowns, goals, comparisons or drill-down. Evidence: `src/coffer/ui/home.ts`.

#### REPORT-004 — Report builder.

Staff build reports on constituents, gifts, pledges, opportunities and interactions with columns, filters, grouping and totals on any field, custom fields included (`DONOR-005`), save and share them, and export CSV or Excel (.xlsx). A saved definition can be edited later and exported as a JSON file that imports into another Coffer installation.

*Acceptance:* An HTTP journey saves a gifts-by-fund-by-month report, shares it with a member, and exports it as CSV and .xlsx with the same rows and totals that match the ledger; it then adds a column to the saved definition, exports the definition as JSON, imports it into a second installation and gets the same totals there.

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

#### REPORT-008 — Raised by state.

For any fiscal or calendar year, a report sums gifts by the donor's US state at the gift date (from the address history of `DONOR-009`), with donors, gifts and dollars per state, separate rows for foreign and unknown addresses, organizations by their own address, and filters for fund, campaign, form and channel. Its rows sum to the ledger for the period, and it exports as CSV for state charitable-solicitation registrations and renewals.

*Acceptance:* An HTTP journey records gifts from donors in three states, one with no address and one who moves state mid-year, and reads a by-state report for the year whose rows assign each gift to the state at its date and sum to the ledger total, then exports it as CSV.

*Status:* missing. Each donor stores a current state, but there is no address history or report by state.

### Moving in

A buyer of each named incumbent moves in with full history, checked before the switch.

#### MOVE-001 — From Little Green Light.

Coffer reads Little Green Light's exports (constituents with all fields, including name parts, short and long salutations and addressee (`DONOR-014`), every custom field and category with its definition and values (`MOVE-010`), and every email, phone and address with its type and primary flag, gifts with funds, campaigns and appeals, split and soft-credit details, pledges and installments, relationships and households, notes and contact reports, groups and categories, memberships, volunteer time, mailing history, email preferences, communication preferences and tags (such as do not mail, do not call, do not solicit, each mapped in the preview to a channel withdrawal, a solicitation restriction or limit (`DONOR-015`), a tag or skip, with the mapping saved), tribute details on gifts (in honor or in memory, with the person notified, `GIFT-008`), constituent status with date of death, and recurring gifts with their LGL Forms or processor customer, card and bank account references for `MOVE-009`) with a saved mapping, previews without writing, applies the reviewed plan and can undo, as `IMPORT-001` does for Stripe. Each gift and soft credit also carries its acknowledgement status with its date, method and linked letter, email or interaction (`RCPT-011`) and its non-deductible (goods or services) amount as the gift's goods answer (`GIFT-001`): a gift with an acknowledgment template assigned imports as acknowledged by letter on its acknowledged date with that template named, a gift marked "do not acknowledge via LGL" as do not acknowledge, any other gift as not acknowledged, and the gift amount less its deductible amount sets the goods value. A non-deductible amount above zero imports as goods provided with that value, a recorded zero as no goods or services, and only a gift whose source holds no answer is imported as unknown, so imported gifts are not held under `ACK-001`'s unknown-goods rule.

*Acceptance:* An HTTP journey imports a fixture LGL export set, previews counts and totals by year and fund, applies, reads a donor's full history with relationships, soft credits and notes, carries a constituent's three emails and two addresses with their types and primaries, carries its salutations and addressee unchanged, reads the fixture's custom fields and categories defined in Coffer with each record's values (`MOVE-010`), carries a $500 gift with an assigned acknowledgment template as acknowledged with that template named, a $500 gift marked "do not acknowledge via LGL" as do not acknowledge and a recent $500 gift with neither as not acknowledged, so only that gift is due in the acknowledgement queue, maps a "Do not solicit" communication tag to the restriction and a "No mail" tag to mail consent no with source Little Green Light and the import date, so the next appeal excludes each with its reason, reads a memorial tribute's total equal to the source, and undoes.

*Status:* partial. Documented LGL CSV/XLSX constituent and fundraising exports up to 16 MB and 100,000 rows preview donors, households (explicit, or spouses and people at one mailing address; never merged by name), gifts, funds/campaigns, relationships, soft credits, pledges/installments and notes in one fundraising report, with source controls, part-by-part apply (about 800 records per transaction, resumable), a totals check from Coffer's own gifts after the last part, re-import, year-by-year move-ins that find earlier donors and pledges by LGL ID, and undo. Every blocking row is listed (paged, filterable, CSV) and the review plans every part against Coffer before apply; a 5,000-constituent, 40,000-gift LGL export with shared spouse emails, soft credits and pledges reconciles to the cent locally and hosted. Full multi-contact/name/custom-field, consent/restriction, acknowledgement, tribute and recurring-vault migration remains outside this export implementation. Evidence: `src/coffer/move-in/service.ts`, `src/coffer/move-in/plan.ts`, `src/coffer/ui/crm-move-in.ts`, `tests/move-in.test.mjs`, `docs/MOVE-IN-SOURCES.md`.

#### MOVE-002 — From Bloomerang.

Coffer reads Bloomerang through its REST API with the nonprofit's key (or its exports): constituents with name parts (Name Title, first, middle and last name, Name Suffix) and their Informal, Envelope and Recognition Names (`DONOR-014`, `GIFT-011`) and every email, phone and address and its type and primary flag, custom field definitions and values at the constituent, transaction, interaction and note levels (`MOVE-010`), households, relationships, transactions with designations (fund, campaign and appeal) and tribute names (`GIFT-008`), soft credits, pledges, recurring donation records with their Bloomerang Payments customer, card and bank account references for the transfer (`MOVE-009`), interactions, notes, tasks, communication preferences, the Communication Restrictions field (Do Not Mail becomes mail consent no, Do Not Call becomes phone consent no and Do Not Solicit becomes the do-not-solicit restriction (`DONOR-015`), each stamped with source Bloomerang and the import date) and constituent status (active, inactive, deceased with date), with the same preview, apply and undo. Each gift and soft credit also carries its acknowledgement status with its date, method and linked letter, email or interaction (`RCPT-011`) and its non-deductible (goods or services) amount as the gift's goods answer (`GIFT-001`): Bloomerang's Acknowledged? value on each payment and soft credit imports as acknowledged (with its acknowledgement date and the linked acknowledgement interaction), not acknowledged or do not acknowledge, and its Non-deductible amount sets the goods value. A non-deductible amount above zero imports as goods provided with that value, a recorded zero as no goods or services, and only a gift whose source holds no answer is imported as unknown, so imported gifts are not held under `ACK-001`'s unknown-goods rule.

*Acceptance:* An HTTP journey with the Bloomerang edge faked imports a fixture account, reads totals by year and designation, by campaign and by appeal equal to the source (so `REPORT-002` LYBUNT and `COMM-008` appeal results start from the imported history), reads a memorial tribute's total equal to the source, carries a constituent's three emails and two addresses with their types and primaries, finds a donor by its Bloomerang account number, carries a constituent's Informal Name and Envelope Name unchanged, carries the fixture's pick-one and pick-many constituent fields, currency transaction field and text interaction field with their types, pick lists and values (`MOVE-010`), and reads from the same fixture a household with its members, a spouse relationship, a soft credit on the soliciting board member, an open pledge with its balance, an interaction, a note, an open task with its owner and an email-opted-out donor whose email consent imports as no (`MOVE-008`). The fixture has three gifts of $500 or more marked Acknowledged? Yes with a linked acknowledgement interaction, Do Not Acknowledge, and No, and a $150 gala payment with a $60 Non-deductible amount: after the import the acknowledgement queue lists only the No gift as due, the Yes gift links its imported interaction, the gala payment needs no goods answer and appears on its donor's year-end statement with $90 deductible (`RCPT-004`), and the reconciliation counts per acknowledgement status equal the source (`MOVE-007`). The fixture also has three constituents with Communication Restrictions: one Do Not Solicit with mail and email consent, one Do Not Mail and one Do Not Call. After the import the first carries the do-not-solicit restriction with source Bloomerang and the import date, the second's mail consent is no and the third's phone consent is no; the next email appeal and mail appeal both exclude the first with the reason "do not solicit" while its next gift is still receipted, and the reconciliation's restricted count equals the source. Then it undoes.

*Status:* partial. Documented Bloomerang CSV/XLSX reports import the same donor/gift history and attribution with source-control reconciliation and atomic apply/undo. REST API, full contact/custom-field, task, consent/restriction, acknowledgement, tribute and recurring-vault migration remains unbuilt. Evidence: `src/coffer/move-in/service.ts`, `src/coffer/move-in/plan.ts`, `src/coffer/ui/crm-move-in.ts`, `tests/move-in.test.mjs`, `docs/MOVE-IN-SOURCES.md`.

#### MOVE-003 — From Raiser's Edge NXT.

Coffer reads Raiser's Edge NXT through Blackbaud's SKY API (or database view exports): constituents with name parts, primary addressee and salutation (`DONOR-014`) and every email, phone and address and its type and primary flag, constituent, gift and action custom fields with their definitions and code tables (`MOVE-010`), relationships, gifts with splits and soft credits, funds, campaigns and appeals, pledges, recurring gifts, actions, opportunities, notes, tributes on gifts (`GIFT-008`), solicit codes (each mapped in the preview to a channel withdrawal, a solicitation restriction or limit such as "Solicit once annually" (`DONOR-015`), a tag or skip, with the mapping saved) and inactive and deceased status with date, with preview, apply and undo. Each gift and soft credit also carries its acknowledgement status with its date, method and linked letter, email or interaction (`RCPT-011`) and its non-deductible (goods or services) amount as the gift's goods answer (`GIFT-001`): a gift with an acknowledgement date or a linked acknowledgement letter imports as acknowledged, a gift marked do not acknowledge (or with acknowledgement status "Do not acknowledge") as do not acknowledge, any other as not acknowledged, and the gift's benefits value or receipt amount sets the goods value. A non-deductible amount above zero imports as goods provided with that value, a recorded zero as no goods or services, and only a gift whose source holds no answer is imported as unknown, so imported gifts are not held under `ACK-001`'s unknown-goods rule.

*Acceptance:* An HTTP journey with the SKY API edge faked imports a fixture database, reads gifts with splits and opportunities equal to the source, carries a constituent's primary addressee and salutation unchanged and a constituent and a gift custom field with their values, carries one acknowledged, one do-not-acknowledge and one not-acknowledged gift with their statuses and a gift with a benefits value as its goods value, maps a fixture "Do not solicit" solicit code to the restriction, a "Do not mail" code to mail consent no and a "Solicit once annually" code to a once-a-year limit, with the next appeals excluding each by its reason, reads a tribute's total equal to the source, and undoes.

*Status:* partial. Configured NXT database-view CSV/XLSX constituent/gift reports import donor/gift history, households, relationships, soft credits, pledges and notes. Grouped web-list splits and repeated source IDs are explicitly blocked pending designation exports. SKY API, opportunities, full custom fields/contacts, restrictions, acknowledgement and recurring-vault migration remains unbuilt. Evidence: `src/coffer/move-in/service.ts`, `src/coffer/move-in/plan.ts`, `src/coffer/ui/crm-move-in.ts`, `tests/move-in.test.mjs`, `docs/MOVE-IN-SOURCES.md`.

#### MOVE-004 — From Neon CRM.

Coffer reads Neon CRM through its API (or exports): accounts with name parts and salutation (`DONOR-014`) and every email, phone and address and its type and primary flag, custom fields on accounts, donations and activities with their definitions and values (`MOVE-010`), households, donations, pledges, recurring donations with their Neon Pay customer, card and bank account references for `MOVE-009`, memberships, event registrations, activities, soft credits, tributes on donations (`GIFT-008`), contact restrictions and opt-outs (do not call, do not email, do not mail, do not solicit; each mapped in the preview to a channel withdrawal, a solicitation restriction or limit (`DONOR-015`), a tag or skip, with the mapping saved) and account status (active, inactive, deceased with date), with preview, apply and undo. Each gift and soft credit also carries its acknowledgement status with its date, method and linked letter, email or interaction (`RCPT-011`) and its non-deductible (goods or services) amount as the gift's goods answer (`GIFT-001`): a donation with an acknowledgement sent or a linked acknowledgement letter imports as acknowledged, one marked do not acknowledge as do not acknowledge, any other as not acknowledged, and the fair market value of an event registration or premium sets the goods value. A non-deductible amount above zero imports as goods provided with that value, a recorded zero as no goods or services, and only a gift whose source holds no answer is imported as unknown, so imported gifts are not held under `ACK-001`'s unknown-goods rule.

*Acceptance:* An HTTP journey with the Neon edge faked imports a fixture organization with memberships and events and reads matching totals, an account's salutation unchanged, a pick-one account custom field with its pick list and values, one acknowledged and one not-acknowledged donation with their statuses, and an event registration with its fair market value as its goods value, maps a fixture do-not-solicit account to the restriction so the next appeal excludes it with that reason, and reads a tribute's total equal to the source.

*Status:* missing. No Neon CRM importer.

#### MOVE-005 — From Givebutter and Zeffy.

Coffer reads Givebutter (API: contacts, transactions, recurring plans, campaigns) and Zeffy (exports) history, keeping each gift's campaign and fees, each recurring plan with its processor references for `MOVE-009`, donors' name parts (`DONOR-014`), answers to custom form questions as custom field values (`MOVE-010`), and dedications as tributes (`GIFT-008`). Each gift's ticket or item fair market value sets its goods value, and a gift the platform already receipted imports as acknowledged by email on its receipt date (`RCPT-011`); a gift with no such record imports as not acknowledged.

*Acceptance:* An HTTP journey imports fixture Givebutter and Zeffy data and reads gifts with campaign and fee totals equal to the source, a Givebutter monthly plan with its processor customer and payment method references ready for `MOVE-009`, a donor's first and last name in their name parts, a custom form question's answer as that donor's custom field value, a ticket purchase with its fair market value as its goods value, and a receipted gift as acknowledged by email on its receipt date.

*Status:* missing. No Givebutter or Zeffy importer.

#### MOVE-006 — Any spreadsheet.

A CSV or Excel file of constituents, gifts or interactions maps column by column onto any field, including name parts and salutations (`DONOR-014`) and existing or new custom fields (`MOVE-010`), with saved mappings, value translation (fund names, payment methods), tribute columns (`GIFT-008`), a do-not-solicit or solicitation-limit column (`DONOR-015`), an acknowledgement status column (acknowledged with date and method, not acknowledged, do not acknowledge, `RCPT-011`) and a non-deductible amount column mapped to the goods value, the same duplicate checks as `DONOR-006`, preview, apply and undo.

*Acceptance:* A browser journey maps a gifts spreadsheet, translates two fund names, maps its acknowledged and non-deductible columns, previews matches to existing donors, applies, reads an acknowledged gift and a gift with its non-deductible amount as goods value, and undoes.

*Status:* missing. No general importer.

#### MOVE-007 — Totals checked before the switch.

Every move-in ends in a reconciliation: donors, gifts and dollars by year and fund in the source against Coffer, open pledges, active recurring plans, consent counts and receipts already sent, gifts and soft credits counted by acknowledgement status (acknowledged, not acknowledged, do not acknowledge, `RCPT-011`) and the total non-deductible amount, constituents with a solicitation restriction or limit (`DONOR-015`) and tribute totals (`GIFT-008`), with each difference listed. The preview also shows the not-acknowledged gifts at or over the threshold by year, and the owner sets the installation's acknowledge-from date (default: 30 days before the import): an older not-acknowledged gift keeps its status on its record but is never due under `ACK-001` and never picked up by `DEV-003`, so no donor is thanked again for a gift from years ago. Recurring plans on the nonprofit's own Stripe account are adopted without donor action. Plans whose cards or bank accounts sit with the incumbent's processor (Bloomerang Payments, LGL Forms, Neon Pay, Qgiv, Givebutter, Donorbox) move with them through the PCI data transfer of `MOVE-009`, also without donor action. Only a plan whose card or bank account did not arrive in that transfer gets a reauthorization campaign (`DEV-007`). No source plan is cancelled by Coffer, and the cutover checklist has the owner stop each source plan before its replacement first charges. The owner signs off the cutover. Every importer keeps each record's source-system ID (Bloomerang account number, LGL constituent ID, Raiser's Edge constituent ID, Neon account ID, Givebutter or Zeffy contact ID) as a searchable legacy ID, so reply cards printed before the switch are found by it in lookup and batch entry (`GIFT-002`).

*Acceptance:* An HTTP journey imports a fixture with one deliberate gap, reads the difference in the reconciliation, adopts two Stripe subscriptions, moves two vault-transferred plans, lists one plan whose payment method is missing from the mapping for reauthorization, finds an imported donor by its legacy ID, reads gift counts per acknowledgement status, the non-deductible total and the count of restricted constituents equal to the source, sets the acknowledge-from date and sees a not-acknowledged gift older than it absent from the queue, and records the owner's sign-off.

*Status:* partial. CSV/XLSX move-ins compare received gift counts and cents by year, fund and donor with raw source rows and independently supplied source report controls; existing imported net balances participate. Named differences or unmapped values block until resolved or accepted with a recorded reason. Stable source IDs, resumable part-by-part apply with a recheckable totals check from the gifts in Coffer (per move-in, including gifts an earlier move-in brought), and undo ship; later call tasks and opportunities block undo. The review asks whether gifts before a date (default the move-in date) were already thanked; those never become due or missing receipts. Cross-account vault transfer, per-gift acknowledgement status reconciliation, restriction/tribute controls and cutover sign-off remain unbuilt. Evidence: `src/coffer/move-in/service.ts`, `src/coffer/move-in/plan.ts`, `src/coffer/ui/crm-move-in.ts`, `tests/move-in.test.mjs`, `docs/MOVE-IN-SOURCES.md`.

#### MOVE-009 — Recurring donors move with their cards and bank accounts.

A nonprofit whose monthly donors are on its incumbent's processor moves them without asking any donor to act, whether they give by card or by US bank account (ACH). The owner requests a PCI data transfer: the old processor sends its encrypted file of card numbers and of bank routing and account numbers directly to Stripe, Stripe imports them into the nonprofit's own account, and Stripe returns its post-import mapping files from the old customer, card and bank account IDs to new `cus_` IDs, to `pm_` payment methods for cards, and for bank accounts to either `ba_` bank accounts or `pm_` payment methods. Coffer never receives a card or account number. Coffer reads the incumbent's recurring-plan export (amount, frequency, fund, campaign, payment type, next charge date, past installments and, for ACH plans, the donor's debit authorization with its date and method, from `MOVE-001` to `MOVE-005`) with every mapping file Stripe returns: the card file and both ACH shapes, each as CSV or JSON. It previews which plans match an imported payment method, and on apply creates each plan (`GIVE-003`) on its new ID with the same amount, frequency, fund, campaign and next charge date, its past installments linked as its history. An ACH plan keeps a reference to the donor's existing debit authorization (the incumbent's record of it, its date and method) and debits the imported account, charged by its `pm_` or `ba_` ID, so no ACH donor re-authorizes. A plan whose card or bank account is missing, expired or rejected in the transfer is listed for reauthorization (`DEV-007`) with the reason. Each moved plan holds its first charge until the owner confirms in the cutover (`MOVE-007`) that the source plans are stopped; a plan whose next date passed while held charges once on confirmation, so no donor is charged twice or skipped. Coffer drafts the notice telling moved donors that the descriptor on their card or bank statement changes, for the owner to approve. Preview, apply and undo follow `IMPORT-001`.

*Acceptance:* An HTTP journey takes a fixture Bloomerang recurring-plan export with card and ACH plans and fixture Stripe mapping files: the card file once as CSV and once as JSON, and the ACH file in the `pm_` shape and in the `ba_` shape. It previews and applies, and reads each matched plan active on its imported ID with its original amount, fund, next charge date and history, each ACH plan citing the donor's original debit authorization. After the owner confirms the source stop, one card plan and one ACH plan each charge exactly once on a Stripe test clock. A plan whose card and a plan whose bank account are missing from the mappings are listed for reauthorization with that reason, nothing cancels the source plan, no stored record holds a card or account number, and the descriptor notice waits for approval.

*Status:* partial. Supported active fixed-price USD monthly subscriptions from the same Stripe account appear on donors with existing customer/subscription IDs; Stripe continues billing without a new charge or card transfer. Cross-account vault transfer, ACH mapping and other schedules remain unbuilt. Evidence: `src/coffer/imports/subscriptions.ts`, `docs/MOVE-IN.md`, `tests/coffer.test.mjs`.

#### MOVE-008 — Consent and preferences moved with provenance.

Every importer carries each donor's email, mail, SMS and phone preferences as consent rows, and each solicitation restriction as a `DONOR-015` restriction, marked with the source system and date, so `APPEAL-001`, `COMM-001` and every ask path honour them from the first send; an unknown preference is imported as unknown, never as yes. Restriction codes that differ by incumbent (Bloomerang Communication Restrictions, Raiser's Edge NXT solicit codes, Little Green Light communication tags and Neon CRM contact restrictions) are mapped in the preview to a channel withdrawal, a restriction or limit, a tag or skip, and the mapping is saved for the next import.

*Acceptance:* An HTTP journey imports an LGL fixture with opted-out and unknown donors and prepares an appeal that excludes both with their reasons; the same journey on the `MOVE-002` Bloomerang fixture imports an email-opted-out and a mail-opted-out constituent with source Bloomerang and the import date, and the appeal excludes each from its channel with the reason; the fixture's Do Not Solicit, Do Not Mail and Do Not Call constituents land as the do-not-solicit restriction, mail consent no and phone consent no with source Bloomerang and the import date.

*Status:* missing. No importer carries consent.

#### MOVE-010 — Custom fields carried across.

Every importer (`MOVE-001` to `MOVE-006`) reads the incumbent's custom field definitions as well as their values: Bloomerang's constituent, transaction, interaction and note fields with their data type (text, date, year, number, currency), entry method (free-form, pick-one, pick-many) and pick-list values; Little Green Light's custom fields and categories on constituents and gifts; Raiser's Edge NXT's constituent, gift and action custom fields with their code tables; Neon CRM's custom fields on accounts, donations and activities; Givebutter's custom form questions; and spreadsheet columns a person marks as custom. The preview lists each source field beside the Coffer field it will create at the matching level (constituent, gift, interaction or note, `DONOR-005`) with the same name, type, entry method and pick list, and its count of values. The person can rename the target, map the source field to an existing Coffer field or to tags (each pick-list value becoming a tag), or skip it, and the mapping is saved with the import. On apply each value lands on its constituent, gift, interaction or note. A value that fails its type or is not in the pick list is never dropped or coerced: it waits in a review list with the record, field, value and reason, for a person to fix, map or skip. The reconciliation (`MOVE-007`) counts defined fields, carried values and waiting values per field, and undo removes the created fields with their values.

*Acceptance:* An HTTP journey with the Bloomerang edge faked imports a fixture account with a pick-one and a pick-many constituent field, a currency transaction field, a text interaction field and a note field; the preview lists each source field beside its Coffer field, and the person renames one and maps another to an existing field. After apply the test reads each field defined in Coffer with its type, entry method and pick list and each record's value, finds donors by the pick-one value in a saved list (`DONOR-007`), groups a gifts report by the transaction field (`REPORT-004`), and finds one currency value that was not a number waiting with its reason. The Little Green Light journey does the same with a fixture's custom fields and categories, and undo removes the created fields.

*Status:* missing. No custom fields, and no importer other than Stripe's, which reads no custom data.

#### MOVE-011 — Switching guide for each incumbent.

For each named incumbent (Little Green Light, Bloomerang, Raiser's Edge NXT, Neon CRM, Givebutter, Zeffy), Coffer's docs and its move-in screen walk a non-technical buyer through the switch in order: which exports to download or which API key to create, by the incumbent's own menu path; how to request the PCI data transfer of cards and bank accounts to Stripe and which mapping files to upload (`MOVE-009`); mapping custom fields (`MOVE-010`) and name fields (`DONOR-014`); reading the reconciliation (`MOVE-007`); stopping the source recurring plans on cutover day; and which neighbour replaces what Coffer does not rebuild (bulk email through Mango or Mailchimp). Each step on the move-in screen links to its guide section and shows whether it is done for this installation, so the guide doubles as the checklist that `DEV-007` works through with the owner.

*Acceptance:* A browser journey at 1440 and 390 pixels opens the move-in screen for Bloomerang, reads its ordered steps each linked to a built guide page that names the export or API key, the PCI transfer request, the mapping files and the cutover stop, and sees steps marked done as a fixture import, a mapping-file upload and the owner's sign-off complete.

*Status:* partial. The CRM export guide gives vendor report/menu guidance, official source links, required IDs, supported fields and source control interpretation for LGL, Bloomerang and NXT, alongside the Stripe guide. PCI transfer and an installation cutover checklist remain unbuilt. Evidence: `src/coffer/move-in/service.ts`, `src/coffer/move-in/plan.ts`, `src/coffer/ui/crm-move-in.ts`, `tests/move-in.test.mjs`, `docs/MOVE-IN-SOURCES.md`.

### Team and access

Roles a small development shop and its volunteers need.

#### TEAM-001 — Roles and record-level access.

Roles cover owner, admin, fundraiser, finance, data entry, volunteer and read-only, plus agents; a fundraiser can be limited to their portfolio, confidential notes and prospect research are restricted, finance can post and reconcile but not export donor lists, and exports of donor data are permitted per role and logged, and only permitted roles charge cards and bank accounts (`GIVE-009`). An admin sets each team member's manager (the person they report to) and weekly call capacity; task escalation (`STEW-001`) and the call list (`DEV-005`) use them.

*Acceptance:* An HTTP journey signs in as each role and is allowed or refused each listed action, including a portfolio-limited fundraiser opening another portfolio's prospect; an admin sets a member's manager and call capacity and reads them back, and a member is refused setting them.

*Status:* partial. Owner, admin, member and agent roles guard every command; no fundraiser, finance, volunteer or read-only roles, portfolio scoping, confidential fields, managers or call capacity. Evidence: `src/coffer/commands.ts`, `src/coffer/auth.ts`, `tests/coffer.test.mjs`.

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

A versioned REST API with an OpenAPI document covers constituents (with consent, status and solicitation restrictions, `DONOR-015`), gifts, pledges, plans, interactions, tasks, opportunities, funds and campaigns, with scoped keys (read only, gift entry, full), rate limits and idempotency keys on writes.

*Acceptance:* An HTTP journey creates a read-only key and a gift-entry key, reads donors with the first, is refused a write, records a gift idempotently with the second, sets and reads a donor's "do not solicit" restriction with a full key, and validates responses against the OpenAPI document.

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

Every staff screen works at 390 pixels, and the phone views put donor lookup, the giving summary, log a call or meeting, record a gift and today's tasks within two taps. The phone donor view shows constituent status and any solicitation restriction (`DONOR-015`) beside the name.

*Acceptance:* The browser journey asserts no horizontal scroll at 390 pixels on every screen, and a phone journey looks up a donor, logs a call and records a gift within two taps each, and sees the do-not-solicit badge on a restricted donor.

*Status:* partial. Every current screen fits 390 pixels with no horizontal scroll; no phone-first views, call logging or task list. Evidence: `tests/browser-journey.mjs`.

#### MOBILE-002 — Native iOS and Android apps.

Native apps keep the signed-in staff member's portfolio and today's tasks available offline, sync logged calls and notes when back online, and push notifications for new major gifts, assigned tasks and replies.

*Acceptance:* A native test on iOS and Android simulators logs a call offline, reconnects and sees it on the web timeline, and receives push notifications for an assigned task, a new major gift and a reply.

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

*Status:* partial (core claim implemented). Stripe charges/payouts, contributions/funds and exact Pantry proposal/journal state are compared with source IDs. Safe contribution and missing-gift corrections have explicit apply and compensating undo; payout/accounting exceptions require Payments/Pantry review. Broader finance-role approvals and QuickBooks integration remain. Evidence: `src/coffer/agent/reconciliation.ts`, `tests/agent-reconciliation.test.mjs`, `docs/DEVELOPMENT-AGENT.md`.

#### DEV-002 — Rescues failed monthly gifts.

For each failed or expiring recurring plan the agent reads plan history, consent and past messages, prepares the right notice on the donor's permitted channel, follows up on a schedule until the donor updates their payment method, the plan resumes or a person closes it, and records which step recovered it. Notices to major donors and any revised amount wait for the development lead's approval; frequency limits and stop requests always hold.

*Acceptance:* An HTTP journey with the Stripe edge faked fails three plans (one major donor), runs the agent, sends two notices automatically under a standing approval, holds the major donor's for approval, recovers one plan and reports the outcome per plan.

*Status:* partial (core claim implemented). Signed failures request one private card-update email; Stripe schedules retries and daily reconciliation records recovery/lapse. Reversible pause/resume and activity explain outcomes. Major-donor approvals, expiring-card notices and per-donor frequency grants remain. Evidence: `src/coffer/agent/recovery.ts`, `tests/agent-recovery.test.mjs`, `docs/DEVELOPMENT-AGENT.md`.

#### DEV-003 — Sends missing receipts.

The agent finds gifts whose acknowledgement status is "not acknowledged" (`RCPT-011`) and that are past target, never a gift acknowledged in Coffer or before the move or marked do not acknowledge, and only gifts received on or after the installation's acknowledge-from date, receipts that bounced and year-end statements not yet delivered, prepares the batch in the approved template, and sends standard receipts under the admin's standing approval of that template version; anything unusual (goods value unknown, address missing, a large gift) waits for a person.

*Acceptance:* An HTTP journey seeds overdue and bounced receipts, runs the agent, sees standard ones sent under the standing approval and the unusual ones queued for a person with reasons; after the `MOVE-002` fixture import, the agent proposes nothing for the gifts imported as acknowledged or do not acknowledge, nor for a not-acknowledged gift older than the acknowledge-from date.

*Status:* partial (core claim implemented). Finds all missing and bounced gift receipts, freezes a batch for human approval and supports undo before dispatch. Unknown goods/services are held. Standing template approvals, migration acknowledgement policies and year-end delivery recovery remain. Evidence: `src/coffer/agent/receipts.ts`, `tests/agent-receipts.test.mjs`, `docs/DEVELOPMENT-AGENT.md`.

#### DEV-004 — Drafts stewardship from the nonprofit's own history.

For each donor due a touch the agent drafts the thank-you call notes, personal email or handwritten-card text from that donor's actual gifts, interactions, event attendance and replies, citing each fact, and schedules it as a task for the relationship manager. It never drafts an ask for a constituent with a solicitation restriction (`DONOR-015`). It never invents wealth, intent, family facts or impact claims; the fundraiser edits and approves every message, and confidential notes stay within their role.

*Acceptance:* An HTTP journey with the model edge faked drafts touches for three donors; every claim in each draft links to a record, a draft citing a non-existent fact is rejected by the check, a draft that asks a do-not-solicit donor for a gift is rejected too, and nothing is sent until a fundraiser approves.

*Status:* partial (core claim implemented). An install-owned sealed AI key enables cited drafts from actual gifts, signed adjustments, funds, conversations and tributes; people edit/review/send, stale sources block sending and discarded drafts restore. Relationship-manager scheduling, event/reply sources and confidential role scoping remain. Evidence: `src/coffer/agent/stewardship.ts`, `tests/stewardship.test.mjs`, `docs/DEVELOPMENT-AGENT.md`.

#### DEV-005 — Shows who needs a human call next.

Each week the agent ranks, per relationship manager, the donors most worth a call (lapse risk, upgrade signals, anniversaries, unanswered replies, overdue pledges; never inactive or deceased constituents) with the reason for each (a constituent with a solicitation restriction, `DONOR-015`, never gets an ask or upgrade call task and is listed only for a thank-you or stewardship call marked as not an ask), creates call tasks up to the manager's weekly call capacity (`TEAM-001`, default 10) and lists the rest as overflow. It then measures donor by donor: whether the call was made (the task completed with a logged call), whether the donor gave within N days of the call (N a setting, default 90), and whether the donor was retained under the `REPORT-001` definition at the end of the fiscal year; and it reports the retention rate of called donors against listed donors who were not called.

*Acceptance:* An HTTP journey builds a history with lapsing, upgrading and silent donors and a manager with a capacity of 5; the agent creates 5 ranked call tasks with reasons and lists the rest as overflow; a do-not-solicit donor with upgrade signals gets no ask task and appears only as a thank-you call marked not an ask; 3 calls are logged, 2 of those donors give within N days, the fiscal year closes, and the per-donor table reads call made, gift within N days and retained for every listed donor, with called and uncalled retention rates that match a hand calculation.

*Status:* partial. Staff review explained lapse/monthly/pledge flags, create owned dated calls, log outcomes on donor timelines and inspect donor-by-donor retention. Weekly agent ranking, capacity overflow, solicitation/status restrictions and called-vs-uncalled outcome attribution remain. Evidence: `src/coffer/call-tasks.ts`, `src/coffer/lapses.ts`, `src/coffer/retention.ts`, `tests/pipeline.test.mjs`.
#### DEV-006 — Briefs before a meeting.

Before a scheduled donor meeting the agent prepares a one-page brief: giving summary, recent interactions, open opportunities and pledges, relationships, and questions left open last time, each line linked to its source. It does not speculate about capacity beyond stored prospect research the reader may see.

*Acceptance:* An HTTP journey schedules a meeting, receives the brief a day ahead, and checks every line against its linked record and that a data-entry user's brief omits research.

*Status:* missing. No meetings or briefs.

#### DEV-007 — Proves the move-in and the cutover.

During a migration the agent compares source and Coffer totals, finds duplicates, missing acknowledgements and consent gaps, lists the recurring plans whose cards or bank accounts did not arrive in the transfer (`MOVE-009`) and drafts a reauthorization campaign for those plans only, and tracks each plan until the donor has re-authorized; it never cancels a source plan. The owner approves merges, the reauthorization message and the cutover.

*Acceptance:* An HTTP journey imports a fixture with gaps and a non-adoptable plan, runs the agent, reads the exception list and drafted campaign, re-authorizes the plan and records the owner's cutover.

*Status:* partial. The Stripe move-in reads the connected account or a request-only restricted read key, follows pages for charges, Payment Intents, invoices and monthly plans, resolves customers, previews exact gifts and skips, imports supported existing monthly plans, checks actual gift counts/cents, and supports guarded undo (`src/coffer/imports/live-stripe.ts`, `src/coffer/imports/subscriptions.ts`, `docs/MOVE-IN.md`). No comparison agent, cross-account vault transfer, recurring reauthorization or cutover. Evidence: `src/coffer/imports/service.ts`, `tests/coffer.test.mjs`.

#### DEV-008 — Keeps the database clean.

The agent proposes duplicate merges, address updates from NCOA and returned mail, a deceased or inactive status (`DONOR-012`) from returned mail, family notes and obituary notices the nonprofit forwards, and missing salutations, each with its evidence; a person accepts or rejects in a queue, and accepted changes go through the normal audited commands.

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
| Card and bank credentials, ACH rails and holding charitable funds | Stripe and PayPal collect, verify and pay out; Coffer keeps provider references and settlement records only (`GIVE-004`, `PAY-001`); staff key cards and bank accounts into Stripe's own fields, never Coffer's (`GIVE-009`); saved cards and bank accounts move between processors by a PCI data transfer that Coffer maps to its plans (`MOVE-009`). |
| The general ledger, audits and tax advice | Pantry or QuickBooks Online keep the books (`FIN-001`, `FIN-002`); receipt rules follow IRS Publication 1771 as templates the nonprofit reviews, and its CPA prepares Form 990 from `REPORT-007` data. |
| Bulk email infrastructure | Mango, Mailchimp or Constant Contact send appeals at volume (`COMM-002`, `COMM-003`); Coffer sends transactional receipts and personal email through the installation's mail provider. Coffer has no mass-email designer of its own: Bloomerang's built-in email editor is replaced by Mango or Mailchimp, and the switching guide says so. |
| Printing and postage | A mail house or Lob prints and mails (`RCPT-003`, `COMM-007`); Coffer produces the files and records the events. |
| Postal address data | Smarty and an NCOA licensee supply verification and change-of-address data (`DONOR-009`). |
| Wealth data | DonorSearch or WealthEngine supply screening (`MAJOR-005`); Coffer never infers wealth. |
| Donor-advised funds, brokerage, appraisals, vehicle donations and planned-giving instruments | DAF sponsors, brokers, qualified appraisers, vehicle-donation partners (Form 1098-C) and attorneys handle the regulated transfer or document; Coffer records the gift and the stewardship (`GIFT-009`, `GIFT-010`, `MAJOR-007`). |
| Volunteer shift scheduling and online auctions | VolunteerHub or Galaxy Digital schedule volunteers and an auction platform runs bidding; Coffer imports hours (`DONOR-010`) and auction results as gifts net of each lot's fair market value (`CAMP-005`). |
| Charitable solicitation registration | A compliance service such as Harbor Compliance files state registrations; Coffer reports what was raised by state (`REPORT-008`). |
| Merchandise and sales tax | Stall sells merchandise with its sales tax; Coffer records only the contribution part of any order (`PAY-006`). |
| Generic sales CRM, email marketing, website, forms and surveys, e-signature and team chat | Orbit, Mango, Pane, Pencil, Inkwell and Nook (or HubSpot, Mailchimp, Squarespace, Typeform, Docusign and Slack) stay separate products that Coffer connects to. |
| Recording video thank-yous | ThankView or BombBomb record and send video; the sent message logs on the donor's timeline through the BCC address (`COMM-004`). |
| Receipts outside the US | Canadian, UK and other receipting rules are not offered in the US-first edition. |

## Scope mapping

Each item the owner-approved scope (16 October 2026) names, and the clauses that cover it.

| Scope item | Clauses |
| --- | --- |
| Online donation forms and campaign pages with recurring gifts, card/ACH/wallet checkout via Stripe and a donor self-service portal | `GIVE-001`, `GIVE-002`, `GIVE-003`, `GIVE-004`, `GIVE-005`, `GIVE-006`, `GIVE-007`, `GIVE-009` |
| Live Stripe sync of gifts, payouts, fees, refunds and failed recurring payments, with QuickBooks Online/Pantry deposit reconciliation by fund | `PAY-001`, `PAY-002`, `PAY-003`, `PAY-004`, `GIVE-006`, `FIN-001`, `FIN-002`, `FIN-003`, `FIN-005` |
| Acknowledgements and year-end tax receipts delivered by email (and print-ready mail merge) with IRS goods-and-services language and delivery tracking | `ACK-001`, `RCPT-001`, `RCPT-002`, `RCPT-003`, `RCPT-004`, `RCPT-005`, `RCPT-006`, `RCPT-008`, `RCPT-011` |
| Appeals and automated stewardship journeys sent through Mango or Mailchimp, with unsubscribe and reply handling | `APPEAL-001`, `COMM-001`, `COMM-002`, `COMM-005`, `STEW-003`, `DONOR-015` |
| Moves management: major-gift pipeline, tasks, soft credits, tribute and matching gifts, and donor engagement/retention scores | `MAJOR-001`, `MAJOR-002`, `MAJOR-003`, `MAJOR-004`, `STEW-001`, `GIFT-006`, `GIFT-007`, `GIFT-008`, `REPORT-001` |
| Migration from Little Green Light, Bloomerang and Raiser's Edge with full gift history | `MOVE-001`, `MOVE-002`, `MOVE-003`, `MOVE-004`, `MOVE-007`, `MOVE-008`, `MOVE-009`, `MOVE-010`, `MOVE-011` |
| Push further: a development agent that reconciles every gift, catches failed recurring donations and unsent receipts, drafts and schedules stewardship touches from the nonprofit's own interaction history, and measures retention by donor | `DEV-001`, `DEV-002`, `DEV-003`, `DEV-004`, `DEV-005`, `DEV-012` |

## Homepage claims

Every capability claim on the run site's homepage (the desk's owner-accepted copy, `src/site/landing/`) and the clauses that deliver it. A claim's status is its clauses' statuses.

| # | Claim | Clauses | Status |
| ---: | --- | --- | --- |
| 1 | Coffer takes donations | `GIVE-001`, `GIVE-003`, `GIVE-004` | partial |
| 2 | keeps every donor's story | `DONOR-001`, `DONOR-004` | `DONOR-001` done · `DONOR-004` partial |
| 3 | sends the receipts | `ACK-001`, `RCPT-001`, `RCPT-002` | `ACK-001` done · `RCPT-001` partial · `RCPT-002` done |
| 4 | and thank-yous | `RCPT-002`, `RCPT-007` | `RCPT-002` done · `RCPT-007` partial |
| 5 | shows who needs a call | `DEV-005`, `REPORT-002` | partial (core claim implemented; broader clauses remain) |
| 6 | 100% free, open source alternative to Bloomerang, Little Green Light and Neon CRM | `OWN-001`, `MOVE-001`, `MOVE-002`, `MOVE-004` | `OWN-001` done · `MOVE-001` partial · `MOVE-002` partial · `MOVE-004` missing |
| 7 | Spring appeal $48,210 of $60,000, gifts and recurring donors | `CAMP-001`, `REPORT-003` | `CAMP-001` partial · `REPORT-003` partial |
| 8 | Monthly $25 · Active | `GIVE-003` | partial |
| 9 | Failed card · Retried successfully | `GIVE-006` | partial |
| 10 | Receipt sent · Gift $250.00 · No goods or services provided | `RCPT-001`, `RCPT-005` | `RCPT-001` partial · `RCPT-005` partial |
| 11 | Call Tom Okafor · lapsed 14 months | `DEV-005`, `STEW-001` | partial (core claim implemented; broader clauses remain) |
| 12 | Donation forms and campaign pages | `GIVE-001`, `GIVE-002` | partial |
| 13 | monthly giving | `GIVE-003` | partial |
| 14 | card, bank and Apple Pay checkout | `GIVE-004` | partial |
| 15 | a portal where donors update their own card | `GIVE-005` | partial |
| 16 | Households | `DONOR-001` | done |
| 17 | relationships | `DONOR-003` | partial |
| 18 | every gift | `GIFT-001` | done |
| 19 | every conversation in one place | `DONOR-004`, `COMM-004`, `COMM-005` | `DONOR-004` partial · `COMM-004` missing · `COMM-005` partial |
| 20 | soft credits | `GIFT-006` | partial |
| 21 | tributes | `GIFT-008` | partial |
| 22 | employer matches | `GIFT-007` | partial |
| 23 | Lifetime giving and first gift | `DONOR-011` | done |
| 24 | Gifts sync from Stripe as they happen | `PAY-001` | partial |
| 25 | fees, refunds | `PAY-003`, `PAY-004` | partial |
| 26 | failed monthly payments | `GIVE-006` | partial |
| 27 | each payout matches its deposit in QuickBooks Online or Pantry | `PAY-002`, `FIN-001`, `FIN-002` | `PAY-002` done · `FIN-001` / `FIN-002` partial |
| 28 | split by fund | `GIFT-004`, `FIN-003` | `GIFT-004` done · `FIN-003` partial |
| 29 | Thank-you letters | `ACK-001`, `RCPT-002` | `ACK-001` done · `RCPT-002` done |
| 30 | year-end tax receipts | `RCPT-004` | partial |
| 31 | by email | `RCPT-001`, `RCPT-002` | `RCPT-001` partial · `RCPT-002` done |
| 32 | print-ready for mail | `RCPT-003` | partial |
| 33 | with the right IRS language | `ACK-001`, `RCPT-005` | `ACK-001` done · `RCPT-005` partial |
| 34 | proof of delivery | `RCPT-006` | partial |
| 35 | Thank-yous sent · 48 donors tonight | `RCPT-002` | done |
| 36 | Appeals and welcome journeys go out through Mango or Mailchimp | `COMM-002`, `STEW-003` | `COMM-002` partial · `STEW-003` partial |
| 37 | welcome journeys | `STEW-003` | partial |
| 38 | Unsubscribes are honored everywhere | `CONSENT-001`, `APPEAL-001`, `COMM-001` | `CONSENT-001` done · `APPEAL-001` done · `COMM-001` partial |
| 39 | replies land with the right person | `COMM-005` | partial |
| 40 | major-gift pipeline with next steps, owners and engagement scores | `MAJOR-001`, `MAJOR-002`, `MAJOR-004` | partial (core claim implemented; broader clauses remain) |
| 41 | reconciles every gift | `DEV-001` | partial (core claim implemented; broader clauses remain) |
| 42 | rescues failed monthly gifts | `DEV-002` | partial (core claim implemented; broader clauses remain) |
| 43 | sends missing receipts | `DEV-003` | partial (core claim implemented; broader clauses remain) |
| 44 | drafts stewardship from your own history | `DEV-004` | partial (core claim implemented; broader clauses remain) |
| 45 | tracks retention donor by donor | `DEV-005`, `REPORT-001` | partial (core claim implemented; broader clauses remain) |
| 46 | Move from Little Green Light | `MOVE-001` | `MOVE-001` partial (CSV/XLSX exports implemented) |
| 47 | Bloomerang | `MOVE-002` | `MOVE-002` partial (CSV/XLSX exports implemented) |
| 48 | Raiser's Edge NXT | `MOVE-003` | `MOVE-003` partial (CSV/XLSX exports implemented) |
| 49 | with every donor, household and gift | `MOVE-001`, `MOVE-002`, `MOVE-003`, `IMPORT-001` | `MOVE-001` partial · `MOVE-002` partial · `MOVE-003` partial · `IMPORT-001` done |
| 50 | check the totals before you switch | `IMPORT-001`, `MOVE-007` | `IMPORT-001` done · `MOVE-007` partial (gift reconciliation implemented) |
| 51 | Run Coffer on your own computer | `OWN-002` | done |
| 52 | keep every donor record / Your donors, your database | `OWN-001`, `DATA-001` | done |
| 53 | Export everything, any time | `DATA-001`, `DATA-002` | `DATA-001` done · `DATA-002` partial |
| 54 | Soft credits | `GIFT-006` | partial |
| 55 | Tribute gifts | `GIFT-008` | partial |
| 56 | Matching gifts | `GIFT-007` | partial |
| 57 | Pledges: schedules, reminders and balances kept current | `GIFT-005`, `STEW-004` | `GIFT-005` partial · `STEW-004` partial |
| 58 | Consent: email and mail preferences honored everywhere | `CONSENT-001`, `APPEAL-001` | done |
| 59 | Gift ledger: every change recorded; no gift is silently edited | `GIFT-001` | done |
| 60 | Open source donor management for every nonprofit | `OWN-001` | done |
| 61 | Free and open source, MIT licensed | `OWN-001` | done |

## Status

Judged from the code and tests at commit `231694e67ba4b595574afe99f554ebf16d01fe5b` (18 October 2026).

The giving summary and split-gift clauses were also exercised through the product at 1440 and 390 pixels on 18 October 2026.

The giving, receipt, payments, donor-depth, development-agent and CRM export move-in clauses and their claim mappings include their current implementations and named tests.

| Clauses | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Published | 9 | 0 | 0 | 9 |
| Target and push further | 6 | 67 | 53 | 126 |
| All | 15 | 67 | 53 | 135 |

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
| `DONOR-003` | Relationships | target | partial | `src/coffer/donor-depth.ts`, `src/coffer/ui/donor-depth.ts`, `docs/donor-depth.md` | Reciprocal spouse, employer, board member, foundation officer and introduced-by links show on both records and filter donor lists. Household salutations, head and combined totals remain. |
| `DONOR-004` | Interaction timeline | target | partial | `src/coffer/donor-depth.ts`, `src/coffer/ui/donor-timeline.ts`, `docs/donor-depth.md` | Calls, meetings and emails record date, participants, notes, next step and author beside gifts, pledges and receipt events in one timeline. Confidential notes, timeline filters and the broader task/event integrations remain. |
| `DONOR-005` | Custom fields and tags | target | missing |  | No custom fields, tags or categories. |
| `DONOR-006` | Duplicate detection and merge | target | partial | `src/coffer/donor-merge.ts`, `src/coffer/imports/service.ts`, `docs/donor-depth.md` | Reviewed manual merges combine gifts, pledges, conversations, relationships and provider links, preserve financial facts and retain source import aliases. Duplicate suggestions, field comparison and undo remain. |
| `DONOR-007` | Saved searches and lists | target | partial | `src/coffer/donors.ts`, `src/coffer/ui/donors.ts` | Donor search includes reciprocal relationship-type and connected-donor filters. General saved lists and undoable bulk actions remain. |
| `DONOR-008` | Documents on records | target | missing |  | No attachments. |
| `DONOR-009` | Address verification and NCOA | target | missing |  | No address verification or NCOA. |
| `DONOR-010` | Volunteer history | target | missing |  | No volunteer records. |
| `DONOR-011` | Giving summary | target | done | `src/coffer/giving-summary.ts`, `src/coffer/ui/giving-summary.ts`, `tests/giving-summary.test.mjs`, `tests/giving.test.mjs` |  |
| `DONOR-012` | Constituent status: active, inactive and deceased | target | missing |  | Constituents have no status; appeals exclude only on consent and address, and erasure is the only way to stop a record being used. |
| `DONOR-013` | Several emails, phones and addresses | target | partial | `src/coffer/donors.ts`, `migrations/core/0016_coffer.sql` | A donor has one email (refused if any other record has it), one phone and one postal address; no further contact points, types, primaries, seasonal ranges or email shared within a household. |
| `DONOR-014` | Name parts, salutations and envelope name | target | partial | `src/coffer/donors.ts`, `src/coffer/settings.ts`, `tests/coffer.test.mjs` | A donor has one free-text name and letters merge only `{{donor_name}}`; no prefix, first, middle and last name, suffix or nickname, no computed or overridden salutations or envelope name, and no admin-set defaults. |
| `DONOR-015` | Solicitation restrictions | target | missing |  | No solicitation restriction: consent is per channel (email and postal) only, and appeals exclude only on consent and address. |
| `GIFT-002` | Batch gift entry and deposits | target | missing |  | Gifts are entered one at a time; no batches or deposit totals. |
| `GIFT-003` | Campaign, appeal, fund and channel attribution | target | partial | `src/coffer/gifts.ts` | Each gift has one free-text fund; no campaigns, appeals or source as structured references. |
| `GIFT-004` | Split gifts | target | done | `src/coffer/gift-splits.ts`, `migrations/core/0039_coffer_gift_splits.sql`, `src/coffer/fund-report.ts`, `tests/split-gifts.test.mjs` |  |
| `GIFT-005` | Pledges, installments and balances | target | partial | `src/coffer/pledges.ts`, `src/coffer/ui/pledges.ts`, `tests/pledges.test.mjs` | Dated installments total the pledge, allocations match gifts by donor/fund without overpayment, and reversals reopen balances. Write-offs, reductions, campaign attribution and recurring-plan payment remain. |
| `GIFT-006` | Soft credits | target | partial | `src/coffer/gift-depth.ts`, `tests/soft-credits.test.mjs` | Full or partial recognition links another donor to a gift and appears in a separate reversal-aware total without increasing received totals or tax receipts. Separate acknowledgement status and report integration remain. |
| `GIFT-007` | Matching gifts | target | partial | `src/coffer/gift-depth.ts`, `src/coffer/ui/gift-depth.ts`, `tests/soft-credits.test.mjs` | Expected employer amount/deadline links the original gift to a received employer ledger gift, with overdue and reversal-aware states. Program lookup, submission workflow, automatic employee recognition and submission reminders remain. |
| `GIFT-008` | Tribute gifts | target | partial | `src/coffer/gift-depth.ts`, `src/coffer/acknowledgements.ts`, `src/coffer/year-end.ts`, `tests/soft-credits.test.mjs` | Honor/memory, honoree and notification contact are recorded on gifts and included in approved gift/year-end receipt text. Tribute grouping, notification sending and incumbent tribute imports remain. |
| `GIFT-009` | In-kind gifts | target | missing |  | Gifts are monetary only. |
| `GIFT-010` | Stock, DAF grants and IRA distributions | target | missing |  | No stock, DAF or QCD gift types. |
| `GIFT-011` | Anonymous gifts and recognition names | target | missing |  | No anonymity flag or recognition name. |
| `GIVE-001` | Donation forms | target | partial | `src/coffer/giving/`, `tests/giving.test.mjs` | Hosted campaign forms collect once/monthly card and Link gifts and retain fund/campaign attribution. Advanced fields, embedding and the specified performance/accessibility acceptance remain outstanding. |
| `GIVE-002` | Campaign pages | target | partial | `src/coffer/giving/`, `tests/giving.test.mjs` | Custom-path public campaign stories, goals, ledger totals, gift counts and recurring donor counts ship. Uploaded media, donor walls and closing dates remain outstanding. |
| `GIVE-003` | Recurring giving | target | partial | `src/coffer/giving/`, `tests/giving.test.mjs` | Monthly Stripe subscriptions record successful installments and show status and recovery; donors cancel at period end. Quarterly/annual plans, staff editing, pause/resume and the three-month test-clock acceptance remain outstanding. |
| `GIVE-004` | Card, bank, wallet and PayPal checkout | target | partial | `src/coffer/giving/`, `tests/giving.test.mjs` | Stripe-hosted card and Link checkout ships, with Apple Pay offered on supported devices. ACH is coming soon pending a US test account; Apple Pay device payment, PayPal/Venmo, ACH settlement/returns and staff entry remain outstanding. No card numbers enter Coffer. |
| `GIVE-005` | Donor portal | target | partial | `src/coffer/giving/`, `tests/giving.test.mjs` | Emailed single-use links open a donor-only portal to view monthly plans, update cards at Stripe and cancel. Statements, amounts/frequencies, pause, communication preferences and cancellation tasks remain outstanding. |
| `GIVE-006` | Failed recurring payments | target | partial | `src/coffer/giving/`, `tests/giving.test.mjs` | Stripe schedules retries; verified failure outcomes email private card-update links and successful recovery is recorded. Expiry warnings and staff escalation after exhausted retries remain outstanding. |
| `GIVE-007` | Fraud and card-testing protection | target | missing |  | No forms to protect. |
| `GIVE-008` | Text-to-give | target | missing |  | No text-to-give. |
| `GIVE-009` | Staff-entered card and bank payments | target | missing |  | Coffer takes no payments; staff record a gift by hand after the money arrives elsewhere. |
| `CAMP-001` | Campaigns with goals | target | partial | `src/coffer/giving/`, `tests/giving.test.mjs` | Published campaigns have a goal and fund, with ledger-derived raised/gift totals and distinct recurring donors. Dates, nested campaigns, pledges/soft credits, manual attribution and additional campaign statistics remain outstanding. |
| `CAMP-002` | Fundraising events | target | missing |  | No events. |
| `CAMP-003` | Peer-to-peer fundraising | target | missing |  | No peer-to-peer pages. |
| `CAMP-004` | Memberships | target | missing |  | No memberships. |
| `CAMP-005` | Auction results as gifts | target | missing |  | No events or auction import. |
| `PAY-001` | Live Stripe connection | target | partial | `src/coffer/payments/`, `tests/payments.test.mjs` | Signed live charge, refund, dispute, failure and payout events, external donor matching and replay-safe money entries ship alongside saved-page move-in. OAuth/automatic endpoint registration, scheduled backfill/sweep and an ambiguous-match review queue remain outstanding. |
| `PAY-002` | Payouts with their gifts | target | done | `src/coffer/payments/`, `tests/payments.test.mjs` | Payout detail retains every processor entry, gross, fees and fund split and flags differences; automatic membership comes from paginated Stripe balance APIs, manual membership is explicitly selected and validated. Posting requires a completed exact-cent match. |
| `PAY-003` | Refunds and disputes | target | partial | `src/coffer/payments/`, `tests/payments.test.mjs` | Processor refunds and disputes append immutable contribution reversals and a dispute win reinstates the contribution. No receipt correction, staff-initiated refund, relationship-manager notice or evidence due-date workflow yet. |
| `PAY-004` | Processing fees and fee cover | target | partial | `src/coffer/payments/`, `tests/payments.test.mjs` | Immutable balance transactions record processor gross, fees and net, shown by fund in each payout. Donor fee-cover checkout and form/campaign fee reports remain outstanding. |
| `PAY-005` | Other giving platforms | target | missing |  | No other platform connections. |
| `PAY-006` | Shop orders record only the contribution | target | missing |  | No shop connection. |
| `FIN-001` | QuickBooks Online sync | target | partial | `src/coffer/payments/`, `tests/payments.test.mjs` | Mapped fund, bank and fee accounts export as a balanced QBO journal CSV with fund classes; Desktop IIF is separate. No QBO OAuth/API connection or check-batch posting yet. |
| `FIN-002` | Pantry sync | target | partial | `src/coffer/payments/`, `tests/payments.test.mjs` | Paid matched USD payouts become evidence-backed Pantry journal proposals; human Pantry approval posts the deposit, and Coffer refresh records its journal ID. Saved submission claims prevent duplicate or uncertain resends. Check batches remain outstanding; live Stripe-to-Pantry acceptance needs a USD-settling Stripe test account. |
| `FIN-003` | Restricted funds | target | partial | `src/coffer/gifts.ts`, `src/coffer/payments/pantry.ts` | Every gift has a free-text fund (default Unrestricted); payout fund names map to accounting accounts through installation settings. Restriction types and release reports remain outstanding. |
| `FIN-004` | Journal export for other ledgers | target | partial | `src/coffer/payments/`, `tests/payments.test.mjs` | Each reconciled payout exports a mapped journal CSV or Desktop IIF. A combined per-period download remains outstanding. |
| `FIN-005` | Reconciliation report | target | partial | `src/coffer/payments/`, `tests/payments.test.mjs` | Per-payout gifts, refunds, fees, net, match difference and Pantry destination/journal ID are visible. Period-wide ledger/processor/deposit reconciliation including pending ACH and check batches remains outstanding. |
| `RCPT-001` | Immediate email receipts | target | partial | `src/coffer/receipt-mail.ts`, `tests/receipts.test.mjs` | Approved per-gift receipts are sent from install SendGrid; automatic online-gift triggers within a minute, domain verification and attached PDFs remain unbuilt. Managed integrations are not available yet. |
| `RCPT-002` | Acknowledgements delivered by email | target | done | `src/coffer/letter-delivery.ts`, `tests/receipts.test.mjs` | Approved frozen batches send once per letter through self-hosted SendGrid, route donors without an address or with a known receipt bounce/complaint to print; marketing withdrawals still receive receipts, and show submitted versus signed provider delivery results. RER Managed sending is not available yet. |
| `RCPT-003` | Print-ready letters, labels and envelopes | target | partial | `src/coffer/ui/print-letters.ts`, `tests/receipts.test.mjs` | Single and batch print-styled US Letter documents support window-envelope placement and browser Save as PDF alongside CSV. Labels, envelope-only layouts, Word files, household grouping and Lob remain unbuilt. |
| `RCPT-004` | Year-end giving statements | target | partial | `src/coffer/year-end.ts`, `tests/receipts.test.mjs` | Per-donor calendar-year statements itemize all unreversed gifts including imported gifts, goods values and deductible totals, then use approved email or print delivery. Unknown goods answers require review. Portal requests, automatic January scheduling, household grouping, deceased-recipient rules and corrected reissues remain unbuilt. |
| `RCPT-005` | US receipt rules | target | partial | `src/coffer/settings.ts`, `src/coffer/acknowledgements.ts`, `tests/coffer.test.mjs` | Templates must carry donor, amount, date, organization and the goods-or-services statement, and the $250 threshold works; no quid pro quo rule for payments over $75, token-benefit or religious-benefit wording. |
| `RCPT-006` | Delivery tracking | target | partial | `src/coffer/letter-delivery.ts`, `tests/receipts.test.mjs` | Signed SendGrid delivered, bounce, dropped and complaint events are recorded per letter, deduplicated and shown on donor and batch; negative results route the donor to print. Configure the signed provider webhook and verification key, or explicitly fetch events with SendGrid Email Logs access. Open tracking, address-fix tasks and print-vendor events remain unbuilt. |
| `RCPT-007` | Thank-you templates | target | partial | `src/coffer/settings.ts`, `tests/coffer.test.mjs` | One reviewed letter template with required facts exists; no templates per form, campaign or gift type. |
| `RCPT-008` | Corrected and voided receipts | target | missing |  | No receipt numbering, voiding or reissue. |
| `RCPT-009` | One piece per household | target | missing |  | Letters and appeal exports are one row per gift or per donor; no household grouping, addressee or combined totals. |
| `RCPT-010` | Merge fields in every template | target | partial | `src/coffer/settings.ts`, `tests/coffer.test.mjs` | Letter templates merge a fixed list of nine fields (date, donor name, amount, gift date, fund, goods statement, organization, EIN, deductible amount) and are refused for unknown, missing required or unclosed fields; no name parts, salutations, household, contact-point, giving-summary or custom fields, no fallbacks, field list API or blank check. |
| `RCPT-011` | Acknowledgement status on every gift and soft credit | target | partial | `src/coffer/donors.ts`, `src/coffer/ui/donors.ts`, `src/coffer/acknowledgements.ts`, `tests/coffer.test.mjs` | A gift is due until it sits in a live letter batch, and the donor page shows each gift's letter state (prepared, approved, exported, sent) or "Letter due"; there is no stored acknowledgement status, method or link, no way to mark a gift acknowledged outside a batch or do not acknowledge, no status on soft credits, and no imported status. |
| `COMM-001` | Preferences and unsubscribes everywhere | target | partial | `docs/COMMUNICATIONS.md` | Email provider opt-outs append withdrawals and Coffer email withdrawals synchronize to Mango or Mailchimp; each marketing submission checks both sides. Receipts remain transactional. SMS/phone, topics, frequency preferences and other providers remain. |
| `COMM-002` | Appeals sent through Mango or Mailchimp | target | partial | `docs/COMMUNICATIONS.md` | Frozen, hash-approved appeals merge donor names and giving figures into exact-recipient Mango or Mailchimp campaigns, with per-donor submission and provider results. Real local Mango draft/sync paths and hosted appeal/welcome delivery, a real unsubscribe click, reverse withdrawal and a transactional receipt after opt-out are proven. Mailchimp remains fixture-only. Name-part/custom-field merges, tags, engagement/attribution, scheduled appeals and solicitation restrictions remain. |
| `COMM-003` | Constant Contact | target | missing |  | No Constant Contact connection. |
| `COMM-004` | One-to-one email and mailbox logging | target | missing |  | No mailbox connection or personal email. |
| `COMM-005` | Replies reach the right person | target | partial | `docs/COMMUNICATIONS.md` | The actual Email Routing handler logs known-donor replies, assigns and forwards to an active prospect owner (or the installation owner), files automatic replies, and exposes follow-up tasks. Live routing was proven on 17 October 2026 (an Email Routing rule to a hosted Worker turned a donor’s appeal reply into a task for the prospect owner); forwarding a copy needs the assignee verified as an Email Routing destination, and proposed stop-request withdrawals remain. |
| `COMM-006` | SMS outreach | target | missing |  | No SMS. |
| `COMM-007` | Direct mail appeals | target | partial | `src/coffer/appeals.ts`, `tests/coffer.test.mjs` | Mail-channel audiences with postal addresses export as CSV; no ask amounts, response codes or mailing history. |
| `COMM-008` | Appeal results | target | missing |  | No appeal results. |
| `STEW-001` | Tasks with owners and reminders | target | partial | `src/coffer/call-tasks.ts`, `src/coffer/ui/call-tasks.ts`, `tests/pipeline.test.mjs` | Owned, dated call tasks from lapses and unpaid due pledge installments support assignment, reassignment, snooze and atomic donor-timeline call completion. Recurring tasks, reminders, escalation and other task kinds remain. |
| `STEW-002` | Recurring tasks | target | missing |  | No tasks. |
| `STEW-003` | Stewardship journeys | target | partial | `docs/COMMUNICATIONS.md` | A person publishes the first-gift thank-you, impact and second-ask series. Durable due steps run through the provider on the minute Worker scheduler; another gift, unavailable email consent, merge or erasure stops pending work. Other triggers, branches, frequency caps, inactive/deceased statuses and solicitation restrictions remain. |
| `STEW-004` | Pledge reminders and invoices | target | partial | `src/coffer/pledges.ts`, `src/server.ts`, `tests/pledges.test.mjs` | Self-hosted SendGrid reminders run daily or by staff before each unpaid installment using current email permission, with durable single-attempt submission states. Managed email is not available yet. Unpaid due installments now feed the owned call list. Pay links, printable invoices and automatic overdue follow-up remain. |
| `STEW-005` | Gift-triggered rules | target | missing |  | No rules. |
| `STEW-006` | Meetings and calendars | target | missing |  | No calendar connection. |
| `MAJOR-001` | Opportunity pipeline | target | partial | `src/coffer/major-gifts.ts`, `src/coffer/ui/major-gifts.ts`, `tests/pipeline.test.mjs` | Identify, qualify, cultivate, ask and stewardship opportunities carry ask amount, expected close, owner and next step; lists filter by owner and stage. Configurable stages, probability, campaign/fund forecasts and closed-won gift linkage remain. |
| `MAJOR-002` | Portfolios and moves | target | partial | `src/coffer/major-gifts.ts`, `tests/pipeline.test.mjs` | Opportunities have staff owners, next steps and engagement inputs from recorded contacts. Portfolio definitions, manager moves reporting and untouched-prospect flags remain. |
| `MAJOR-003` | Action plans and proposals | target | missing |  | No plans or proposals. |
| `MAJOR-004` | Engagement and retention scores | target | partial | `src/coffer/major-gifts.ts`, `src/coffer/ui/major-gifts.ts`, `tests/pipeline.test.mjs` | Prospect scores expose recency, frequency, amount and conversation inputs with their points and the full fixed formula. Configurable weights, broader engagement sources and scores on every constituent remain. |
| `MAJOR-005` | Prospect research | target | missing |  | No prospect research. |
| `MAJOR-006` | Grants from foundations and corporations | target | missing |  | No grant tracking. |
| `MAJOR-007` | Planned giving | target | missing |  | No planned-giving records. |
| `REPORT-001` | Donor retention | target | partial | `src/coffer/retention.ts`, `src/coffer/ui/retention.ts`, `tests/pipeline.test.mjs` | Calendar-year retained, new, lapsed and recaptured counts and net amounts drill to every underlying donor; signed adjustments and erased identities reconcile to the contribution ledger. Fiscal years, list/fund/campaign filters and upgraded/downgraded cohorts remain. |
| `REPORT-002` | LYBUNT and SYBUNT lists | target | partial | `src/coffer/lapses.ts`, `src/coffer/ui/lapses.ts`, `tests/pipeline.test.mjs`, `tests/giving.test.mjs` | LYBUNT and earlier-year SYBUNT lists show reasons, last gifts and annual amounts at risk, with stopped monthly-plan flags and owned call creation. Direct appeal and journey enrollment remain. |
| `REPORT-003` | Fundraising dashboards | target | partial | `src/coffer/ui/home.ts` | Today shows the current calendar year's total and acknowledgement backlog; no breakdowns, goals, comparisons or drill-down. |
| `REPORT-004` | Report builder | target | missing |  | No report builder. |
| `REPORT-005` | Scheduled reports | target | missing |  | No scheduled reports. |
| `REPORT-006` | Recurring giving health | target | missing |  | No recurring plans to report. |
| `REPORT-007` | IRS Form 990 support | target | missing |  | No Form 990 reports. |
| `REPORT-008` | Raised by state | target | missing |  | Each donor stores a current state, but there is no address history or report by state. |
| `MOVE-001` | From Little Green Light | target | partial | `src/coffer/move-in/service.ts`, `src/coffer/move-in/plan.ts`, `src/coffer/ui/crm-move-in.ts`, `tests/move-in.test.mjs`, `docs/MOVE-IN-SOURCES.md` | Constituent names are authoritative; display names in gifts and relationships never block for name differences. Documented LGL CSV/XLSX constituent and fundraising exports preview donors, households (explicit, or spouses and people at one address; never merged by name), gifts, funds/campaigns, relationships, soft credits, pledges/installments and notes, with source controls, every blocking row listed (paged, filterable, CSV), a preview that plans every part, part-by-part apply that names a failing part's rows, year-by-year re-import by LGL ID, and undo. Full multi-contact/name/custom-field, consent/restriction, acknowledgement, tribute and recurring-vault migration remains outside this export implementation. |
| `MOVE-002` | From Bloomerang | target | partial | `src/coffer/move-in/service.ts`, `src/coffer/move-in/plan.ts`, `src/coffer/ui/crm-move-in.ts`, `tests/move-in.test.mjs`, `docs/MOVE-IN-SOURCES.md` | Documented Bloomerang CSV/XLSX reports import the same donor/gift history and attribution with source-control reconciliation and atomic apply/undo. REST API, full contact/custom-field, task, consent/restriction, acknowledgement, tribute and recurring-vault migration remains unbuilt. |
| `MOVE-003` | From Raiser's Edge NXT | target | partial | `src/coffer/move-in/service.ts`, `src/coffer/move-in/plan.ts`, `src/coffer/ui/crm-move-in.ts`, `tests/move-in.test.mjs`, `docs/MOVE-IN-SOURCES.md` | Configured NXT database-view CSV/XLSX constituent/gift reports import donor/gift history, households, relationships, soft credits, pledges and notes. Grouped web-list splits and repeated source IDs are explicitly blocked pending designation exports. SKY API, opportunities, full custom fields/contacts, restrictions, acknowledgement and recurring-vault migration remains unbuilt. |
| `MOVE-004` | From Neon CRM | target | missing |  | No Neon CRM importer. |
| `MOVE-005` | From Givebutter and Zeffy | target | missing |  | No Givebutter or Zeffy importer. |
| `MOVE-006` | Any spreadsheet | target | missing |  | No general importer. |
| `MOVE-007` | Totals checked before the switch | target | partial | `src/coffer/move-in/service.ts`, `src/coffer/move-in/plan.ts`, `src/coffer/ui/crm-move-in.ts`, `tests/move-in.test.mjs`, `docs/MOVE-IN-SOURCES.md` | CSV/XLSX move-ins compare received gift counts and cents by year, fund and donor with raw source rows and independently supplied source report controls; existing imported net balances participate. Named differences or unmapped values block until resolved or accepted with a recorded reason. Stable source IDs, resumable part-by-part apply with a recheckable totals check from the gifts in Coffer (per move-in, including gifts an earlier move-in brought), and undo ship; later call tasks and opportunities block undo. The review asks whether gifts before a date (default the move-in date) were already thanked; those never become due or missing receipts. Cross-account vault transfer, per-gift acknowledgement status reconciliation, restriction/tribute controls and cutover sign-off remain unbuilt. |
| `MOVE-009` | Recurring donors move with their cards and bank accounts | target | partial | `src/coffer/imports/subscriptions.ts`, `docs/MOVE-IN.md`, `tests/coffer.test.mjs` | Supported active fixed-price USD monthly subscriptions from the same Stripe account appear on donors with their existing customer/subscription IDs; Stripe continues billing without a new charge or card transfer. Cross-account vault transfer, ACH mapping and other schedules remain unbuilt. |
| `MOVE-008` | Consent and preferences moved with provenance | target | missing |  | No importer carries consent. |
| `MOVE-010` | Custom fields carried across | target | missing |  | No custom fields, and no importer other than Stripe's, which reads no custom data. |
| `MOVE-011` | Switching guide for each incumbent | target | partial | `src/coffer/move-in/service.ts`, `src/coffer/move-in/plan.ts`, `src/coffer/ui/crm-move-in.ts`, `tests/move-in.test.mjs`, `docs/MOVE-IN-SOURCES.md` | The CRM export guide gives vendor report/menu guidance, official source links, required IDs, supported fields and source control interpretation for LGL, Bloomerang and NXT, alongside the Stripe guide. PCI transfer and an installation cutover checklist remain unbuilt. |
| `TEAM-001` | Roles and record-level access | target | partial | `src/coffer/commands.ts`, `src/coffer/auth.ts`, `tests/coffer.test.mjs` | Owner, admin, member and agent roles guard every command; no fundraiser, finance, volunteer or read-only roles, portfolio scoping, confidential fields, managers or call capacity. |
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
| `DEV-001` | Reconciles every gift | push-further | partial | `src/coffer/agent/reconciliation.ts`, `tests/agent-reconciliation.test.mjs`, `docs/DEVELOPMENT-AGENT.md` | Stripe charges/payouts, contributions/funds and exact Pantry proposal/journal state are compared with source IDs. Safe contribution and missing-gift corrections have explicit apply and compensating undo; payout/accounting exceptions require Payments/Pantry review. Broader finance-role approvals and QuickBooks integration remain. |
| `DEV-002` | Rescues failed monthly gifts | push-further | partial | `src/coffer/agent/recovery.ts`, `tests/agent-recovery.test.mjs`, `docs/DEVELOPMENT-AGENT.md` | Signed failures request one private card-update email; Stripe schedules retries and daily reconciliation records recovery/lapse. Reversible pause/resume and activity explain outcomes. Major-donor approvals, expiring-card notices and per-donor frequency grants remain. |
| `DEV-003` | Sends missing receipts | push-further | partial | `src/coffer/agent/receipts.ts`, `tests/agent-receipts.test.mjs`, `docs/DEVELOPMENT-AGENT.md` | Finds all missing and bounced gift receipts, freezes a batch for human approval and supports undo before dispatch. Unknown goods/services are held. Standing template approvals, migration acknowledgement policies and year-end delivery recovery remain. |
| `DEV-004` | Drafts stewardship from the nonprofit's own history | push-further | partial | `src/coffer/agent/stewardship.ts`, `tests/stewardship.test.mjs`, `docs/DEVELOPMENT-AGENT.md` | An install-owned sealed AI key enables cited drafts from actual gifts, signed adjustments, funds, conversations and tributes; people edit/review/send, stale sources block sending and discarded drafts restore. Relationship-manager scheduling, event/reply sources and confidential role scoping remain. |
| `DEV-005` | Shows who needs a human call next | push-further | partial | `src/coffer/call-tasks.ts`, `src/coffer/lapses.ts`, `src/coffer/retention.ts`, `tests/pipeline.test.mjs` | Staff review explained lapse/monthly/pledge flags, create owned dated calls, log outcomes on donor timelines and inspect donor-by-donor retention. Weekly agent ranking, capacity overflow, solicitation/status restrictions and called-vs-uncalled outcome attribution remain. |
| `DEV-006` | Briefs before a meeting | push-further | missing |  | No meetings or briefs. |
| `DEV-007` | Proves the move-in and the cutover | push-further | partial | `src/coffer/imports/service.ts`, `tests/coffer.test.mjs` | The Stripe move-in reads the connected account or a request-only restricted read key, follows pages for charges, Payment Intents, invoices and monthly plans, resolves customers, previews exact gifts and skips, imports supported existing monthly plans, checks actual gift counts/cents, and supports guarded undo (`src/coffer/imports/live-stripe.ts`, `src/coffer/imports/subscriptions.ts`, `docs/MOVE-IN.md`). No comparison agent, cross-account vault transfer, recurring reauthorization or cutover. |
| `DEV-008` | Keeps the database clean | push-further | missing |  | No data hygiene agent. |
| `DEV-009` | Confirms appeals actually reached donors | push-further | missing |  | No sender connection. |
| `DEV-010` | Follows pledges and grants to the end | push-further | missing |  | No installments, grants or matching gifts to follow. |
| `DEV-011` | Writes the development report | push-further | missing |  | No reports for the agent to draw on. |
| `DEV-012` | Agent grants and autonomy | push-further | partial | `src/coffer/auth.ts`, `src/coffer/commands.ts`, `tests/coffer.test.mjs` | Expiring, revocable agent keys can only read and prepare; no named grants, standing approvals, limits or kill switch. |

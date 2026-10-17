# Acceptance

A development lead at a US nonprofit replacing Bloomerang, Raiser's Edge NXT, Little Green Light, Neon CRM, Givebutter or Zeffy can do everything below. Each item names the clause in [CONTRACT.md](CONTRACT.md) it proves and that clause's status at commit `b7437e8` (17 October 2026). A build round works through the `partial` and `missing` items; an item is accepted only when its evidence runs through a public door.

## First release (accepted)

1. Move in a year of gifts from saved Stripe customer and charge pages: preview without changes, apply the exact reviewed plan, read its journal and undo it. (`IMPORT-001`, done)
2. See each donor's history: gifts by year as exact ledger lines (corrections are reversals), pledges, consent, letters and appeals. (`DONOR-001`, `GIFT-001`, done)
3. Acknowledge gifts of $250 or more on time: an agent or person prepares letters in the charity's own wording, a person approves, exports them and records when they went out. (`ACK-001`, `AGENT-001`, done)
4. Record an appeal only to donors whose current consent for that channel is yes; a change in consent stops approval and export. (`CONSENT-001`, `APPEAL-001`, done)
5. Keep custody: back up and restore into an empty installation, and erase a donor's personal data without losing the gift ledger or reviving them from an old backup or a later import. (`DATA-001`, done)
6. Every approval records who prepared and who approved the exact content. Roles are enforced on every server request. (`HTTP-001`, `AGENT-001`, done)

## Target

### Supporter records

7. **`DONOR-002` Organization records** (partial). An HTTP and browser journey creates a foundation with two contacts, records a $10,000 grant payment from it, and reads the gift on the foundation, not the contacts, with both contacts listing it as related.
8. **`DONOR-003` Relationships** (partial). An HTTP journey relates a donor to an employer and a spouse, reads the reciprocal relationship from both records, and checks that the household total counts a joint gift once.
9. **`DONOR-004` Interaction timeline** (partial). A browser journey at 1440 and 390 pixels logs a call and a confidential note on a donor, counting at most two taps or clicks plus typing for each, and a timed run with a 30-character note typed at five characters a second takes under ten seconds from the first tap to the entry on the timeline; it sees both on the timeline with the gift and receipt events, and a data-entry user is refused the confidential note through HTTP.
10. **`DONOR-005` Custom fields and tags** (missing). An HTTP journey defines a choice field and two tags, sets them on donors, finds the donors by field and tag in search and an appeal segment, sees them in a CSV export, and groups a report by the field (`REPORT-004`).
11. **`DONOR-006` Duplicate detection and merge** (partial). An HTTP and browser journey creates two records for one person through a form gift and a manual entry, finds them in the duplicates queue, merges them, reads one combined history with unchanged ledger totals, then undoes the merge; two spouses in one household who share an email never appear in the queue.
12. **`DONOR-007` Saved searches and lists** (partial). An HTTP journey saves a list of donors who gave $500 or more last year with email consent, adds a qualifying gift, and sees the list grow without editing it; the list feeds an appeal audience; a bulk action adds a tag and assigns a relationship manager to every record in the list, and undoing it restores each record.
13. **`DONOR-008` Documents on records** (missing). A browser journey attaches a PDF pledge agreement to a pledge, previews it, and a backup, restore and erasure include and then remove it.
14. **`DONOR-009` Address verification and NCOA** (missing). An HTTP journey with the Smarty and NCOA edges faked enters an address that standardises, runs an NCOA pass that moves one donor and flags one as undeliverable, and a mail appeal excludes the flagged donor with that reason.
15. **`DONOR-010` Volunteer history** (missing). An HTTP journey imports a volunteer-hours CSV, reads per-donor yearly hours on the donor page and filters a list of volunteers who have never given.
16. **`DONOR-011` Giving summary** (partial). An HTTP journey records gifts across three years with a July fiscal year and reads each summary figure back from the donor API and page.
17. **`DONOR-012` Constituent status: active, inactive and deceased** (missing). An HTTP journey marks a consenting donor deceased with a date; the next email appeal, mail appeal and journey step exclude them with the reason "deceased", their open task closes with that reason, and the household addressee and salutation change to the surviving spouse; an inactive donor is excluded with the reason "inactive"; the Little Green Light and Bloomerang importers read fixture records marked deceased and inactive and carry both statuses and the date of death.
18. **`DONOR-013` Several emails, phones and addresses** (partial). An HTTP journey gives a donor a home and a work email, a mobile and a home phone, and a home and a vacation address, then makes the work email primary; the next receipt goes to the work email and records it, and a mail appeal file uses the primary address; a seasonal address active from November to March is used by a mail file dated in January and not by one dated in June; two spouses in one household are saved with the same email and neither is flagged as a duplicate, an unrelated record with that email lands in the duplicates queue, and withdrawing one spouse's email consent leaves the other's current answer yes; the Bloomerang and Little Green Light importers read a fixture constituent with three emails and two addresses and carry all five with their types and primaries.

### Gifts and pledges

19. **`GIFT-002` Batch gift entry and deposits** (missing). A browser journey enters a 12-check batch at 1440 pixels with defaults, is refused closing it while it is $50 off the expected total, corrects it, closes it, and sees one deposit with 12 gifts, each with its check number; searching one check number finds its gift, and a reply card printed with a Bloomerang account number finds its donor by that number in batch lookup.
20. **`GIFT-003` Campaign, appeal, fund and channel attribution** (partial). An HTTP journey defines funds, a campaign and two appeals, records gifts against them through entry, a form and an import, and reads totals by each dimension that sum to the ledger.
21. **`GIFT-004` Split gifts** (missing). An HTTP journey splits a $1,000 check $600/$400 across two funds, refuses a split that sums to $999.99, issues one receipt for $1,000 and reads each fund's total.
22. **`GIFT-005` Pledges, installments and balances** (partial). An HTTP journey creates a $12,000 pledge in four quarterly installments, pays two, sees the third overdue on the pledge and the donor page, reduces the balance with a reason, and reads the full history.
23. **`GIFT-006` Soft credits** (missing). An HTTP journey records a DAF grant hard-credited to the sponsor and soft-credited to the advisor, and reads the advisor's soft-credit total separately from hard credit in the donor API and a retention report.
24. **`GIFT-007` Matching gifts** (missing). An HTTP journey with the Double the Donation edge faked records a $500 gift, finds the employer's 1:1 program, moves the match through submitted to received when the employer's $500 check arrives, and reads the linked gifts and soft credit.
25. **`GIFT-008` Tribute gifts** (missing). A form gift in memory of a named person with a notify-address produces a tribute record, a notification for approval that omits the amount, and a tribute total of all gifts in that name.
26. **`GIFT-009` In-kind gifts** (missing). An HTTP journey records a donated laptop and a $6,000 artwork, reads acknowledgements that describe each without a value, sees the Form 8283 reminder on the artwork, and a Form 8282 reminder when the artwork is marked sold a year later.
27. **`GIFT-010` Stock, DAF grants and IRA distributions** (missing). An HTTP journey records one of each, reads the right hard and soft credits, and checks each acknowledgement's wording, including the absence of deductibility language on the DAF grant.
28. **`GIFT-011` Anonymous gifts and recognition names** (missing). An HTTP journey marks one donor anonymous and one gift anonymous, gives through a campaign page, and reads a donor wall and an honour-roll export that show "Anonymous" for both and recognition names for the others, while the staff donor page, totals and receipts include both gifts.

### Online giving

29. **`GIVE-001` Donation forms** (missing). A browser journey builds a form with a custom question, embeds it on a test page, and gives $50 at 1440 and 390 pixels with the Stripe edge in test mode; the gift, donor, consent answer, custom-field answer and receipt appear in Coffer, and an axe check of the form passes; a timing run of the hosted form under the stated profile (CDP network emulation and `Emulation.setCPUThrottlingRate` 4) records a median of five cold loads under one second to input-ready and under two seconds to payment-field-ready.
30. **`GIVE-002` Campaign pages** (missing). A browser journey publishes a campaign page with a $60,000 goal, gives twice through it, and sees the thermometer, donor count and opt-in donor wall update; the page is served at the custom path set on the nonprofit's own domain (for example `/give/spring`); after the close date the page refuses new gifts with a message.
31. **`GIVE-003` Recurring giving** (missing). An HTTP journey with Stripe in test mode and a test clock starts a $25 monthly plan, advances three months, reads three linked gifts, pauses and resumes the plan, and cancels it.
32. **`GIVE-004` Card, bank, wallet and PayPal checkout** (missing). A browser journey with provider test modes gives by card, ACH (with a later R01 return that writes a reversal and a task), Apple Pay on a WebKit device profile and PayPal, and an inspection of stored records finds no card or account numbers.
33. **`GIVE-005` Donor portal** (missing). A browser journey at 390 pixels signs a donor in by link, downloads last year's statement, replaces an expiring card, lowers the monthly amount and withdraws email consent; staff see each change on the timeline and a cancellation task.
34. **`GIVE-006` Failed recurring payments** (missing). An HTTP journey with the Stripe edge faked fails a monthly installment, sends the donor notice, recovers on the second retry and records it; a second plan exhausts retries and opens a task; an expiring card sends the warning a month ahead.
35. **`GIVE-007` Fraud and card-testing protection** (missing). An HTTP journey sends 30 small card attempts from one address in a minute; attempts after the limit are refused, the form pauses and the admin is alerted, and no donor records are created for the failures.
36. **`GIVE-008` Text-to-give** (missing). An HTTP journey with the Twilio edge faked texts a keyword, follows the link, gives, and sees the gift attributed to text-to-give; a STOP reply records SMS consent as withdrawn.
37. **`GIVE-009` Staff-entered card and bank payments** (missing). A browser journey with Stripe in test mode has a fundraiser key in a $100 card gift on a donor page, start a $20 monthly plan on an ACH test account with a spoken authorization recorded, and charge the donor's saved card for a second gift; it reads three ledger lines (the ACH one after its test settlement) with source "phone", the fundraiser as entering user and a receipt for each, and the plan active on the ACH payment method with its authorization; a data-entry user is refused the charge through HTTP, no `GIVE-007` limit counts the three payments, and an inspection of stored records finds no card or account number.

### Campaigns, events and memberships

38. **`CAMP-001` Campaigns with goals** (missing). An HTTP journey creates a spring appeal campaign with a $60,000 goal, records form, check and pledge gifts against it, and reads raised, pledged, donor and recurring counts that match the ledger.
39. **`CAMP-002` Fundraising events** (missing). A browser journey sells a $150 gala ticket with a $60 dinner value, checks the guest in at 390 pixels, and reads a receipt stating $90 deductible and the attendance on the guest's timeline.
40. **`CAMP-003` Peer-to-peer fundraising** (missing). A browser journey creates a team and two personal pages, gives through each, and reads the leaderboard, the donor hard credits and the fundraiser soft credits.
41. **`CAMP-004` Memberships** (missing). An HTTP journey sells an annual membership with auto-renew, advances a test clock past the term, sees the renewal charge, then lets a second membership lapse and receives its reminder and lapsed status, and reads member counts by level.
42. **`CAMP-005` Auction results as gifts** (missing). An HTTP journey imports a fixture auction-results CSV with a $500 winning bid on a lot valued at $200, a $150 bid on a lot valued at $300, a $1,000 fund-a-need raise and one lot without a value; it reads a $500 payment with $300 deductible, a purchase with no contribution, a $1,000 gift and the valueless lot waiting for a person, and each receipt carries the quid pro quo statement.

### Payments

43. **`PAY-001` Live Stripe connection** (partial). An HTTP journey with Stripe in test mode connects an account, receives charge and refund webhooks (one replayed, one with a bad signature refused), drops one event and sees the daily sweep add it, and reviews an ambiguous donor match.
44. **`PAY-002` Payouts with their gifts** (missing). An HTTP journey with the Stripe edge faked receives a payout of 14 charges, two fees and one refund, opens it in Coffer, and reads gross, fees, refunds and net equal to the deposit.
45. **`PAY-003` Refunds and disputes** (partial). An HTTP journey with the Stripe edge faked refunds half a gift, opens a dispute on another and wins it, and reads the reversal lines, the corrected receipt and the reinstated gift.
46. **`PAY-004` Processing fees and fee cover** (missing). An HTTP journey gives $100 with fee cover, reads the gift, fee and receipt amounts, and a fee report by form that sums to the payouts.
47. **`PAY-005` Other giving platforms** (missing). An HTTP journey with the Givebutter edge faked ingests transactions and a changed transaction, and imports a Benevity disbursement CSV, reading gifts with source, fees and payout matched to donors.
48. **`PAY-006` Shop orders record only the contribution** (missing). An HTTP journey with the Stall edge faked receives an order with a $40 T-shirt, $6 shipping, $3.20 sales tax and a $25 donation line, and writes one $25 gift with a receipt for $25 only; a $60 charity T-shirt with a stated value of $20 writes a $40 contribution; refunding the order reverses only the contribution; the same order from the Shopify edge writes the same gift.

### Accounting

49. **`FIN-001` QuickBooks Online sync** (missing). An HTTP journey with the QuickBooks Online edge faked maps three funds, posts a payout and a check batch, replays the post without a duplicate, and reads deposits whose lines and totals equal Coffer's.
50. **`FIN-002` Pantry sync** (missing). An HTTP journey with the Pantry edge faked posts a payout and a check batch and reads matching deposits.
51. **`FIN-003` Restricted funds** (partial). An HTTP journey records restricted and unrestricted gifts, enters a spend against a restricted fund, and reads the release report.
52. **`FIN-004` Journal export for other ledgers** (missing). An HTTP journey downloads a month's journal and checks its totals by account against the ledger.
53. **`FIN-005` Reconciliation report** (missing). An HTTP journey builds a month with a pending ACH gift and a refund after payout and reads a report whose listed differences account for every cent.

### Receipts and acknowledgements

54. **`RCPT-001` Immediate email receipts** (missing). An HTTP journey with the mail and DNS edges faked shows the sending domain unverified until its SPF and DKIM records check, then gives online and reads one receipt message from that domain with the right amount, statement and PDF within a minute; a donor who withdrew email consent for appeals still receives it; with the batch setting on, closing a batch of three offline gifts sends a receipt for each gift with an email address, and with it off sends none.
55. **`RCPT-002` Acknowledgements delivered by email** (partial). An HTTP journey with the mail edge faked approves a batch of three letters, sends it, and reads two delivered emails and one letter routed to print, with the batch status computed from delivery.
56. **`RCPT-003` Print-ready letters, labels and envelopes** (partial). An HTTP journey downloads the PDF, labels and merge file for a batch and checks page count, addresses and placement; with the Lob edge faked the batch is mailed and tracking events land on each donor's timeline.
57. **`RCPT-004` Year-end giving statements** (missing). An HTTP journey approves and sends statements for donors with one-time, monthly and event gifts, reads each statement's gift lines and totals, and downloads one from the portal; a donor requests a copy from the portal and receives it; a gift corrected after sending reissues that statement marked as corrected with the change shown; and a household run reads one statement for two spouses.
58. **`RCPT-005` US receipt rules** (partial). An HTTP journey receipts a $250 gift, an $80 ticket with $50 of dinner (disclosure required though under $250), a gift with a token mug, and a non-cash gift, and checks each statement against the rule it exercises.
59. **`RCPT-006` Delivery tracking** (partial). An HTTP journey with the mail edge faked sends three receipts, one bounces, and the bounced one shows on the donor page with a task and a print option.
60. **`RCPT-007` Thank-you templates** (partial). An HTTP journey saves a first-gift template, refuses one missing the goods-or-services statement, gives a first and a second gift, and reads the different templates and their versions on each receipt.
61. **`RCPT-008` Corrected and voided receipts** (missing). An HTTP journey refunds half a receipted gift and reads a corrected receipt with the next number referencing the original, and a voided one for a fully reversed gift.
62. **`RCPT-009` One piece per household** (missing). An HTTP journey with two consenting spouses at one address, a gift from each and a joint gift hard-credited to one and soft-credited to the other prepares a mail appeal and a year-end statement run per household, and reads one piece each addressed with the household addressee and salutation, with a statement total that counts the joint gift once; the same runs set per constituent read two pieces each.

### Communication

63. **`COMM-001` Preferences and unsubscribes everywhere** (partial). An HTTP journey with sender edges faked has a donor unsubscribe in Mailchimp, reply STOP by text and change topics in the portal, and the next appeal of each channel excludes them with the reason; a donor who chose at most one appeal email a month is excluded from a second appeal that month with the reason "frequency".
64. **`COMM-002` Appeals sent through Mango or Mailchimp** (partial). An HTTP journey with the Mango and Mailchimp edges faked syncs an audience, sends an approved appeal to exactly its frozen recipients, receives results and an unsubscribe, and attributes a gift made from the tracked link.
65. **`COMM-003` Constant Contact** (missing). An HTTP journey with the Constant Contact edge faked syncs, sends and receives results.
66. **`COMM-004` One-to-one email and mailbox logging** (missing). An HTTP journey with the Gmail and Microsoft Graph edges faked logs a received and a sent message on the right donor, sends a personal email from the donor page, and logs one through the BCC address.
67. **`COMM-005` Replies reach the right person** (missing). An HTTP journey with inbound mail faked receives a thank-you reply, an out-of-office and a "please remove me", and sees a task for the manager, a filed auto-reply and a proposed withdrawal.
68. **`COMM-006` SMS outreach** (missing). An HTTP journey with the Twilio edge faked sends a thank-you text, holds one scheduled at 10 p.m. donor time until morning, records a reply as a task and a STOP as withdrawn consent.
69. **`COMM-007` Direct mail appeals** (partial). An HTTP journey prepares a mail appeal with ask amounts and codes, enters two coded reply gifts in a batch, and reads the appeal's response rate and the mailing on each donor.
70. **`COMM-008` Appeal results** (missing). An HTTP journey runs an email and a mail appeal with gifts from each and reads results that match the ledger and sender events.

### Stewardship and follow-up

71. **`STEW-001` Tasks with owners and reminders** (missing). A browser journey assigns a thank-you call due tomorrow, receives the reminder, completes it with a note that lands on the timeline, lets a second task go overdue past the delay and sees it on the assignee's manager's list and reminder, and sees a third, assigned to a person with no manager, escalate to the owner.
72. **`STEW-002` Recurring tasks** (missing). An HTTP journey completes a quarterly task and reads the next one dated three months on.
73. **`STEW-003` Stewardship journeys** (missing). An HTTP journey with sender edges faked publishes a three-step first-gift welcome, enrols a new donor, advances time through each step, and sees the donor leave when they give again; a second journey respects the frequency cap.
74. **`STEW-004` Pledge reminders and invoices** (missing). An HTTP journey creates a quarterly pledge, receives the reminder a week before an installment, pays through the link, and lets the next installment go overdue to see the follow-up and task.
75. **`STEW-005` Gift-triggered rules** (missing). An HTTP journey defines two rules, gives through a form and imports old gifts, and sees the rules fire for the new gift only.
76. **`STEW-006` Meetings and calendars** (missing). An HTTP journey with the calendar edge faked logs a meeting with a donor and receives a Dial booking that creates a meeting record and a preparation task.

### Major gifts and moves management

77. **`MAJOR-001` Opportunity pipeline** (missing). A browser journey creates three opportunities, moves one through to solicit, closes it won with a pledge, and reads a pipeline total that excludes the closed amount from the forecast.
78. **`MAJOR-002` Portfolios and moves** (missing). An HTTP journey assigns two portfolios, logs contacts on some prospects, and reads moves counts and a flagged list of untouched prospects per manager.
79. **`MAJOR-003` Action plans and proposals** (missing). An HTTP journey applies a four-step plan to an opportunity, completes two steps, attaches a proposal and records it as sent.
80. **`MAJOR-004` Engagement and retention scores** (missing). An HTTP journey builds donors with different histories and reads scores and factors that follow the formula as read from the scores settings page and its API, then changes a weight and sees the scores change.
81. **`MAJOR-005` Prospect research** (missing). An HTTP journey with the DonorSearch edge faked screens a list, reads stored ratings with provenance as an admin, is refused them as a data-entry user, and erases one donor's results.
82. **`MAJOR-006` Grants from foundations and corporations** (missing). An HTTP journey tracks a request from letter of inquiry to award, reads the restricted pledge and the report-due task, and records the payment against it.
83. **`MAJOR-007` Planned giving** (missing). An HTTP journey records a bequest intention, enrols the donor in the legacy society, and links a later estate distribution to it.

### Reporting

84. **`REPORT-001` Donor retention** (partial). An HTTP journey builds three years of giving and reads retention figures that match a hand calculation, then opens the lapsed figure to its donors.
85. **`REPORT-002` LYBUNT and SYBUNT lists** (missing). An HTTP journey reads both lists for a built history and sends the LYBUNT list to an appeal.
86. **`REPORT-003` Fundraising dashboards** (partial). A browser journey at 1440 and 390 pixels reads the dashboard for a built year and opens a fund total to the gifts that make it.
87. **`REPORT-004` Report builder** (missing). An HTTP journey saves a gifts-by-fund-by-month report, shares it with a member, and exports it as CSV and .xlsx with the same rows and totals that match the ledger; it then adds a column to the saved definition, exports the definition as JSON, imports it into a second installation and gets the same totals there.
88. **`REPORT-005` Scheduled reports** (missing). An HTTP journey schedules a weekly report with the mail edge faked, advances a week and reads the delivered report.
89. **`REPORT-006` Recurring giving health** (missing). An HTTP journey runs plans through starts, failures, recoveries and cancellations on a test clock and reads matching monthly figures.
90. **`REPORT-007` IRS Form 990 support** (missing). An HTTP journey with a built five-year history reads the Schedule B list under both rules and five-year totals that match the ledger.
91. **`REPORT-008` Raised by state** (missing). An HTTP journey records gifts from donors in three states, one with no address and one who moves state mid-year, and reads a by-state report for the year whose rows assign each gift to the state at its date and sum to the ledger total, then exports it as CSV.

### Moving in

92. **`MOVE-001` From Little Green Light** (missing). An HTTP journey imports a fixture LGL export set, previews counts and totals by year and fund, applies, reads a donor's full history with relationships, soft credits and notes, carries a constituent's three emails and two addresses with their types and primaries, and undoes.
93. **`MOVE-002` From Bloomerang** (missing). An HTTP journey with the Bloomerang edge faked imports a fixture account, reads totals by year and designation equal to the source, carries a constituent's three emails and two addresses with their types and primaries, finds a donor by its Bloomerang account number, and undoes.
94. **`MOVE-003` From Raiser's Edge NXT** (missing). An HTTP journey with the SKY API edge faked imports a fixture database, reads gifts with splits and opportunities equal to the source, and undoes.
95. **`MOVE-004` From Neon CRM** (missing). An HTTP journey with the Neon edge faked imports a fixture organization with memberships and events and reads matching totals.
96. **`MOVE-005` From Givebutter and Zeffy** (missing). An HTTP journey imports fixture Givebutter and Zeffy data and reads gifts with campaign and fee totals equal to the source.
97. **`MOVE-006` Any spreadsheet** (missing). A browser journey maps a gifts spreadsheet, translates two fund names, previews matches to existing donors, applies and undoes.
98. **`MOVE-007` Totals checked before the switch** (partial). An HTTP journey imports a fixture with one deliberate gap, reads the difference in the reconciliation, adopts two Stripe subscriptions, moves two vault-transferred plans, lists one plan whose payment method is missing from the mapping for reauthorization, finds an imported donor by its legacy ID, and records the owner's sign-off.
99. **`MOVE-009` Recurring donors move with their cards and bank accounts** (missing). An HTTP journey takes a fixture Bloomerang recurring-plan export with card and ACH plans and fixture Stripe mapping files: the card file once as CSV and once as JSON, and the ACH file in the `pm_` shape and in the `ba_` shape. It previews and applies, and reads each matched plan active on its imported ID with its original amount, fund, next charge date and history, each ACH plan citing the donor's original debit authorization. After the owner confirms the source stop, one card plan and one ACH plan each charge exactly once on a Stripe test clock. A plan whose card and a plan whose bank account are missing from the mappings are listed for reauthorization with that reason, nothing cancels the source plan, no stored record holds a card or account number, and the descriptor notice waits for approval.
100. **`MOVE-008` Consent and preferences moved with provenance** (missing). An HTTP journey imports an LGL fixture with opted-out and unknown donors and prepares an appeal that excludes both with their reasons.

### Team and access

101. **`TEAM-001` Roles and record-level access** (partial). An HTTP journey signs in as each role and is allowed or refused each listed action, including a portfolio-limited fundraiser opening another portfolio's prospect; an admin sets a member's manager and call capacity and reads them back, and a member is refused setting them.
102. **`TEAM-002` Single sign-on and two-step sign-in** (partial). A browser journey with the identity edge faked signs in through an OIDC provider, is refused password-only sign-in after the owner requires SSO, and completes a second factor on a non-SSO account.
103. **`TEAM-003` Audit log** (partial). An HTTP journey makes changes as two people and an agent and reads them in the audit log filtered by person and exported as CSV.

### Integrations and API

104. **`API-001` Public REST API** (partial). An HTTP journey creates a read-only key and a gift-entry key, reads donors with the first, is refused a write, records a gift idempotently with the second, and validates responses against the OpenAPI document.
105. **`API-002` Webhooks** (missing). An HTTP journey subscribes an endpoint, records a gift, verifies the signature, fails one delivery and sees the retry and replay.
106. **`API-003` Zapier and Crank** (missing). A Zapier CLI validation of the app passes, and a Crank flow triggered by a Coffer gift creates a task through the API.
107. **`API-004` MCP endpoint** (missing). An MCP client lists donors and drafts an acknowledgement batch through the endpoint, which a person then approves; a write outside its grant is refused.

### Mobile

108. **`MOBILE-001` Phone-ready web app** (partial). The browser journey asserts no horizontal scroll at 390 pixels on every screen, and a phone journey looks up a donor, logs a call and records a gift within two taps each.
109. **`MOBILE-002` Native iOS and Android apps** (missing). A native test on iOS and Android simulators logs a call offline, reconnects and sees it on the web timeline, and receives push notifications for an assigned task, a new major gift and a reply.
110. **`MOBILE-003` In-person giving** (missing). A native test with Stripe Terminal's simulated reader takes a $100 gift and reads the gift, donor and emailed receipt in Coffer.

### Data and ownership

111. **`DATA-002` Exports by record type** (partial). An HTTP journey exports each record type for a saved list and checks counts and totals against the API.
112. **`DATA-003` A donor's own data on request** (missing). An HTTP journey produces one donor's file, checks it holds every record type for them and nobody else, and reads the logged request.
113. **`OWN-001` Free, open source and owned** (done). The repository carries the MIT licence, deploys to the owner's account with the documented commands, and the donation form journey (`GIVE-001`) shows no tip prompt.
114. **`OWN-002` Runs on the nonprofit's own computer** (done). The nightly fresh-clone journey starts Coffer with `rer dev` from a new clone and completes the first-week browser journey.

### Push further: Development agent

115. **`DEV-001` Reconciles every gift** (missing). An HTTP journey with processor and accounting edges faked seeds four kinds of mismatch, runs the agent, and reads four explained exceptions with source citations and prepared corrections that apply only after a finance-role approval.
116. **`DEV-002` Rescues failed monthly gifts** (missing). An HTTP journey with the Stripe edge faked fails three plans (one major donor), runs the agent, sends two notices automatically under a standing approval, holds the major donor's for approval, recovers one plan and reports the outcome per plan.
117. **`DEV-003` Sends missing receipts** (partial). An HTTP journey seeds overdue and bounced receipts, runs the agent, sees standard ones sent under the standing approval and the unusual ones queued for a person with reasons.
118. **`DEV-004` Drafts stewardship from the nonprofit's own history** (missing). An HTTP journey with the model edge faked drafts touches for three donors; every claim in each draft links to a record, a draft citing a non-existent fact is rejected by the check, and nothing is sent until a fundraiser approves.
119. **`DEV-005` Shows who needs a human call next** (missing). An HTTP journey builds a history with lapsing, upgrading and silent donors and a manager with a capacity of 5; the agent creates 5 ranked call tasks with reasons and lists the rest as overflow; 3 calls are logged, 2 of those donors give within N days, the fiscal year closes, and the per-donor table reads call made, gift within N days and retained for every listed donor, with called and uncalled retention rates that match a hand calculation.
120. **`DEV-006` Briefs before a meeting** (missing). An HTTP journey schedules a meeting, receives the brief a day ahead, and checks every line against its linked record and that a data-entry user's brief omits research.
121. **`DEV-007` Proves the move-in and the cutover** (partial). An HTTP journey imports a fixture with gaps and a non-adoptable plan, runs the agent, reads the exception list and drafted campaign, re-authorizes the plan and records the owner's cutover.
122. **`DEV-008` Keeps the database clean** (missing). An HTTP journey seeds duplicates, a returned letter and a missing salutation, runs the agent, and reads proposals that change nothing until accepted and then appear in the audit log.
123. **`DEV-009` Confirms appeals actually reached donors** (missing). An HTTP journey with the Mailchimp edge faked sends an appeal where five recipients were dropped, runs the agent, and reads the five flagged with a prepared resend for approval.
124. **`DEV-010` Follows pledges and grants to the end** (missing). An HTTP journey lets a pledge installment, a grant report and a match go overdue, runs the agent, and reads reminders, an escalation and a recorded resolution for each.
125. **`DEV-011` Writes the development report** (missing). An HTTP journey runs the agent on a built month, checks every number against `REPORT-*` outputs, and sends only after approval.
126. **`DEV-012` Agent grants and autonomy** (partial). An HTTP journey grants an agent receipt sending under a template version, sees it send within limits, refuses a send over the daily limit and a send after the template changes, and stops it with the kill switch.

Fakes are allowed only at a paid or network edge; a provider fake proves Coffer's side only. Local checks do not prove hosted deployment; the independent stranger journey is run separately.

# Coffer Agent surface (draft)

Draft Agent surface for Coffer, written by ct on 28 October 2026 to the contract standard's section 13. It maps every Core clause of `CONTRACT.md` at main `9940fe174aca82f2129e7279156aa8754e68ed96` (139 Core clauses). It is not part of CONTRACT.md yet: the seed's contract cleanup folds the `### Agent surface` area below into CONTRACT.md as the last area under Target clauses, and the rows under "Status rows" into its Status table. Old clauses whose text fixes what happens to an agent's step: ACK-001, AGENT-001, DONOR-003, DONOR-008, DONOR-010, DONOR-015, GIFT-005, GIFT-008, GIFT-009, GIFT-011, GIVE-010, RCPT-003, RCPT-006, RCPT-007, RCPT-009, RCPT-010, RCPT-011, COMM-005, COMM-007, STEW-004, MAJOR-005, REPORT-007, TEAM-001, API-004, DATA-002, DATA-003, DATA-004, DEV-001, DEV-002, DEV-003, DEV-004, DEV-006, DEV-007, DEV-008, DEV-009, DEV-010, DEV-011, DEV-012; the cleanup rewords them as the class the step carries.

### Agent surface

**Specialist: Development officer.** It keeps supporter histories and gift custody accurate, follows fundraising commitments, thanks donors, reconciles receipts and payments, and reports the nonprofit's actual results.

Inherits BASE-AGENT-001 to BASE-AGENT-013. The company's policy decides every call.

Coffer's delta is the fundraising registry below. Native development automation uses these same typed jobs. Class facts come from server arguments and current native records, including actual recipient membership, provider outcomes and protected content; caller assertions and imported prose cannot lower them. Today names an existing native action or route, including incomplete slices, rather than claiming the proposed tool already exists. Ordinary constituent privacy, giving totals, provider estimates and an opaque payment-method reference alone are not regulated personal data.

**How Coffer computes each class.**

- *standard:* internal reads and reversible record, draft, task, merge or compensating-ledger work; facts carry affected item counts. Recording an already received gift, a historic expense or an estimated goal moves no money.
- *external:* a call sends or newly exposes content beyond the nonprofit, including provider synchronization, address/research/model requests, donor messages, postage submissions, public pages and receiver handoffs. Facts carry actual recipient count and counterparty: known for a donor, employer, foundation, vendor or trusted domain on record; new for an unmatched outside destination; public for an open page. A disconnected local change remains internal; enabled provider disclosure adds external even when the eventual write fails.
- *money:* a charge, refund, future collection change, membership or ticket price, or adjustment to what is due changes what the nonprofit pays or charges. Facts carry exact USD cents, currency, payer/payee, original and resulting amount or schedule, and provider attempt. Forecasts, recorded stock values, fee estimates and accounting journals alone are not money.
- *commitment:* issuing an exact receipt, statement, notification or development report, posting a journal relied on by the books, sending binding proposal terms or accepting a binding deadline change. Facts carry content hash, version, value when stated, and counterparty. A draft or a recorded historical response alone does not bind the nonprofit.
- *gated:* the actual Stripe, Intuit, Google, address licensee or other connected provider requires its hosted consent, payment authentication, PAF signing or verification step for a person. Facts name provider and step, from the provider response or declared provider flow; a currently authorized token operation without that step has no gated class.
- *access:* a call changes standing staff roles, record scopes, API/agent grants, report-link recipients, webhook receivers or provider permissions. Facts carry affected people or principals and direction, widens or narrows, computed from the current native target. Manager assignment alone changes work routing, not authority.
- *security:* a call creates, revokes, replaces or handles a credential, changes sign-in protection, or changes fraud protection. Facts name the setting or credential reference without exposing its value.
- *destructive:* personal erasure or permanent snapshot removal has no product Undo. Facts carry affected item counts and retained anonymous financial facts; a guarded merge with Undo is standard.
- *sensitive:* returned, stored, removed or transmitted content actually contains health, ID, bank, card or payroll numbers, including health dietary notes and protected document bytes. Facts carry record count and kind; a masked value or an opaque provider reference does not qualify.
- *live:* a call changes running checkout, published pages, ticket/membership terms, keyword replies, automation stages, schedules, webhook dispatch or protection behavior. Facts name the running service and changed version; saving an inactive draft is standard.

Coffer does not use accounts: these jobs use the nonprofit's existing provider accounts and create no outside identity, account or paid resource. In the table, `a or b` is computed per call, `a · b` always carries both, and `(+ c)` adds c when its factual test holds. Each listed addition is independent.

| Tool | Does | Core clauses | Risk class | Today |
| --- | --- | --- | --- | --- |
| `coffer.donors.list` | Search constituents and households | DONOR-001, DONOR-002, DONOR-007, DONOR-013 | standard | MCP `donors.list`; `GET /api/coffer/donors` |
| `coffer.donors.get` | Read one constituent, giving summary and timeline | DONOR-001, DONOR-002, DONOR-004, DONOR-011 | standard (+ sensitive) | MCP `donors.context`; `GET /api/coffer/donors/{id}` |
| `coffer.donors.create` | Create a person or organization | DONOR-001, DONOR-002, DONOR-014 | standard (+ external, + sensitive) | `donor.create` (enabled Smarty verification can disclose an address) |
| `coffer.donors.update` | Edit names, status and contact facts with history | DONOR-001, DONOR-012, DONOR-014 | standard (+ external, + sensitive) | `donor.update`, `donor.profile` |
| `coffer.contacts.save` | Save a typed contact and primary or seasonal selection | DONOR-013 | standard (+ external) | `contact.save` (address verification when enabled) |
| `coffer.relationships.create` | Record a reciprocal relationship | DONOR-003 | standard | `relationship.create` |
| `coffer.relationships.remove` | Remove a reciprocal relationship with history | DONOR-003 | standard | `relationship.remove` |
| `coffer.households.get` | Read membership, names, hard money and separate recognition | DONOR-003 | standard | `GET /api/coffer/households/{id}` |
| `coffer.households.update` | Change explicit head, membership or independent name overrides | DONOR-003 | standard | `household.update` |
| `coffer.households.configure` | Save computed-name formats after an affected-count preview | DONOR-003 | standard | `household.defaultsPreview`, `household.defaults` |
| `coffer.names.configure` | Save person salutation formats after a count preview | DONOR-014 | standard | `person.defaultsPreview`, `person.defaults` |
| `coffer.interactions.record` | Log a call, meeting, ordinary or confidential note | DONOR-004 | standard (+ sensitive) | `interaction.record` |
| `coffer.questions.resolve` | Resolve or reopen an explicitly recorded meeting question | DEV-006 | standard (+ sensitive) | `meeting.question.set` |
| `coffer.fields.list` | Read typed definitions and choices | DONOR-005 | standard | `GET /api/coffer/custom-fields` |
| `coffer.fields.define` | Define or rename typed fields and choices | DONOR-005 | standard | `custom.define`, `custom.renameChoice` |
| `coffer.fields.set` | Set or clear a typed value on its actual record | DONOR-005 | standard (+ sensitive) | `custom.set`, `custom.clear` |
| `coffer.tags.define` | Define a tag and category | DONOR-005 | standard | `tag.define`, `tag.category` |
| `coffer.lists.save` | Save a live constituent or gift filter | DONOR-007, RCPT-012 | standard | `list.save` |
| `coffer.lists.members` | Read complete live list membership | DONOR-007, RCPT-012 | standard | `GET /api/coffer/lists/{id}/members` |
| `coffer.lists.tag` | Apply an audited bulk tag change | DONOR-005, DONOR-007 | standard | `list.bulk` |
| `coffer.lists.assign` | Assign a list's relationship manager | DONOR-007, MAJOR-002 | standard | `list.bulk` |
| `coffer.lists.profile` | Set typed profile or status values on a list | DONOR-007, DONOR-012 | standard (+ sensitive) | `list.profile` |
| `coffer.lists.restrict` | Set or clear solicitation restrictions on a list | DONOR-007, DONOR-015 | standard | `list.solicitation` |
| `coffer.lists.undo` | Undo a bulk change without reviving completed or cancelled work | DONOR-007 | standard | `list.undo`, `list.profileUndo` |
| `coffer.lists.restore_pending` | Restore eligible pending tasks and unsent steps | DONOR-007 | standard | `list.restorePending` |
| `coffer.lists.enroll` | Enroll current eligible members in an existing journey | DONOR-007, STEW-003 | standard | `list.welcome` |
| `coffer.duplicates.list` | Read likely duplicates and compare field values | DONOR-006 | standard (+ sensitive) | `GET /api/coffer/duplicates`, `GET /api/coffer/duplicates/compare` |
| `coffer.duplicates.merge` | Merge selected identities without changing ledger facts | DONOR-006 | standard (+ sensitive) | `donor.merge` |
| `coffer.duplicates.undo` | Undo a merge while its custody permits | DONOR-006 | standard (+ sensitive) | `donor.unmerge` |
| `coffer.documents.list` | List documents within each parent record's visibility | DONOR-008 | standard | `GET /api/coffer/documents` |
| `coffer.documents.read` | Read original document bytes | DONOR-008 | standard (+ sensitive) | `GET /api/coffer/documents/{id}/download` |
| `coffer.documents.attach` | Attach original bytes to a constituent, gift, pledge or opportunity | DONOR-008 | standard (+ sensitive) | `POST /api/coffer/documents` |
| `coffer.addresses.verify` | Standardize one address against the connected provider | DONOR-009 | external | `address.verify` |
| `coffer.addresses.process` | Run a licensed change-of-address batch | DONOR-009 | external (+ gated) | `address.queueNcoa`; native minute scheduler |
| `coffer.volunteers.list` | Read dated activities and annual hours | DONOR-010 | standard | `GET /api/coffer/volunteering` |
| `coffer.volunteers.record` | Record dated volunteer minutes | DONOR-010 | standard | `volunteer.record` |
| `coffer.consent.get` | Read current channel answers with provenance | CONSENT-001, COMM-001 | standard | `GET /api/coffer/donors/{id}/preferences` |
| `coffer.consent.record` | Append evidence of a channel answer and synchronize connected senders | CONSENT-001, COMM-001 | standard or external | `consent.record` |
| `coffer.preferences.set` | Record sourced topic and frequency choices | COMM-001 | standard | `communication.preferences` |
| `coffer.restrictions.set` | Set or clear a solicitation restriction with a reason | DONOR-015 | standard | `solicitation.set` |
| `coffer.restrictions.include` | Record a reasoned inclusion for one specific ask run | DONOR-015 | standard | Native appeal preparation inclusion fields |
| `coffer.ledger.list` | Read immutable monetary and noncash entries | GIFT-001, GIFT-010 | standard | `GET /api/coffer/donors/{id}` |
| `coffer.gifts.record` | Record a received exact-cent gift with attribution and splits | GIFT-001, GIFT-003, GIFT-004 | standard (+ sensitive) | `gift.record`, `contribution.record` |
| `coffer.gifts.reverse` | Append one compensating reversal | GIFT-001, RCPT-008 | standard | `gift.reverse` |
| `coffer.batches.get` | Read draft rows, check references and deposit totals | GIFT-002 | standard | `GET /api/coffer/gift-batches` |
| `coffer.batches.create` | Create a check or cash batch with shared defaults | GIFT-002 | standard | `giftBatch.create` |
| `coffer.batches.add` | Add a draft gift row | GIFT-002 | standard | `giftBatch.add` |
| `coffer.batches.edit` | Correct a draft row | GIFT-002 | standard | `giftBatch.edit` |
| `coffer.batches.close` | Publish a balanced batch and its deposit | GIFT-002 | standard (+ external) | `giftBatch.close` (enabled receipt and gift-rule effects) |
| `coffer.attribution.define` | Define an appeal code | GIFT-003 | standard | `appealCode.define` |
| `coffer.attribution.get` | Read fund, campaign, appeal and channel totals | GIFT-003 | standard | `GET /api/coffer/reports/attribution` |
| `coffer.pledges.get` | Read commitments, installments, adjustments and balances | GIFT-005 | standard | `GET /api/coffer/donors/{id}` |
| `coffer.pledges.create` | Record an existing donor pledge and dated schedule | GIFT-005 | standard (+ external) | `pledge.create` (native reminder effect) |
| `coffer.pledges.reduce` | Reduce a pledge's unpaid obligation with retained history | GIFT-005 | money | `pledge.reduce`, `pledge.writeOff` |
| `coffer.pledges.allocate` | Match a received gift to an installment | GIFT-005 | standard | `pledge.match` |
| `coffer.pledges.link_plan` | Allocate future successful gifts from an existing plan | GIFT-005 | standard | `pledge.linkPlan` |
| `coffer.credits.record` | Record separate soft recognition | GIFT-006 | standard | `softCredit.record` |
| `coffer.credits.remove` | Remove soft recognition without changing received money | GIFT-006 | standard | `softCredit.remove` |
| `coffer.matches.record` | Record eligibility, deadline and a received employer payment link | GIFT-007 | standard | `match.record`, `match.receive` |
| `coffer.matches.lookup` | Look up an employer's matching program | GIFT-007 | external | none (Double the Donation lookup) |
| `coffer.matches.submit` | Submit a matching request to an employer program | GIFT-007 | external (+ commitment, + gated) | none |
| `coffer.tributes.record` | Record tribute facts and amount-disclosure permission | GIFT-008 | standard | `tribute.record` |
| `coffer.tributes.prepare` | Freeze a family notification without sending | GIFT-008 | standard | `tributeNotification.prepare` |
| `coffer.tributes.issue` | Attest an exact family-notification version | GIFT-008 | commitment | `tributeNotification.approve` |
| `coffer.property.record` | Record or correct noncash property and typed stock facts | GIFT-009, GIFT-010 | standard (+ sensitive) | `inKind.save`, `contribution.record` |
| `coffer.property.dispose` | Record an evidenced disposal and statutory reminders | GIFT-009, GIFT-010 | standard | `inKind.dispose`, `contribution.stockSale` |
| `coffer.property.issue` | Issue the exact value-free acknowledgment | GIFT-009, GIFT-010 | commitment (+ external) | `inKind.acknowledge` |
| `coffer.recognition.update` | Change donor or gift anonymity and permitted recognition text | GIFT-011 | standard or external | `recognition.donor`, `recognition.gift` |
| `coffer.recognition.report` | Read an honor roll distinct from monetary receipts | GIFT-011 | standard | `GET /api/coffer/reports/honor-roll` |
| `coffer.forms.save` | Save a donation form draft and mapped questions | GIVE-001 | standard | Campaign form subset in `src/coffer/giving/`; independent forms none |
| `coffer.forms.publish` | Publish a hosted form or embed configuration | GIVE-001 | live · external | Campaign form subset; independent embeds none |
| `coffer.campaigns.get` | Read nested goals and ledger-derived progress | CAMP-001, GIVE-002 | standard | `GET /api/coffer/giving/campaigns/{id}` |
| `coffer.campaigns.save` | Save a draft campaign with funds, dates and goal | CAMP-001, GIVE-002 | standard | `POST /api/coffer/v1/campaigns` |
| `coffer.campaigns.publish` | Publish the exact campaign and its closing date | GIVE-002 | live · external | `POST /api/coffer/giving/campaigns/{id}/publish` |
| `coffer.media.publish` | Publish a validated campaign image or video | GIVE-002 | live · external (+ sensitive) | `POST /api/coffer/giving/campaigns/{id}/video`; native image upload |
| `coffer.checkout.create` | Create a donor-facing provider payment session | GIVE-004, GIVE-001 | external (+ gated) | Native campaign Stripe-hosted checkout; ACH and PayPal none |
| `coffer.payments.charge` | Charge an authorized saved method and record settlement | GIVE-009 | money · external (+ gated) | Saved-card immediate first installment in `src/coffer/giving/staff-plan-create.ts`; one-time charge none |
| `coffer.plans.list` | Read recurring history, failures and expiry facts | GIVE-003, GIVE-006 | standard | `GET /api/coffer/v1/plans` |
| `coffer.plans.create` | Start an authorized recurring plan on a provider token | GIVE-003, GIVE-009 | money · external (+ gated) | `src/coffer/giving/staff-plan-create.ts` (saved-card subscriptions) |
| `coffer.plans.update` | Change a plan's charged amount or cadence | GIVE-003, GIVE-005 | money · external (+ gated) | Native staff and own-portal plan actions in `src/coffer/giving/staff-plans.ts` |
| `coffer.plans.pause` | Pause future collection | GIVE-003, GIVE-005 | money · external | Native staff/portal plan pause |
| `coffer.plans.resume` | Resume future collection on its recorded schedule | GIVE-003, GIVE-005 | money · external (+ gated) | Native staff/portal plan resume |
| `coffer.plans.cancel` | Cancel future collection and create its follow-up | GIVE-003, GIVE-005 | money · external | Native staff/portal plan cancellation |
| `coffer.recovery.inspect` | Read failures, retry outcomes and notice history | GIVE-006, GIVE-010, DEV-002 | standard | `GET /api/coffer/agent/recovery/notices` |
| `coffer.recovery.prepare` | Prepare evidence-linked notices and missing-receipt work | GIVE-006, GIVE-010, DEV-002, DEV-003 | standard or external | Native integrated recovery run (also dispatches); `/api/coffer/agent/receipts/queue` |
| `coffer.recovery.send` | Submit a permitted recovery notice without making a charge | GIVE-006, GIVE-010, DEV-002 | external (+ sensitive) | `advanceRecoveryNotices` in `src/coffer/agent/recovery-notices.ts` |
| `coffer.recovery.close` | Record an investigated contact closure without changing the plan | GIVE-010, DEV-002 | standard | `advanceRecoveryNotices` in `src/coffer/agent/recovery-notices.ts` |
| `coffer.protection.get` | Read paused forms and protection observations | GIVE-007 | standard | `GET /api/coffer/giving/protection` |
| `coffer.protection.configure` | Change giving-protection settings or resume a form | GIVE-007 | security · live | `giving.protection`, `giving.resume` |
| `coffer.keywords.set` | Configure a keyword on an existing Twilio number | GIVE-008 | live · external | `giving.keyword` |
| `coffer.events.get` | Read fundraising events, packages and private guest lists | CAMP-002 | standard (+ sensitive) | `GET /api/coffer/events` |
| `coffer.events.create` | Create a public event under a published campaign | CAMP-002 | live · external | `event.create` |
| `coffer.tickets.set` | Set published package price, benefit and seat facts | CAMP-002 | money · live | `event.ticket` |
| `coffer.events.match` | Match a guest and accept typed answers into their record | CAMP-002 | standard (+ sensitive) | `event.matchGuest`; native reviewed guest-answer action |
| `coffer.events.checkin` | Record actual guest attendance once | CAMP-002 | standard | `event.checkIn` |
| `coffer.fundraisers.create` | Create a personal or team campaign page draft | CAMP-003 | standard | none |
| `coffer.fundraisers.publish` | Publish a permitted page and recognition leaderboard | CAMP-003 | live · external | none |
| `coffer.memberships.define` | Set membership prices, benefits and terms | CAMP-004 | money · live | none |
| `coffer.memberships.enroll` | Enroll a member on an authorized payment method | CAMP-004 | money · external (+ gated) | none |
| `coffer.memberships.cancel` | End automatic renewal | CAMP-004 | money · external | none |
| `coffer.payouts.list` | Read payouts and exact gift, fee and refund membership | PAY-001, PAY-002, PAY-004 | standard | `GET /api/coffer/payments` |
| `coffer.payouts.sync` | Fetch processor membership and missed settlement facts | PAY-001, PAY-002 | external | `POST /api/coffer/payments/sync` (no scheduled general sweep) |
| `coffer.payouts.match` | Record explicit payout membership with an exact-cent check | PAY-002 | standard | `POST /api/coffer/payments/{id}/match` |
| `coffer.refunds.request` | Request a processor refund with one permanent attempt | PAY-003 | money · external | `POST /api/coffer/payments/refunds` |
| `coffer.disputes.get` | Read evidence deadlines and withdrawal or reinstatement status | PAY-003 | standard | `GET /api/coffer/payments/adjustments` |
| `coffer.fees.get` | Read actual fees and form/fund/campaign reconciliation | PAY-004 | standard | `GET /api/coffer/payments/fees` |
| `coffer.fees.configure` | Set a disclosed optional fee-cover estimate | PAY-004 | live | `POST /api/coffer/giving/campaigns/{id}/fee-cover` |
| `coffer.accounting.map` | Save fund, account, class and fee mappings | FIN-001, FIN-002 | standard | QuickBooks `/mapping`; native Pantry mapping |
| `coffer.accounting.prepare` | Prepare exact payout or closed-batch journal lines | FIN-001, FIN-002 | standard | Native QuickBooks deposit preview; Pantry deposit evidence |
| `coffer.accounting.post` | Submit a deposit or adjustment to the existing ledger connection | FIN-001, FIN-002 | external · commitment | QuickBooks `/{kind}/{id}/post` (kind payout or batch); Pantry native `/post` |
| `coffer.accounting.export` | Download a complete balanced period journal | FIN-004 | standard | `GET /api/coffer/payments/journal` |
| `coffer.funds.define` | Define permanent purpose/time restrictions | FIN-003 | standard | `fund.define` |
| `coffer.funds.spend` | Record dated qualifying expenditure already incurred | FIN-003 | standard | `fund.spend` |
| `coffer.funds.report` | Read given, spent, released and held amounts | FIN-003 | standard | `GET /api/coffer/reports/restrictions` |
| `coffer.reconciliation.get` | Read cent-exact ledger, processor, deposit and posted differences | FIN-005 | standard | `GET /api/coffer/payments/reconciliation` |
| `coffer.receipts.due` | Read due gifts, independent credits and exclusions | ACK-001, RCPT-005, RCPT-011, RCPT-012, DEV-003 | standard | `GET /api/coffer/letters` |
| `coffer.receipts.prepare` | Freeze acknowledgment or missing-receipt letters and merge facts | ACK-001, RCPT-005, RCPT-009, RCPT-010, DEV-003 | standard (+ sensitive) | MCP `ack.prepare`; native missing-receipt queue |
| `coffer.receipts.issue` | Issue the exact receipt batch with actor attribution | ACK-001, RCPT-005, RCPT-008 | commitment (+ external) | `ack.approve` |
| `coffer.receipts.send` | Submit exact issued letters through the mail connection | RCPT-001, RCPT-002, DEV-003 | external (+ sensitive) | MCP `ack.send`; `ack.send` (PDF attachment/domain verification incomplete) |
| `coffer.receipts.print` | Download frozen print formats, labels, envelopes or merge bytes | RCPT-003, RCPT-009 | standard (+ sensitive) | Native PDF/labels/envelope/Word outputs |
| `coffer.receipts.post` | Buy postage and submit a permanent postal piece | RCPT-003, COMM-007 | money · external (+ sensitive) | `ack.sendPostal` |
| `coffer.receipts.record_sent` | Record a completed offline mailing with date and evidence | ACK-001, RCPT-011 | standard | `ack.markSent` |
| `coffer.statements.prepare` | Prepare individual or grouped annual statements from ledger facts | RCPT-004, RCPT-009 | standard | `ack.prepareStatements` |
| `coffer.receipts.correct` | Prepare a linked replacement without rewriting the original | RCPT-008 | standard | `ack.correct` |
| `coffer.copies.prepare` | Prepare a single frozen owned-context letter or requested copy | RCPT-003, RCPT-004 | standard (+ sensitive) | `singleLetter.prepare`; native requested-copy action |
| `coffer.copies.issue` | Attest the exact single-letter version | RCPT-003 | commitment | `singleLetter.approve` |
| `coffer.delivery.get` | Read saved provider-reported outcomes and address tasks | RCPT-006 | standard | Native `deliverySummary`; donor timeline |
| `coffer.delivery.refresh` | Fetch current sender outcomes for exact receipt attempts | RCPT-006 | external | `ack.checkDelivery` |
| `coffer.delivery.complete_task` | Record completed address follow-up without claiming delivery | RCPT-006 | standard | `receiptTask.complete` |
| `coffer.templates.list` | Read template versions, field catalog and required facts | RCPT-007, RCPT-010 | standard | `GET /api/coffer/letter-templates`, `GET /api/coffer/template-fields` |
| `coffer.templates.save` | Save validated receipt, property or reminder wording | RCPT-007, RCPT-010 | standard | `letterTemplate.save`, `pledgeTemplate.save` |
| `coffer.templates.retire` | Retire a template without losing old versions | RCPT-007 | standard | `letterTemplate.retire` |
| `coffer.acknowledgments.set` | Record or reset the evidenced gift or soft-credit thank-you status | RCPT-011, RCPT-012, GIFT-006 | standard | `gift.acknowledge`, `gift.resetAcknowledgment`, `gift.doNotAcknowledge`; matching `softCredit.*` commands |
| `coffer.appeals.get` | Read frozen audiences and separate submission/delivery results | APPEAL-001, COMM-008 | standard (+ sensitive) | `GET /api/coffer/appeals/{id}` |
| `coffer.appeals.prepare` | Prepare consent-, topic- and restriction-checked email or mail work | APPEAL-001, COMM-007, RCPT-009, RCPT-010 | standard (+ sensitive) | MCP `appeal.prepare`; native mail preparation |
| `coffer.appeals.issue` | Sign off exact message and audience facts | APPEAL-001 | commitment | `appeal.approve` |
| `coffer.appeals.send` | Submit the frozen audience and wording or sync its sender list | COMM-002, COMM-003 | external (+ sensitive) | `appeal.send`, `marketing.sync`; Constant Contact campaign sending none |
| `coffer.appeals.export` | Download a frozen mail-house file | COMM-007 | standard (+ sensitive) | `appeal.export` |
| `coffer.appeals.schedule` | Schedule a sender campaign at an explicit instant | COMM-002, COMM-003 | external · live (+ sensitive) | none (scheduled campaign target) |
| `coffer.appeals.results` | Read coded response dollars and honest sender outcomes | COMM-008, DEV-009 | standard | Native appeal results; `/api/coffer/agent/appeals` |
| `coffer.appeals.reconcile` | Reconcile every frozen recipient to bound sender results | DEV-009 | external | `POST /api/coffer/agent/appeals/run`; native journey results |
| `coffer.appeals.resend` | Prepare a separate draft for a confirmed failed recipient | DEV-009 | standard | `POST /api/coffer/agent/appeals/prepare`; journey prepare |
| `coffer.mailboxes.send` | Send a personal donor email from the sponsor's connected mailbox | COMM-004 | external (+ sensitive) | none |
| `coffer.replies.list` | Read known-donor replies and assigned follow-ups | COMM-005 | standard (+ sensitive) | `GET /api/coffer/replies` |
| `coffer.replies.record_stop` | Record an evidenced stop interpretation or reasoned correction | COMM-005, CONSENT-001 | standard or external | `reply.proposeStop`, `reply.confirmStop`, `reply.reverseStop` (connected preference sync) |
| `coffer.replies.complete` | Record a reply task's completion | COMM-005 | standard | `reply.complete` |
| `coffer.texts.prepare` | Prepare a purpose-labelled text and exact recipient snapshot | COMM-006 | standard (+ sensitive) | `sms.prepare` |
| `coffer.texts.issue` | Sign off exact text and current recipient facts | COMM-006 | commitment | `sms.approve` |
| `coffer.texts.send` | Submit a text using current registration and quiet-hour checks | COMM-006 | external (+ sensitive) | `sms.send` |
| `coffer.texts.schedule` | Schedule a text against its frozen facts | COMM-006 | live | `sms.schedule` |
| `coffer.texts.cancel` | Cancel an unsent scheduled text | COMM-006 | live | `sms.cancelSchedule` |
| `coffer.tasks.list` | Read daily tasks, reminders and escalations | STEW-001, STEW-002 | standard | `GET /api/coffer/tasks`, `GET /api/coffer/recurring-tasks` |
| `coffer.tasks.create` | Create a dated task or recurrence | STEW-001, STEW-002 | standard | `task.create`, `task.repeatCreate` |
| `coffer.tasks.assign` | Change a task's owner | STEW-001 | standard | `task.assign` |
| `coffer.tasks.complete` | Record a completed task and its timeline interaction | STEW-001, STEW-002 | standard (+ sensitive) | `task.complete`, `task.repeatComplete` |
| `coffer.reminders.send` | Submit enabled staff reminders and escalation notices | STEW-001 | standard or external | Native task-reminder scheduler |
| `coffer.journeys.get` | Read definitions, enrollments and pending stages | STEW-003 | standard | `GET /api/coffer/journeys` |
| `coffer.journeys.publish` | Publish exact trigger, steps and reply branches | STEW-003 | live | `journey.publish`, `welcome.publish` |
| `coffer.journeys.advance` | Advance due stages with current checks and durable outcomes | STEW-003 | standard or external (+ sensitive) | `journey.run`, `welcome.run` |
| `coffer.journeys.stop` | Stop a series without rewriting completed stages | STEW-003 | live | `journey.stop` |
| `coffer.invoices.get` | Read a live unpaid installment invoice or zero-balance statement | STEW-004 | standard | `GET /app/pledges/{id}/invoice` |
| `coffer.invoices.send` | Send a non-ask reminder or overdue follow-up | STEW-004 | external (+ sensitive) | `pledge.remind`; native follow-up scheduler |
| `coffer.rules.save` | Save a draft gift-triggered rule | STEW-005 | standard | `giftRule.save` |
| `coffer.rules.publish` | Publish exact task, tag or notification behavior | STEW-005 | live | `giftRule.publish` |
| `coffer.rules.pause` | Stop future rule evaluation | STEW-005 | live | `giftRule.pause` |
| `coffer.meetings.schedule` | Record a meeting instant and brief readiness | DEV-006, STEW-006 | standard | `meeting.schedule`, `calendar.log` |
| `coffer.meetings.cancel` | Cancel a recorded meeting | DEV-006 | standard | `meeting.cancel` |
| `coffer.meetings.brief` | Read source-linked giving, interactions and unresolved questions | DEV-006 | standard (+ sensitive) | `GET /api/coffer/meetings/{id}/brief` |
| `coffer.bookings.create` | Create an expiring donor-specific booking link without sending it | STEW-006 | standard | `booking.link` |
| `coffer.bookings.send` | Send a booking link to the intended donor | STEW-006 | external | none (native creation sends nothing) |
| `coffer.opportunities.list` | Read scoped pipeline, stages and weighted forecast | MAJOR-001 | standard | `GET /api/coffer/pipeline` |
| `coffer.opportunities.save` | Save a versioned opportunity draft or stage | MAJOR-001 | standard | `prospect.save`, `prospect.stages` |
| `coffer.opportunities.close` | Record a win or loss and its actual pledge or gift link | MAJOR-001 | standard | `prospect.close` |
| `coffer.portfolios.get` | Read current membership, meaningful moves and raised dollars | MAJOR-002 | standard | `GET /api/coffer/portfolios` |
| `coffer.portfolios.assign` | Assign the relationship manager and portfolio | MAJOR-002 | standard | `portfolio.save`, `portfolio.assign` |
| `coffer.cultivation.apply` | Snapshot dated plan steps as owned tasks | MAJOR-003 | standard | `cultivation.template`, `cultivation.apply` |
| `coffer.proposals.save` | Draft and attach an opportunity proposal | MAJOR-003 | standard (+ sensitive) | `proposal.save`, `proposal.attach` |
| `coffer.proposals.offer` | Send an offer whose terms bind the nonprofit | MAJOR-003 | external · commitment (+ sensitive) | none (native door records sending done elsewhere) |
| `coffer.proposals.record_sent` | Record an actual proposal submission and evidence | MAJOR-003 | standard | `proposal.sent` |
| `coffer.proposals.respond` | Record the received response without inventing assent | MAJOR-003 | standard | `proposal.response` |
| `coffer.scores.get` | Read transparent scores, factors and independent retention risk | MAJOR-004 | standard | `GET /api/coffer/engagement` |
| `coffer.scores.configure` | Save versioned factor weights | MAJOR-004 | standard | `engagement.settings` |
| `coffer.research.get` | Read authorized provider estimates with provenance | MAJOR-005 | standard | `GET /api/coffer/research` |
| `coffer.research.screen` | Disclose selected identifiers to the existing research provider | MAJOR-005 | external | `research.screen` |
| `coffer.grants.save` | Record a grant request, deadlines and documents | MAJOR-006 | standard (+ sensitive) | `grant.save`, `grant.attach` |
| `coffer.grants.submit` | Submit an inquiry or proposal to a foundation | MAJOR-006 | external (+ commitment, + sensitive) | none (native `grant.status` records external acts) |
| `coffer.grants.award` | Record an actual restricted award, installments and report tasks | MAJOR-006 | standard | `grant.award` |
| `coffer.grants.report` | Record a dated reporting-task resolution with evidence | MAJOR-006 | standard | `grant.completeReport` |
| `coffer.planned.record` | Record a planned intention and legacy membership | MAJOR-007 | standard (+ sensitive) | `planned.save`, `legacy.set` |
| `coffer.planned.realize` | Link an actual estate distribution without adding a second gift | MAJOR-007 | standard | `planned.realize`, `planned.unlink` |
| `coffer.reports.retention` | Read fiscal/calendar cohorts and exact donor drilldowns | REPORT-001 | standard | `GET /api/coffer/retention` |
| `coffer.reports.lapsed` | Read LYBUNT and SYBUNT independent of recurring-plan status | REPORT-002 | standard | `GET /api/coffer/reports/annual-lapses` |
| `coffer.reports.dashboard` | Read explicit goals, ledger allocations and source drilldowns | REPORT-003 | standard | `GET /api/coffer/reports/dashboard` |
| `coffer.goals.set` | Record an explicit fiscal dimension goal | REPORT-003 | standard | `dashboard.goal` |
| `coffer.reports.build` | Save and share a typed report definition | REPORT-004 | standard or external | none |
| `coffer.reports.export` | Download report-selected records or definition bytes | REPORT-004, DATA-004 | standard (+ sensitive) | `src/coffer/exports-http.ts` (current report families only; builder none) |
| `coffer.schedules.save` | Save a report schedule and exact recipients | REPORT-005 | live (+ external, + access) | `reportSchedule.save` |
| `coffer.schedules.pause` | Pause future scheduled report submissions | REPORT-005 | live | `reportSchedule.pause` |
| `coffer.schedules.resend` | Submit a separate report attempt preserving the original outcome | REPORT-005 | external (+ sensitive) | `reportSchedule.resend` |
| `coffer.schedules.revoke_recipient` | Remove standing report-link disclosure authority | REPORT-005 | access | `reportSchedule.revokeRecipient` |
| `coffer.reports.recurring` | Read monthly commitment, failure and recovery history | REPORT-006 | standard | `GET /api/coffer/reports/recurring` |
| `coffer.reports.tax` | Read Schedule A/B/M working papers with separate noncash values | REPORT-007 | standard | `GET /api/coffer/reports/tax` |
| `coffer.tax.configure` | Save the period-specific rule and accountant denominator | REPORT-007 | standard | `taxReports.settings` |
| `coffer.reports.states` | Read state-at-gift amounts and foreign/unknown rows | REPORT-008 | standard | `GET /api/coffer/reports/states` |
| `coffer.reports.cleanup` | Remove generated report snapshots while keeping safe run references | REPORT-009 | destructive | Native in-memory `src/coffer/report-delivery.ts` lifecycle; no retained-snapshot cleanup action |
| `coffer.members.list` | Read staff, manager and call-capacity metadata | TEAM-001 | standard | `GET /api/coffer/task-team` |
| `coffer.members.invite` | Invite staff with an explicit role | TEAM-001 | access (+ external) | Native operator-auth invitation door |
| `coffer.members.roles` | Change another staff member's standing role or scope | TEAM-001 | access | Native operator-auth roles; portfolio-limited roles none |
| `coffer.members.configure` | Set manager and weekly call capacity | TEAM-001 | standard | `task.teamSave` |
| `coffer.identity.configure` | Change SSO enforcement or second-factor protection | TEAM-002 | access · security | Base OIDC configuration; Coffer enforcement and second-factor settings none |
| `coffer.audit.list` | Read or download scoped audit history | TEAM-003 | standard (+ sensitive) | `GET /api/coffer/audit`, `GET /api/coffer/audit.csv` |
| `coffer.keys.create` | Create an expiring scoped public API credential | API-001 | access · security | `apiKey.create` |
| `coffer.keys.revoke` | Revoke a public API credential | API-001 | access · security | `apiKey.revoke` |
| `coffer.webhooks.subscribe` | Authorize an existing HTTPS receiver and its event selection | API-002 | access · security · external · live | `webhook.subscribe` |
| `coffer.webhooks.rotate` | Rotate a signing secret with explicit overlap | API-002 | security | `webhook.rotate`, `webhook.retireOverlap` |
| `coffer.webhooks.recover` | Replace unreadable signing custody with a fresh secret | API-002 | security | `webhook.recover` |
| `coffer.webhooks.pause` | Stop future endpoint dispatch | API-002 | live | `webhook.pause` |
| `coffer.webhooks.resume` | Resume future events without requeueing retained history | API-002 | live · external | `webhook.resume` |
| `coffer.webhooks.deliveries` | Read complete delivery, attempt and replay lineage | API-002 | standard | `GET /api/coffer/webhooks` |
| `coffer.webhooks.replay` | Submit a separately identified delivery to an authorized receiver | API-002 | external | `webhook.replay`, `webhook.migrateReplay` |
| `coffer.events.list` | Read access-filtered changes after a cursor | TEAM-003 | standard | Native audit and signed webhook sources; replayable MCP feed none |
| `coffer.exports.list_records` | Download one type for complete live list membership | DATA-002 | standard (+ sensitive) | `src/coffer/exports-http.ts` |
| `coffer.exports.donor` | Produce the subject-only requested donor file with withheld counts | DATA-003 | standard (+ sensitive) | `POST /api/coffer/donors/{id}/data-request` |
| `coffer.erasure.prepare` | Describe one donor's removal and retained anonymous facts | DATA-001 | standard (+ sensitive) | Native erasure screen in `src/coffer/ui/`; separate preview action none |
| `coffer.erasure.execute` | Erase personal records and original bytes with suppression custody | DATA-001 | destructive (+ sensitive) | Native erasure in `src/coffer/imports/erasure.ts` |
| `coffer.reconciliation.scan` | Explain ledger, processor, payout and accounting exceptions | DEV-001 | standard or external | `POST /api/coffer/agent/reconcile/run` |
| `coffer.reconciliation.apply` | Apply a cited correction after provider verification | DEV-001 | external | `POST /api/coffer/agent/reconcile/apply` (broader finance/QBO corrections none) |
| `coffer.reconciliation.undo` | Append the guarded compensating undo | DEV-001 | standard | `POST /api/coffer/agent/reconcile/undo` |
| `coffer.stewardship.draft` | Draft a cited touch from actual authorized donor history | DEV-004 | standard or external (+ sensitive) | `POST /api/coffer/agent/stewardship/draft` (connected model) |
| `coffer.stewardship.save` | Edit a draft while retaining its source links | DEV-004 | standard (+ sensitive) | `POST /api/coffer/agent/stewardship/save` |
| `coffer.stewardship.send` | Submit exact stewardship wording | DEV-004 | external (+ sensitive) | `POST /api/coffer/agent/stewardship/send` |
| `coffer.calls.rank` | Create reasoned weekly calls and disclose overflow | DEV-005 | standard | `calls.rank` |
| `coffer.calls.outcomes` | Read observed call, giving and fiscal retention outcomes | DEV-005 | standard | `GET /api/coffer/agent/calls/outcomes` |
| `coffer.hygiene.propose` | Prepare sourced duplicate, address, status or salutation proposals | DEV-008 | standard (+ sensitive) | `POST /api/coffer/agent/hygiene/run`, native evidence action |
| `coffer.hygiene.apply` | Apply a current evidenced proposal through its typed native command | DEV-008 | standard (+ external, + sensitive) | `POST /api/coffer/agent/hygiene/review` (address verification when enabled) |
| `coffer.followups.prepare` | Prepare overdue pledge, grant and matching-gift follow-up | DEV-010 | standard | `POST /api/coffer/agent/followups/run` |
| `coffer.followups.send` | Submit a current exact-recipient reminder | DEV-010 | external (+ sensitive) | Native `approveDevelopmentReminder` submission |
| `coffer.followups.resolve` | Record paid, revised or reasoned follow-up outcomes | DEV-010 | standard (+ money, + commitment) | `POST /api/coffer/agent/followups/resolve` |
| `coffer.development.draft` | Prepare a source-linked monthly development report | DEV-011 | standard (+ sensitive) | `POST /api/coffer/agent/reports/draft` |
| `coffer.development.save` | Edit narrative while preserving source-derived figures | DEV-011 | standard (+ sensitive) | `POST /api/coffer/agent/reports/save` |
| `coffer.development.issue` | Sign off exact report content and recipients | DEV-011 | commitment | `POST /api/coffer/agent/reports/approve` |
| `coffer.development.send` | Submit that exact report to named recipients | DEV-011 | standard or external (+ sensitive) | `POST /api/coffer/agent/reports/send` |
| `coffer.grants.configure` | Change another agent's record and action authority | DEV-012 | access · security | `agentGrant.save`, `agentGrant.attach`, `agentGrant.disable` |
| `coffer.connections.configure` | Configure an existing provider connection and disclosure fields | PAY-001, FIN-001, FIN-002, COMM-002, COMM-003, COMM-004, STEW-006, MAJOR-005 | access · security (+ external, + gated) | Native Stripe, QuickBooks, marketing, calendar, Twilio and research connection actions; mailbox none |
| `coffer.connections.disconnect` | Narrow an existing provider grant and remove its secret | PAY-001, FIN-001, COMM-002, COMM-003, STEW-006, MAJOR-005 | access · security | Native QuickBooks, marketing, calendar and research disconnect actions |

**Resources.** `coffer://constituent/{id}`, `coffer://household/{id}`, `coffer://contact/{id}`, `coffer://relationship/{id}`, `coffer://interaction/{id}`, `coffer://question/{id}`, `coffer://field/{id}`, `coffer://tag/{id}`, `coffer://list/{id}`, `coffer://merge/{id}`, `coffer://document/{id}`, `coffer://address_check/{id}`, `coffer://volunteer_activity/{id}`, `coffer://consent/{id}`, `coffer://preference/{id}`, `coffer://restriction/{id}`, `coffer://gift/{id}`, `coffer://batch/{id}`, `coffer://deposit/{id}`, `coffer://pledge/{id}`, `coffer://installment/{id}`, `coffer://soft_credit/{id}`, `coffer://match/{id}`, `coffer://tribute/{id}`, `coffer://property/{id}`, `coffer://form/{id}`, `coffer://campaign/{id}`, `coffer://plan/{id}`, `coffer://recovery_notice/{id}`, `coffer://event/{id}`, `coffer://registration/{id}`, `coffer://fundraiser/{id}`, `coffer://membership/{id}`, `coffer://payout/{id}`, `coffer://refund/{id}`, `coffer://dispute/{id}`, `coffer://fund/{id}`, `coffer://receipt/{id}`, `coffer://template/{id}`, `coffer://appeal/{id}`, `coffer://reply/{id}`, `coffer://text_run/{id}`, `coffer://task/{id}`, `coffer://journey/{id}`, `coffer://rule/{id}`, `coffer://meeting/{id}`, `coffer://opportunity/{id}`, `coffer://portfolio/{id}`, `coffer://proposal/{id}`, `coffer://research/{id}`, `coffer://grant/{id}`, `coffer://planned_gift/{id}`, `coffer://report/{id}`, `coffer://schedule/{id}`, `coffer://member/{id}`, `coffer://webhook/{id}`, `coffer://delivery/{id}`, `coffer://agent_grant/{id}`, `coffer://exception/{id}`, `coffer://hygiene_proposal/{id}`, `coffer://development_report/{id}`. Each uses native role and record visibility, including parent-bound document access; external, customer, import, provider, model and log text is untrusted.

**Events.** Native webhook sources are `gift.created`, `gift.reversed`, `donor.created`, `donor.updated`, `plan.failed`, `plan.canceled`, `task.assigned` and `form.submitted`; the surface also exposes `receipt.issued`, `receipt.delivery_changed`, `consent.changed`, `appeal.reconciled`, `journey.advanced`, `recovery.contact_closed`, `meeting.brief_ready`, `grant.report_due`, `reconciliation.exception`, `hygiene.proposed` and `report.submitted`. Occurrence facts retain the native source and provider attempt; a submission is distinct from delivery.

**Prompts.** The development officer's jobs are reconcile a week's gifts (DEV-001, FIN-005, PAY-002); follow failed recurring gifts (DEV-002, GIVE-006, GIVE-010); finish due thank-yous (DEV-003, ACK-001, RCPT-011); plan cited stewardship and next calls (DEV-004, DEV-005, DEV-006); follow pledges, matches and grant reports (DEV-010, GIFT-005, GIFT-007, MAJOR-006); inspect sender outcomes (DEV-009, COMM-008); and prepare the monthly development report (DEV-011, REPORT-001, REPORT-003, REPORT-006).

**Not tools, and why.** Each Core clause omitted from the table has exactly one reason here.

- The import door: IMPORT-001, CAMP-005, MOVE-001, MOVE-002, MOVE-003, MOVE-004, MOVE-005, MOVE-006, MOVE-007, MOVE-008, MOVE-009, MOVE-010, MOVE-011, DEV-007. Reviewed saved pages, auctions, spreadsheets, vault-reference mappings, reconciliation and cutover remain Base import tasks, with their original custody. Archive backup/restore, volunteer CSV uploads and report-definition move-in also use that door; the corresponding native record jobs remain tools above.
- A connector: PAY-005, PAY-006, API-003. Giving-platform, shop, Zapier and Crank packages translate authenticated provider events and typed actions; CSV intake uses the import door, and their received gifts use the native ledger.
- Device-only: MOBILE-001, MOBILE-002, MOBILE-003. Phone layout, offline app storage/sync, push display and Terminal Tap to Pay execute on the person's device; donor reads, logged activity and settled gifts use the tools above.
- An operation or installation fact: OWN-001, OWN-002. License, pricing and local startup are properties of the installed product.
- Served by the surface itself: HTTP-001, AGENT-001, API-004, through SURFACE-001's private native-action parity and registry discovery, rather than a second executor. A person's sign-in, password, 2FA, hosted card entry and provider consent screens are interactive screens, not tools; provider handoff preparation is represented above.

**Limits.** Capacity bounds are disclosed per native action: the existing MCP request body is at most 1 MiB; acknowledgment selection and list bulk operations take at most 500 items; volunteer recording takes 1–200 activities; ordinary record/proposal/grant attachments take at most 256,000 bytes; campaign images take at most 1 MiB and video 100 MiB. Licensed address processing requires a genuine list of at least 100 records and processes at most one 100-record batch per native tick. Oversized exports return their row count without truncation. The registry documents pagination, supported cadence and provider capability limits as the corresponding action grows. Business limits and spend caps are the company's policy.

**Handoffs.** Listen for verified payment, refund, dispute, plan, sender-result, preference, booking and signed-document events through existing Stripe, mail, calendar and document connectors. Resolve each to its native donor, gift, attempt or meeting before work begins. Emit identifier-only gift and task events to Pantry/QuickBooks, Crank and the company's overview; sender handoffs go to Mango, Mailchimp or Constant Contact using frozen audience identities. A sibling's signal is source data, never consent, a signature or policy authority. No sibling endpoint or delivery capability is claimed where its native adapter is absent.

#### SURFACE-001 — The Agent surface is Coffer's fundraising registry

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-013

**Requirement.** Coffer supplies this exact fundraising registry to the Base door. Each tool calls its native typed job with the sponsor's effective role; existing automation and the browser use that same action. The current `/api/coffer/mcp` path remains an alias of `/mcp` during adoption. The Today column supplies implementation pointers, not an alternative registry.

**Acceptance.**
1. Discovery returns exactly this table's tool names, Core mappings, class expressions, resource templates, events, prompts and non-tool reasons.
2. All 139 pinned Core clauses are mapped, with no unknown ID and no clause both a tool and a non-tool reason.
3. Donor editing, household selection, gift recording, batch closing, receipt preparation and posting produce the same native state and event types through browser actions and MCP on identical fixtures.
4. The existing development automation's calls identify the corresponding registry tools rather than a privileged background executor.
5. Both MCP paths expose the same registry under the current and previous Base-supported revisions; native role, host and origin refusals retain their effects.
6. The Base harness passes on Coffer's fixtures under the All-autonomous company policy and the Held company policy defined in SURFACE-013.
7. Each fixed table class is present in discovered action metadata: standard on lists, external on research, money on refunds, commitment on receipt issuance, access on roles, security on key rotation, destructive on erasure and live on publication; gated and sensitive are exposed as conditional classes.

#### SURFACE-002 — Supporter reads preserve native field custody

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-006

**Requirement.** The development officer reads supporter records, documents, report projections and source-backed briefs at native record scope. Household hard-credit money stays separate from soft recognition, and organization-related gifts do not become a contact's own money. Protected content is classified by what the result contains.

**Acceptance.**
1. A portfolio sponsor reads their exact donor fields, interactions and giving totals; a foreign portfolio record is absent from collections and resources alike.
2. On one document fixture, `coffer.documents.read` returns standard for an ordinary pledge letter and adds sensitive, one record, kind ID, for the version containing a government ID number; a masked projection has no sensitive class.
3. The same event registration read adds sensitive for an actual health dietary note and does not add it for an ordinary seating preference.
4. Household money counts distinct current-member hard gifts once, excludes property and soft credits, and reports recognition separately after a merge and its Undo.
5. A meeting brief links each figure and unresolved question to an existing authorized resource, retaining the question's actual state.
6. A donor-request export withholds confidential staff notes with its exact count, redacts counterparts and includes only that subject's own attachments; an ordinary document download creates no donor-request claim.
7. Provider research remains a dated estimate; no role-limited read, document preview or report export discloses a hidden confidential note through another projection.

#### SURFACE-003 — Supporter changes keep provenance and computed exposure

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-012

**Requirement.** Supporter changes use native versioned actions and custody. Household heads are explicit and eligible; headless households remain valid. Solicitation restrictions remain distinct from consent.

**Acceptance.**
1. On the same donor-address fixture, `coffer.donors.update` is standard when saving locally without processing, and also external with one known provider recipient when enabled Smarty verification sends the address; a caller's internal label changes neither result.
2. Updating an internal recognition draft is standard; changing permitted recognition text on its public wall is external, counterparty public. Withdrawing publication invents no new donor permission.
3. Setting an ordinary custom value is standard; setting an actual payroll number on the same authorized fixture adds sensitive, one record, kind payroll. A private ordinary note alone adds no sensitive class.
4. Changing a head or name override changes no gift, pledge, consent, receipt recipient or portfolio, and nonfinancial edits preserve statement snapshots and numbers.
5. Typed choices reject invalid values; bulk Undo retains history and refuses intervening writes.
6. A merge preserves money and independent preferences; Undo restores identity custody, while personal erasure continues to fence older originals.
7. A hygiene proposal records source facts without changing the donor; applying an evidenced address proposal uses the same verification exposure computation as direct entry.
8. An inactive or deceased donor leaves pending asks with counted reasons, while a solicitation restriction alone leaves eligible non-ask receipts and pledge notices intact.

#### SURFACE-004 — Gift custody distinguishes recording from financial changes

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-012

**Requirement.** Gift tools preserve exact-cent native accounting. Recording received money is distinct from charging; corrections append history. Forecasts, recorded values and historical accounting facts are not payments.

**Acceptance.**
1. Recording a $1,000 check split $600/$400 declares standard; the immutable original appears once and a reversal appends one opposite entry with its receipt number retained.
2. A twelve-check batch refuses an imbalance, then closes once with check numbers and one deposit; when its fixture enables outbound receipt effects, closing also declares external before submission; without those effects it remains standard.
3. A pledge reduction declares fixed money with original, reduced and remaining cents and the counterparty, retaining every payment and original commitment.
4. On one follow-up fixture, recording an already paid resolution is standard; applying a native balance reduction adds money, while accepting a binding replacement reporting deadline adds commitment with its value and funder. Merely noting a proposed date adds neither.
5. Stock is zero monetary cents with a separately recorded high/low-mean value; property, DAF sponsor cash, advisor recognition and QCD wording stay distinct in receipts and tax papers.
6. On one scan fixture, cached sources are standard and live Stripe reads external. Corrections cite raw events and use native compensating commands with guarded Undo.
7. A received employer match links to its own gift without another charge; a lookup's quoted potential match amount adds no money class.

#### SURFACE-005 — Provider payments retain financial and gated outcomes

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-012

**Requirement.** Payments use provider references and donor authorization without collecting credentials. Changes retain exact amounts, schedules and attempt identities. Provider-required interactive steps are classified without fabricating payment results.

**Acceptance.**
1. A saved-method $25 charge declares money and external, with payer, amount and attempt; settlement creates one gift and fee record.
2. On the same saved-method fixture, a directly accepted charge has no gated class; a Stripe response requiring hosted authentication adds gated, provider Stripe, step payment authentication, and returns that handoff without claiming payment.
3. Preparing a hosted checkout session declares external and gated when that flow retains card entry for a person; it creates no received gift or completed charge before verified settlement.
4. An address pass with a valid existing PAF is external without gated; the same pass receiving the licensee's signed-PAF requirement adds gated with provider and step without changing addresses.
5. A refund declares fixed money and external with exact remaining cents; replay returns the same saved attempt, and an uncertain attempt never becomes a completed adjustment or a second refund.
6. Plan amount, cadence, pause, resume and cancellation carry money and external with the resulting collection facts; a recurring revenue estimate read remains standard.
7. The recorded fee-cover estimate is live without money; a later charge carries the actual agreed total and actual processor fee, with truthful form provenance.
8. Provider password, CAPTCHA and 2FA acts retain truthful personal attribution.

#### SURFACE-006 — Receipts attest exact facts and separate every send

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-012

**Requirement.** Document tools share native required facts, versioned wording, numbering and grouped addressing. Issuance is a commitment; byte output and sending are separate. Preparation claims no delivery.

**Acceptance.**
1. One letter fixture's issuance is commitment with donor/hash/version/value; exposing it in the donor portal adds external, while private issuance does not.
2. One ordinary issued letter submitted to its donor is external without sensitive; the same authorized fixture containing an actual ID number adds sensitive with kind ID and one record, including on print download.
3. `coffer.receipts.post` always declares money and external, recording actual postage and recipients independently of the piece's estimated cost.
4. Household statements count each hard gift once, retain each legal donor and exclude soft credits; changed household or financial versions refuse obsolete issuance or output.
5. Template selection freezes versions, field defaults and missing-field keys; property acknowledgments state no property dollar value and unknown goods never become invented deductible facts.
6. A financial correction voids affected documents atomically, preserves their numbers and original text, and prepares a linked replacement with a fresh number.
7. Refreshing provider results declares external. Acceptance, delivery, bounce, open and uncertainty remain distinct; replayed events and repeated send calls do not create a second permanent attempt or claim a message was read.
8. Manual acknowledgment records actual actor, date, method and evidence separately for gift and soft credit, without sending or fabricating personal attestation.

#### SURFACE-007 — Outreach preserves each donor's current choices

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-010, BASE-AGENT-012

**Requirement.** Outreach uses native consent, topic, frequency, quiet-hour, status and solicitation checks. Preparation, submission and reconciliation stay separate; profile edits preserve original destinations.

**Acceptance.**
1. One staff-reminder fixture is standard to colleagues, external to an outside board address: one recipient, known when on record and new when unmatched.
2. Appending an internal postal-consent answer is standard; on that fixture appending an email answer with an active sender sync declares external as well and preserves any stronger provider opt-out.
3. A restricted constituent is excluded from an ask with the counted reason and remains eligible for a permitted transactional notice; a one-run inclusion never grants channel consent.
4. A uniquely matched signed STOP appends exactly one withdrawal and later sends honor it; a shared mailbox or phone does not guess a donor.
5. A text's registered sender and local quiet-hour checks remain in force when its company's policy permits the call; scheduling declares fixed live and records an exact future instant.
6. Due journey task/wait stages are standard; on the same enrollment a provider handoff is external with actual recipients, and protected health text additionally carries sensitive.
7. Sharing one report definition internally is standard; exposing it outside is external with known/new counterparty from current records.
8. Reconciliation shows bound sent/delivered/bounced/not-sent/unknown results per frozen recipient; only explicit response-code linkage attributes a gift, and preparing a separate resend changes no original outcome.

#### SURFACE-008 — Development work cites real sources and binding terms

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-006, BASE-AGENT-008

**Requirement.** Development work preserves actual sources and periods. Forecasts, estimates and drafts manufacture no wealth, consent, payment or assent.

**Acceptance.**
1. On one stewardship fixture, internal drafting is standard; transferring history to the connected model is external with provider/recipients. Actual ID content also declares sensitive.
2. Ranking five weekly call slots creates five reasoned tasks and discloses overflow; subsequent giving and called/uncalled retention are labelled observational and match ledger-defined cohorts.
3. A recorded opportunity win links to one real pledge or gift and leaves forecast totals; recording a planned intention alone creates no received money.
4. A nonbinding grant inquiry submission is external without commitment; on the same request fixture submitting terms that bind the nonprofit adds commitment with funder, content hash and stated value. Recording a submission already performed is standard.
5. A matching-program submission similarly adds commitment only when its actual terms bind the nonprofit; a recorded employer estimate alone adds neither commitment nor money.
6. A monthly report's figures link to the actual fiscal, monthly or current source period; editing narrative preserves those figures, and issuance declares fixed commitment.
7. The same issued development report sent only to staff is standard; sent to its outside board recipients it is external with known counterparties. Protected content adds sensitive independently of recipient membership.
8. Screening selected prospects declares external even if the research provider returns no result; returned estimates retain provider/date and remain distinct from verified wealth.

#### SURFACE-009 — Administration follows the sponsor's bounded authority

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-008

**Requirement.** Administrative tools classify the exact authority they change. Each family refuses widening the sponsor's or agent's own authority under every policy. Manager assignment confers no record permissions.

**Acceptance.**
1. A colleague invitation is access, widens; the same invitation outside adds external with known/new counterparty. Staff-role self-escalation is refused under every policy.
2. Agent-grant changes declare access and security with target/direction; widening caller or sponsor scope is refused under every policy.
3. API-key creation/revocation declare access and security; keys beyond sponsor authority or widening the agent's own authority are refused under every policy.
4. SSO/second-factor changes declare access and security; widening sponsor or agent authority is refused under every policy.
5. On one provider-connection fixture, local sealed-custody changes are access/security only; Google authorization adds external and required hosted consent adds gated, provider Google, step consent. Configuration and disconnection cannot widen sponsor or agent authority under any policy.
6. Webhook subscription is access/security/external/live; rotation/recovery are security. Each refuses sponsor or agent self-escalation under every policy; delivery history exposes no secret.
7. On one schedule fixture, cadence alone is live; adding an outside recipient adds external and report-link access, widens. Revocation is access, narrows. Schedule/recipient self-escalation is refused under every policy.
8. Manager and call-capacity changes remain standard without expanding staff record permissions or the acting grant.

#### SURFACE-010 — Publication and schedules identify the running service

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-012

**Requirement.** Published fundraising pages, rules, keyword replies and automatic schedules identify the exact running behavior they change. Internal drafts remain separate from published facts. Registry capacity describes the native action's technical envelope; commercial limits are left to the company's policy.

**Acceptance.**
1. Publishing a campaign or form declares fixed live and external, counterparty public, service checkout and exact version; editing its inactive draft is standard.
2. On one media fixture, an ordinary campaign image publication declares live and external; a publishable image containing a protected ID additionally declares sensitive with its kind and record count. Metadata stripping alone does not erase a number visible in pixels.
3. Published ticket and membership price changes declare fixed money and live with original/resulting cents, distinct from their recorded goal or forecast.
4. Publishing, pausing or advancing native gift rules never fires them for historical imports, and a replay of one gift creates only its once-only task, tag or notification effects.
5. Rule, journey, schedule, keyword and webhook behavior changes declare live with the relevant service/version; fraud-protection changes also declare security and refuse widening the sponsor's or agent's own authority under every policy.
6. An over-capacity 501-item acknowledgment request returns the named technical bound without partial preparation, and a too-large export reports its row count without a truncated file.

#### SURFACE-011 — Erasure preserves anonymous money and suppression

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-006, BASE-AGENT-012

**Requirement.** Personal erasure uses Coffer's native ledger-preserving removal and old-archive fences. Snapshot cleanup removes generated report content rather than its safe delivery lineage. Restore and move-in remain import-door work and cannot revive erased identities or turn provider custody into new authority.

**Acceptance.**
1. Preparing an erasure changes no donor data; executing it declares fixed destructive with the actual removed-item count and keeps anonymous contribution cents and dates.
2. On the same erasure fixture, removing ordinary donor facts has no sensitive class; adding and then erasing an actual health note adds sensitive with one record and kind health.
3. Erasure removes original document bytes and personal snapshots, leaves another donor's bytes intact, and fences an older import or archive from reviving the subject.
4. A guarded merge and its Undo remain standard and restore ownership without changing amounts, receipt IDs or original dates.
5. Permanent report-snapshot cleanup declares fixed destructive with its item count, preserves schedule/run references and claims no deletion from a recipient's mailbox.
6. A fresh report read recomputes current ledger numbers without restoring a removed earlier envelope; personal erasure keeps the applicable anonymous financial reconciliation.

#### SURFACE-012 — Fundraising handoffs retain native identities and outcomes

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-010, BASE-AGENT-012

**Requirement.** The development officer follows source-bound events and resources across gift, payment, communication and accounting jobs. Existing connector and import ownership remains intact; Coffer exposes native fundraising actions and identifier-only handoffs rather than rebuilding its neighboring products.

**Acceptance.**
1. `coffer.events.list` declares standard and returns native event IDs, occurrence times and resource links with an exhausted cursor after the last authorized event.
2. A replayed verified gift or refund produces one native ledger effect and matching signed event identity, not a second contribution or refund.
3. `coffer.accounting.post` declares fixed external and commitment with exact deposit lines, counterpart ledger and source identity; it moves no money and has no money class merely because its journal has amounts.
4. A confirmed remote posting reconciles as posted; a prepared proposal, downloaded IIF or uncertain provider response does not.
5. A sender handoff retains frozen donor/contact/attempt identity, while no bound result remains unknown instead of delivered.
6. A signed booking maps to its donor-specific link and actual guest, creating one meeting and preparation task; another person's calendar content remains absent.
7. Each prompt names its listed Core jobs, and following a resource link or event never substitutes external prose for native consent, provider outcome or policy authority.

#### SURFACE-013 — The development officer completes a seeded week under two company policies

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-007, BASE-AGENT-009, BASE-AGENT-013

**Requirement.** A stranger agent discovers Coffer from its URL and development-lead sponsor, then runs a seeded week through MCP under two company policies. All-autonomous makes every fleet class autonomous; Held makes standard review and every other class approval. Existing connections and donor-authorized tokens remove hosted interactive steps from the week.

**Acceptance.**
1. Discovery supplies prompts, resources, typed jobs, capacities and non-tool reasons without installation-specific instructions.
2. Under All-autonomous the agent reconciles a payout/check batch, records a split gift, updates a household, finishes receipts, follows failed gifts, sends/reconciles an appeal, ranks calls, resolves a grant task and issues the monthly report; the week completes with no person.
3. That run also refunds a duplicate charge, posts a journal, publishes a campaign, rotates a separate webhook key, narrows another grant and erases an expendable donor, matching native class facts.
4. Under Held, standard work runs into review; every other class creates an exact-facts approval item without its effect until the named fixture person approves it.
5. Approved Held calls resume once; changed content or authority invalidates obsolete items.
6. Under both policies false internal flags and instruction-like imported notes change no classes, recipients or decisions.
7. Final ledger, receipt, sender, task and report outcomes agree across completed runs; differing review/approval histories match each policy revision.
8. The conformance result and `/docs/agents` enumerate computed-class cases with tool, arguments and native facts, including gated provider handoffs outside the connected week.

## Status rows

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `SURFACE-001` | The Agent surface is Coffer's fundraising registry | target | missing | | The fundraising registry and inherited harness have not been adopted. |
| `SURFACE-002` | Supporter reads preserve native field custody | target | missing | | Native field custody and protected-content classification are not exposed through the proposed surface. |
| `SURFACE-003` | Supporter changes keep provenance and computed exposure | target | missing | | Typed supporter mutations and their computed exposure cases are not exposed through the proposed surface. |
| `SURFACE-004` | Gift custody distinguishes recording from financial changes | target | missing | | Ledger and financial-change classifications are not implemented in the proposed registry. |
| `SURFACE-005` | Provider payments retain financial and gated outcomes | target | missing | | Provider payment and gated-step facts are not classified through the proposed surface. |
| `SURFACE-006` | Receipts attest exact facts and separate every send | target | missing | | Receipt attestation and separate send/output classifications are not exposed through the proposed surface. |
| `SURFACE-007` | Outreach preserves each donor's current choices | target | missing | | Outreach tools and their computed recipient classes are not implemented in the proposed registry. |
| `SURFACE-008` | Development work cites real sources and binding terms | target | missing | | Source-backed development jobs and binding-term computations are not exposed through the proposed surface. |
| `SURFACE-009` | Administration follows the sponsor's bounded authority | target | missing | | Administrative families lack the proposed classification and self-escalation conformance cases. |
| `SURFACE-010` | Publication and schedules identify the running service | target | missing | | Running-service publication and capacity metadata are not implemented in the proposed registry. |
| `SURFACE-011` | Erasure preserves anonymous money and suppression | target | missing | | Erasure and snapshot cleanup lack the proposed classified surface and fixtures. |
| `SURFACE-012` | Fundraising handoffs retain native identities and outcomes | target | missing | | Source-bound fundraising handoffs and the replayable MCP feed are not adopted. |
| `SURFACE-013` | The development officer completes a seeded week under two company policies | target | missing | | The stranger development-officer week has not passed through MCP under both named company policies. |

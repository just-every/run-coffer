# Development agent

Open **Agent** after signing in as an owner or admin. The agent uses this installation’s records and provider connections. Daily reconciliation, monthly recovery and missing-receipt preparation do not need an AI key. The daily job runs at 13:00 UTC.

## Reconcile

**Check giving now** reads every page of Stripe charges and payouts and compares contribution amounts, refunds, dispute adjustments and fund allocations with Coffer. Cached payout checks compare exact transaction membership, fees and net amounts. Pantry checks compare the saved proposal payload hash, approval and journal ID; a pending proposal is never called a posted deposit.

Each discrepancy shows its source IDs, explanation and proposed fix. An owner or admin can apply contribution corrections or sync a missing, unrefunded charge. Corrections append immutable contribution entries. **Undo** appends the opposite entries; undo of a newly recorded gift uses an ordinary reversal. Source changes stop a stale approval. A gift subsequently placed in a receipt batch must leave that batch before undo.

Payout membership, account mappings, unsupported currencies and missing refunded charges need the explicit Payments/Pantry review named in the proposal. Coffer never invents a deposit or changes provider money to balance a difference. A Stripe outage is shown as an incomplete check, never a clean reconciliation.

## Monthly recovery

Signed invoice events and daily checks read current Stripe invoice and subscription state. Stripe owns payment retries; Coffer never creates an extra charge. Before a recovery notice policy is configured, existing transactional single-notice behavior remains. Any explicit policy configuration, including off, takes over that sending boundary.

Under **Recovery notice approval**, an owner/admin explicitly designates themselves as the development lead and approves the standing policy. Each donor also needs recorded recovery-contact permission, a permitted email/mail/phone channel, a minimum interval and a maximum notices per failure. Standard email notices send under that approval; major donors and changed plan amounts require the named lead’s approval of the exact prepared version. Mail and phone produce a script for a person to complete with evidence. Source links cite actual plan, giving, consent and interaction facts. Frequency counts contacts across the donor’s plans, including moved plans and uncertain attempts.

Follow-ups stop after a provider-confirmed payment-method update, recovery, lapse or explicit closure. Merely opening Stripe does not count as replacing a card. Current default-card expiry uses the same policy and review rules. Outcomes identify the last actual contact before recovery without claiming it caused the payment. Every mail claim rechecks current grant, policy, donor permission, consent, plan amount, named-lead approval and stop state immediately before sending. Uncertain submissions hold further recovery contact across the donor’s plans, including moved plans. A current owner or admin opens the blocking submission, records an investigation finding (still unknown is valid) and a reason, then chooses **Close recovery contact**. This permanently stops contact for that affected plan and records the plan, finding, reason, actor and time. The original uncertain outcome and claim stay unchanged; closure sends nothing and changes no Stripe plan. Each uncertain submission needs its own investigation: another unresolved submission keeps the donor held. Once all blocking submissions are investigated, other independently eligible plans may resume only after the current permission, channel consent, approval, lead authority, interval, limit and stop checks. New invoices, merges and policy changes never reopen closed contact. Restart and archive recovery preserve investigations and uncertainty; a restored installation must explicitly approve a fresh standing policy before outbound sequences can resume. Submitted email cannot be recalled; pausing Coffer does not pause Stripe charges.

Ct approved the current owner and admin development-lead designation and merge custody on 23 October, and investigated closure with donor-wide uncertainty holds on 27 October. Moving a plan never silently transfers its source donor’s contact authority.

## Missing receipts

The agent finds not-acknowledged gifts past target, corrected bounced receipts and undelivered year-end statements. The installation’s acknowledge-from date excludes older gifts without inventing an acknowledgment. Gifts already acknowledged in Coffer or before move-in, or marked do not acknowledge, never enter its proposals.

Without a selected standing-approved key, preparation waits for human approval in **Letters**. An owner/admin may explicitly select a named key whose grant approves the current receipt template. Standard receipts then use the real native sender under both the background grant and key’s current donor scope, template version, daily limits and global stop. Large gifts, unknown goods values, missing addresses, complex recipients and uncertain deliveries remain visible human holds. The largest-standard-gift amount is reviewed by the admin.

Year-end recovery requires an explicit owner/admin action on an already human-approved, never-submitted statement. Accepted or uncertain submissions are investigated rather than submitted again. Failed addresses need correction or mailing. A prepared batch can be undone before dispatch; a submitted email cannot be recalled.

## Stewardship and AI setup

**Agent → AI setup** works without terminal commands. It explains Anthropic’s API account, billing, privacy and key creation. Paste this installation’s dedicated key, save it and test the connection. The key is encrypted with the installation session secret, is never displayed again and is excluded from donor backups. Removing it stops later drafting calls. Deterministic jobs continue without it.

Draft a thank-you or impact note from the donor’s recorded gifts, signed contribution adjustments, funds, conversations, checked-in event attendance, received replies and tributes. Only paid, donor-linked registrations with an actual check-in count as attendance. Up to 10 recent event records and 10 uniquely matched, non-automatic replies are included. Each reply contributes its subject, received time and at most 1,000 characters of private plain text; attachments, forwarding details and contact address fields are excluded. The corresponding timeline copy is excluded so it cannot disclose a longer reply. The AI setup and drafting form disclose these categories before a request. Current owners and admins alone can read or draft from these sources; broader staff authority is not granted here.

Sources and exact citations accompany the draft, with readable event and reply facts in the native review. Current fund totals include refunds and reconciliation corrections. Drafting makes a writing request and a factual-check request. Saving a person’s edited review makes a further factual check. Unsupported facts, cross-donor citations and asks are refused; restricted donors may receive only non-ask stewardship. A person must still review and save the exact version, then explicitly confirm sending. Changed donor identity, source facts or draft version block stale review, restoration and sending. Previous text versions remain visible, and discarded drafts can be restored before submission. Archives retain private source snapshots and versions but exclude model credentials; restoration requires a fresh connection. Merge invalidates review, and erasure removes associated drafts and their saved versions. Opaque replay receipts survive erasure without retaining the donor link or message text. Intake also checks the existing erased-identity hashes, including for previously unseen legacy captures, so erased content cannot be attached to another donor through a reused address. Model and mail network fixtures establish no live-provider qualification. Relationship-manager scheduling, call-note and handwritten-card variants, and wider confidential role and portfolio scoping remain unfinished.

On RER Managed, provider calls say **not available yet**. Self-hosted installs use their own Stripe, Pantry, SendGrid and AI credentials. Setup does not require an AI key for the other jobs.

## Validation

`tests/agent-recovery.test.mjs` exercises failed monthly giving, one email across duplicate events, the card-update portal, scheduled reconciliation, recovery, lapse and reversible scheduling through HTTP. `tests/agent-reconciliation.test.mjs` exercises refund/fund correction and undo, missing-charge sync and undo, and exact Pantry posting verification. `tests/agent-receipts.test.mjs` queues small and signed-provider-bounced receipts for approval and undoes a batch. `tests/stewardship.test.mjs` covers setup, grounded sources, reviewed sending, consent, stale sources, discard/restore, refunds, corrections, undo and erasure. Only provider network edges are faked.

## Appeal delivery review (DEV-009, partial)

Open Development agent → Appeal delivery, select an approved appeal and check sender results. Each request checks up to eight Mailchimp messages, oldest check first; repeat for a larger audience. The page compares frozen recipients against saved outcomes and the existing response-code report, including signed reversals. The submitted email is retained when a donor changes their contact email. A provider handoff is not proof of delivery.

Prepare resend creates a separate audience containing only confirmed not-sent recipients, rejected submissions and bounces, with current consent checked again. It retains the original message template; current giving figures are frozen in the new proposal. A person reviews and approves before sending. Repeated preparation opens the existing proposal; discard that proposal to prepare again. The new run has its own response code and report. Original messages and results stay in history. Suppressed and uncertain submissions are held, never automatically resent. Recipients with no submission yet continue through the original approved send, preventing a parallel resend.

Mango list membership does not establish sending. Mango sender-result ingestion, journey gift-response binding and journey resend proposals remain unbuilt; journey results are displayed with those limits.

## Meeting-brief API (DEV-006, partial)

Signed-in staff use `POST /api/coffer/commands` with `meeting.schedule` and input `{donorId, startsAt}`. `startsAt` is a future canonical UTC timestamp, for example `2030-02-02T12:00:00.000Z`. `meeting.cancel` takes the returned `id` and current `version`; stale cancellation is refused.

`GET /api/coffer/meetings` lists metadata. The minute scheduler makes `GET /api/coffer/meetings/{id}/brief` available starting 24 elapsed hours before the meeting. It returns exact live giving summary, ten recent interactions, relationships, open pledges and open opportunities, with a source HTTP URL, JSON pointer and collection record ID per line. It includes existing stored research only for owner/admin readers, under the existing research permission. No model is called, capacity is never inferred, and no email is sent. Cancelled meetings have no readable brief.

This is an API slice: printable one-page delivery and tracking unresolved questions from the previous meeting remain unbuilt, so DEV-006 stays partial. `tests/meeting-briefs-journey.mjs`, invoked by the clause-named test in `tests/stewardship.test.mjs`, asserts the shipped slice and its custody.

## Named grants and standing receipts (DEV-012 foundation)

Agent keys can be attached to a named, versioned grant through owner/admin commands. Grants specify explicit donor identifiers, allowed read/preparation commands, a daily receipt limit and optional explicit standing approval of the current settings and thank-you template revision. An attached grant replaces the key's legacy permissions. Disable a grant or use the global agent-key kill switch to stop later work immediately. Unbound AGENT-001 keys retain their current read/prepare permissions under stored, metered preparation grants; they also honor the global kill switch and audit their grant ID/version. Existing installation jobs use the background grants described below.

`src/coffer/ui/agent-grants.ts` exports `agentGrantsPanel(c)` for the owner/admin Data & access page. The Data & access panel uses the real public commands. See `docs/MCP.md` for command shapes, conservative scope restrictions and shared HTTP/MCP limits. Named grants currently permit standard receipt dispatch and a deliberately limited direct-record context. Named appeals, linked household/organization preparation and richer scoped histories remain refused; preparation grants preserve their earlier human-approved doors.

`tests/agent-grants-journey.mjs` exports `agentGrantsJourney()` for the test suite's registration. It proves named authority, scoped records, standing template approval, shared daily limits, narrowing and both kill switches through real HTTP and MCP, with only the paid mail submission edge replaced. It does not establish live SendGrid delivery or browser layout.

Existing scheduled reconciliation, recurring-payment notices, missing-receipt preparation, January statement preparation and meeting readiness use named background grants. Owners and admins can stop them, narrow donor scope where meaningful, or reduce daily action limits under Agent → Background grants. The global switch also stops those jobs. These grants preserve existing transactional notice capabilities; they enable no new receipt sending. Quota reservations and each agent event retain grant identity and revision. Installation authority and usage are excluded from donor archives.

## Weekly call priorities

Owners and admins open Agent → Call priorities, select a relationship manager and rank the current week. The saved list explains recorded lapse risk, giving increases, anniversaries, unanswered replies, overdue pledge installments and contact silence. It creates calls within the manager’s capacity and keeps the remaining constituents visible as overflow. Restricted constituents receive thank-you or stewardship calls marked not an ask. Inactive and deceased constituents and withdrawn phone permission stay off the list.

Settings holds each person’s weekly capacity and the giving observation window. The background Weekly call priorities grant starts stopped. Explicitly enabling it permits weekly internal task preparation within its current donor scope, daily action limit and shared kill switch. It grants no message sending. Repeated runs open the same saved weekly list.

The outcomes table follows the saved list, including overflow. A completed call task with a matching logged call counts as called. Positive net monetary gifts within the saved observation window count as subsequent giving; a window without a gift stays pending until it closes. Fiscal retention uses REPORT-001, with called and uncalled rates pending until the run’s fiscal year closes. Each denominator contains prior-year donors still available in the saved list. This comparison describes observed records and makes no causal claim about calls.

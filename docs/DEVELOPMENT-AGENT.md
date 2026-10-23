# Development agent

Open **Agent** after signing in as an owner or admin. The agent uses this installation’s records and provider connections. Daily reconciliation, monthly recovery and missing-receipt preparation do not need an AI key. The daily job runs at 13:00 UTC.

## Reconcile

**Check giving now** reads every page of Stripe charges and payouts and compares contribution amounts, refunds, dispute adjustments and fund allocations with Coffer. Cached payout checks compare exact transaction membership, fees and net amounts. Pantry checks compare the saved proposal payload hash, approval and journal ID; a pending proposal is never called a posted deposit.

Each discrepancy shows its source IDs, explanation and proposed fix. An owner or admin can apply contribution corrections or sync a missing, unrefunded charge. Corrections append immutable contribution entries. **Undo** appends the opposite entries; undo of a newly recorded gift uses an ordinary reversal. Source changes stop a stale approval. A gift subsequently placed in a receipt batch must leave that batch before undo.

Payout membership, account mappings, unsupported currencies and missing refunded charges need the explicit Payments/Pantry review named in the proposal. Coffer never invents a deposit or changes provider money to balance a difference. A Stripe outage is shown as an incomplete check, never a clean reconciliation.

## Monthly recovery

Signed invoice events read current Stripe invoice and subscription state, track the failure and request one private card-update email per invoice. The existing donor portal lets the donor update their payment method in Stripe Billing Portal. Stripe owns scheduled payment retries; Coffer never creates an extra charge. Daily checks also discover missed webhook failures and record **waiting**, **recovered** or **lapsed** outcomes.

The activity page records who, what and why. Pausing/resuming Coffer’s checks is reversible; it does not pause Stripe’s charges. A durable mail claim prevents duplicate automatic invitations. An interrupted or failed submission is visible for human investigation. Submitted email cannot be unsent, and settled charges cannot be undone from Coffer.

## Missing receipts

The agent finds unreceipted gifts of every amount and bounced/rejected receipts. Unknown goods/services answers remain held. It freezes a prepared batch in **Letters**; a person reviews and approves the exact wording before sending or printing. Consent and address are rechecked at dispatch. Bounced addresses route to print. It never automatically resends an uncertain submission. Preparing a batch can be undone before any letters are routed.

## Stewardship and AI setup

**Agent → AI setup** works without terminal commands. It explains Anthropic’s API account, billing, privacy and key creation. Paste this installation’s dedicated key, save it and test the connection. The key is encrypted with the installation session secret, is never displayed again and is excluded from donor backups. Removing it stops later drafting calls. Deterministic jobs continue without it.

Draft a thank-you or impact note from the donor’s recorded gifts, signed contribution adjustments, funds, conversations and tributes. Sources and exact citations accompany the draft. Current fund totals include refunds and reconciliation corrections. A separate AI factual check rejects unsupported text; a person must still review and save the exact version before explicitly sending it. Source or version changes block stale sends. Previous text versions remain visible, and discarded drafts can be restored before submission. Erasing a donor removes associated drafts and their saved versions.

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

Agent keys can be attached to a named, versioned grant through owner/admin commands. Grants specify explicit donor identifiers, allowed read/preparation commands, a daily receipt limit and optional explicit standing approval of the current settings and thank-you template revision. An attached grant replaces the key's legacy permissions. Disable a grant or use the global named-agent kill switch to stop later work immediately. Existing installation jobs are not yet attached to these grants; their conversion belongs to DEV-002/DEV-003 work.

`src/coffer/ui/agent-grants.ts` exports `agentGrantsPanel(c)` for the owner/admin Data & access page. The panel uses the real public commands; its integration is separate from this foundation. See `docs/MCP.md` for command shapes, conservative scope restrictions and shared HTTP/MCP limits. This is a foundation for standard receipt dispatch, not wider autonomy: named appeals, linked household/organization preparation, richer scoped histories and scheduled grant actors remain unavailable.

`tests/agent-grants-journey.mjs` exports `agentGrantsJourney()` for the test suite's registration. It proves named authority, scoped records, standing template approval, shared daily limits, narrowing and both kill switches through real HTTP and MCP, with only the paid mail submission edge replaced. It does not establish live SendGrid delivery or browser layout.

# sx-coffer-c-f173 — reviewed Benevity disbursements

Repository: just-every/run-coffer
Branch: cloud/sx-coffer-c-f173
Candidate: 73ba072819742dc675195fa3f9c5f772d49fecf0
Base main: 8a6fd3d093f2c9c1b44ecb74be12f72db09b4cc0
PR: none; the existing push workflow supplies the branch entry point.

PAY-005 is claimed PARTIAL. The complete assigned Benevity uploaded-file slice is implemented. Givebutter ingestion and changed transactions, Donorbox, PayPal Giving Fund, other workplace formats, automatic ingestion, changed or refunded disbursements and full provider qualification remain unclaimed. No additional clause or plan row was taken. The product has no known blocker in the supported slice; completion of the complete clause remains outside this narrow assignment.

Contract counts remain 96 DONE, 37 PARTIAL and 20 MISSING, 153 total. PAY-005's main Status row remains MISSING and unchanged; the builder reports PARTIAL progress for the lander. CONTRACT.md and both generated view files have no candidate diff. The seed has 162 direct registrations in 26 test modules by a source count, compared with 161 before this round. Payments registrations increased from five to six. No assertion was removed, narrowed, skipped or placed behind a viewport condition.

## Plan and implemented result

1. Read the full PAY-005 target and acceptance, existing PAY-001 queue, supplied plan extract, ct rulings and DONE riders. Map Stripe's existing public-door proof and identify the absent uploaded disbursement door. Preserve all Status, Gap and Evidence cells.
2. Reuse the existing CSV parser with an explicit mapping of actual uploaded columns. Validate source organization, disbursement, transaction and donor identities, name and email evidence, date, explicit USD, gross contribution, actual fees and net. Compare independent source controls with every row and the complete batch. Missing, duplicated, inconsistent or unsupported facts hold before money.
3. Map source fund and campaign labels explicitly to existing destinations while preserving original labels. A translation cannot invent a missing source fund or discard a source campaign. No giving form is inferred. Preserve source acknowledgment status, supplied date and method; absent status remains unknown.
4. Extend the same private donor-review lifecycle with provider-qualified source identities. Current owner or admin selects an exact donor version from current email candidates. Shared email never chooses the first person. Donor selection writes no money and increments the batch version. Exact batch approval rechecks selectors, current authority, canonical donor identities, source facts and control totals.
5. Publish gifts, actual-fee entries and exact payout membership atomically and once. Use native reviewed gift entry plus explicit Benevity source metadata; create no synthetic Stripe objects. Gross contribution is preserved independently of fees. Goods or services remain unknown until human classification; ordinary receipt preparation and approval are required, with no automatic receipt or inferred consent.
6. Keep complete source files, evidence and other candidates out of donor data files. Archive source evidence privately; restored pending approvals cannot reuse old installation authority. Preserve gift custody through native merge. Erasure redacts files, mappings, row evidence and review facts, retaining anonymous money and opaque source and donor tombstones; suppress a changed-email replay and refuse an older archive with the current erasure journal.
7. Register one large public HTTP, Worker and D1 journey through the existing payment test command, retain Stripe's journey, and run native file upload, column and provenance mapping, donor selection, preview, recorded gifts and payout screens. Browser assertions run at 1440; the candidate captures each changed state at 1440 and 390. Run touched checks, typecheck, build, contract generation and source lock checks; publish product and evidence separately.

## Acceptance and inherited duty coverage

All line references below refer to the candidate's `./tests/platform-disbursement-journey.mjs` and its `platformDisbursementJourney` unless another path is named. Exact final line ranges are recorded in RECEIPT.json. The workflow event and conclusion are recorded in CI-RECEIPT.json.

| Item | Result | Public-door proof and limits |
| --- | --- | --- |
| Acceptance sentence 1: Givebutter ingestion and changed transaction plus Benevity import, gifts, source, fees, payout and reviewed donors | PARTIAL | The Benevity portion goes through native preview, the existing donor-match route and exact batch approval, then donor, payout and fee-report reads. Givebutter and changed-transaction acceptance are not implemented or claimed. |
| Acceptance sentence 2: PAY-004 fees, full charged receipt amounts and report provenance | PASS for the uploaded slice | Independent $150.00 gross, $4.45 actual fees and $145.55 net; $100.00 and $50.00 contributions; Reading and Meals fund totals; explicit campaign mapping; no inferred giving form; a $100.00 human-approved receipt rather than $96.80 deposit net. |
| PAY-004 actual-fee recording | PASS | Read native payment entries, both fund splits and the fee report; compare independent integer-cent expectations and zero payout difference. |
| PAY-004 full paid receipt | PASS | Refuse receipt preparation while goods are unknown, classify through the existing command, prepare one receipt, read its exact 10000 cents and full body, then approve and send through the ordinary human path. |
| PAY-004 optional fee-cover agreement | PASS boundary | Uploaded source gross is preserved; there is no new checkout, charge or inferred donor fee-cover agreement. No fee-cover or consent fact is manufactured. |
| PAY-004 honest fund, form and campaign provenance | PASS | Map a source fund label and source campaign label to explicit native destinations; keep absent form and absent campaign explicit, retain original labels, and reconcile grouped totals. Refuse mappings that invent or discard source facts. |
| GIVE-006 inheritance for new schedules and staff plans | NOT APPLICABLE | This slice creates no plan or schedule. Its acceptance and every existing hold remain owed before such a door ships. |
| Same PAY-001 review lifecycle and Stripe-specific verification | PASS | Existing queue and versioned selection route serve both qualified providers. `./tests/payment-donor-match-journey.mjs#paymentDonorMatchJourney` remains registered and exercises Stripe account, charge, refunds and actual fees without weakening its assertions. |
| Private source evidence and no inferred consent | PASS | Anonymous, member and agent denials; zero donor consents; no automatic receipt; source originals and matching candidates absent from the donor file; private evidence preserved through archive and purged on erasure. |
| Replay, concurrency and current authority | PASS | Identical file returns the same batch; concurrent approval produces one gift per source and one exact payout; changed facts and cross-disbursement transaction reuse refuse; stale donor and batch versions and revoked selector authority refuse without money. |
| Restore, merge and erasure | PASS | Read recorded money after restore, refuse old pending authority, invalidate merged pending selection, erase sources without changing anonymous totals, suppress changed-email source replay and refuse an old archive with the current erasure journal. |

## Frozen rider assessment

| DONE-RIDERS row | Result | Evidence or remaining limit |
| --- | --- | --- |
| 1 | PARTIAL | Assigned uploaded outcomes are covered; the complete clause's Givebutter and changed-transaction outcome remains absent. No DONE claim. |
| 2 | PASS | Real populated HTTP and D1 records; independent money expectations; supported completion and unsafe refusals both executed. |
| 3 | PENDING EXACT-SHA CI | The existing payment Verify command loads both journeys. The new browser journey always runs; the payment shard also sets its proof directory for both-width captures. CI receipt names the exact candidate run. |
| 4 | PASS ON FINAL LOCAL RUN | Final receipts bind the committed candidate, runtime version and relevant tree hashes. Screens come from that same run. |
| 5 | PASS INSPECTED | PAY-005 already explicitly inherits PAY-004 and GIVE-006. No clause text or acceptance was changed. |
| 6 | PASS MECHANICAL | Run the documented contract write and check with PAY-005 added, then restore both generated files from main. All main Status cells are unchanged. Source lock is regenerated last and checked. |
| 7 | PASS INSPECTED | No acceptance point or contract Status, Gap or Evidence cell changed. |
| 8 | PASS | Owner and admin allow; anonymous, member and agent deny; stale donor, stale batch, merged donor and revoked selector refuse with zero additional money. |
| 9 | PASS BOUNDARY | No provider call or key is needed or used. No live Benevity qualification, account authority, Managed availability or delivery claim. |
| 10 | PASS CONSERVATIVE SCOPE; NO DONE | Current owner or admin only, explicit versioned selection and exact batch approval, private evidence and no outbound action follow the assignment's stated floor. Wider TEAM-001 authority and all ct holds remain unchanged. No broader policy approval is claimed. |
| 11 | PENDING LANDER | Product remains branch-only. Main equality, COMPLETE publication scan with zero findings, exact-SHA Verify and resulting main Run site are the fleet lander's gates. |

## Pre-ready checks and custody

The supported money, authority, privacy, replay and erasure paths are covered through real public doors. Existing assertions are retained. New controls are text-labelled; the inspected screens contain no new icon-only controls. Text is at least 13 pixels, and changed rounded panels use complete borders. The existing look is retained. The required design tool was attempted but its hosted service required an unavailable account connection; no approval or design change was inferred.

Source migrations: 191 existing main migration names and bytes are unchanged, two new migrations are added, and all 193 load in the real D1 journey. Restore and erasure-journal refusal exercise their actual archive custody. MIGRATION-RECEIPT.json records the identity and digest check, and MIGRATION-CHECK.mjs is the actual executable check.

Mechanical commands: `node scripts/contract-docs.mjs write REPORT-004 DATA-004 MOVE-004 MOVE-010 MOVE-012 PAY-005`, then the same `check`; restore ACCEPTANCE.md and docs/CLAIMS.md from origin/main; `node scripts/edition-authoring/cli.mjs lock`, then `check`; run MIGRATION-CHECK.mjs. Generated views and fleet evidence are not committed to the product branch.

Baseline main had successful Verify 42488923453 and Run site 42488923555 at 8a6fd3d093f2c9c1b44ecb74be12f72db09b4cc0. A historical Nightly failure 40627146890 belongs to an older SHA and is not a main failure. Product pushes use only cloud/sx-coffer-c-f173. No PR or main write is performed.

Cloud publication scan receipt: commit=73ba072819742dc675195fa3f9c5f772d49fecf0; complete=not-established; historyScanned=not-established; findings=not-established. The cloud adaptation assigns the full-history scan to the Mac lander. These fields are not represented as a successful scan.

DEFAULT PAY-005: Current owner or admin only; private uploaded evidence, explicit versioned donor selection and exact batch approval, no inferred consent or fee-cover agreement, no automatic receipt, no new billing or provider authority.
GAP PAY-005: Givebutter ingestion and changed transactions, Donorbox, PayPal Giving Fund, other workplace formats, automatic ingestion, changed or refunded disbursements and complete live provider acceptance remain owed. Wider TEAM-001 authority and all existing provider, ct, Base, device and prerequisite holds remain unchanged.

## Actual final local checks

Candidate 73ba072819742dc675195fa3f9c5f772d49fecf0: all six payment registrations pass, zero fail, 285145.014248 ms, with Node 22.20.0 and Chromium at the declared system path. This includes the retained Stripe donor review and the new Benevity journey. Typecheck, first-party check, real build, source lock freshness, generated contract write and check, and migration identity check all exit zero. Source and test files stayed unchanged during this final complete payment run. The product tree is clean.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then check exit=0; views=node scripts/contract-docs.mjs write then check REPORT-004 DATA-004 MOVE-004 MOVE-010 MOVE-012 PAY-005 exit=0, both generated files restored; ledger=node <packet>/MIGRATION-CHECK.mjs exit=0.

PROBE PAY-005 money: mapped USD upload, current donor selection and exact batch approval -> two full contributions of 10000 and 5000 cents, actual fees 320 and 125 cents, exact payout 14555 cents, independent fund and campaign totals, and no synthetic Stripe charge references.
PROBE PAY-005 concurrency: identical-file preview plus concurrent approval and replay -> original batch identity and exactly one gift and fee entry per source, two payout members, unchanged 14555-cent payout.
PROBE PAY-005 erasure: erase the selected and merged donor, then replay with a changed email and restore an older archive with the current journal -> private files and mappings removed, review facts empty, source replay held, old archive refused, anonymous payout totals preserved.
PROBE PAY-005 authority: anonymous, member, agent, revoked admin, changed donor version and stale exact-batch approval -> 401, 403 or 409 as appropriate, with no additional money.
PROBE PAY-005 source review: native file upload and column and provenance mapping, shared-email donor review and explicit selection -> two current candidates and no money until exact batch approval.
PROBE PAY-005 missing facts: absent actual fee, invalid currency, inconsistent net, missing gross or provenance, duplicate transaction, conflicting organization, invented fund mapping, dropped campaign and future deposit -> held or refused before money.
PROBE PAY-005 receipts: ordinary preparation refuses unknown goods; after human classification, preparation reads 10000 cents and a full $100.00 receipt, then explicit human approval sends it. The $96.80 deposit net never becomes the receipt amount.

CLAIM PAY-005 PARTIAL points=2 tests=tests/platform-disbursement-journey.mjs#platformDisbursementJourney; tests/platform-disbursement-browser.mjs#platformDisbursementBrowser

## Product push and exact-SHA CI custody

The guarded product push succeeded on its first attempt. Remote readback confirms cloud/sx-coffer-c-f173 equals 73ba072819742dc675195fa3f9c5f772d49fecf0. Main remains 8a6fd3d093f2c9c1b44ecb74be12f72db09b4cc0; no main write or force push occurred. The exact candidate's push Verify is run 42497143310, observed in progress. Its conclusion is not yet established. No Verify was dispatched or rerun. CI-RECEIPT.json contains the actual REST observation; publication scanning and resulting main Run site remain with the lander.

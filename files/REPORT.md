# sx-coffer-c-f163 — COMM-002 native link verification

COMM-002 remains PARTIAL. All native link work named by this round's planner was already landed before this run began. The named predecessor, `53339239597ca1635e3d419a2e2055817a237472`, is an ancestor of current main. The exact unchanged product head is `c0bc83c0d2a0f1bf8c6ae730dc088a823ea923cf`, now also published as `cloud/sx-coffer-c-f163`. There are zero new product commits and no source, tests, contract text, Status, Gap, Evidence, workflow, homepage or generated-view changes. No duplicate implementation or empty CI-trigger commit was created. No PR was needed or created.

Counts before and after: **96 DONE, 37 PARTIAL, 20 MISSING** of 153. Plan row COMM-002 remains PARTIAL; no plan row or count changes are proposed. The original extract's older totals are not current repository counts.

The native source-link slice passes. Full COMM-002 cannot be claimed DONE: Mango recipient results require the Base-held integration door carrying contact, campaign, own-list and dispatch identities. Full tag synchronization, scheduled appeals, remaining campaign creation, sending, rendering, engagement and recipient timeline parity remain owed beyond the explicitly selected native link slice. The stated unheld Mailchimp account and approved Mango campaign still hold COMM-001 provider-generated MIME and one-click POST proof. The existing TEAM-001, DONOR-009, DONOR-015 and other account, ct, Base and device holds remain unchanged. No new policy default was adopted, no acceptance point was narrowed, and no additional clause was started.

## Execution and product custody

- Fresh full-history clone of the declared repository only; shallow repository check returned false.
- Fleet global and repository identities configured; fleet commit hooks installed and reinstalled after setup. No commit-producing product operation was needed.
- `npx -y @runeditrun/rer setup --owner-email fleet@runeditrun.com --non-interactive` completed under `cloud_run`. Existing rer and Base pins were preserved.
- Before publication, fetched main and ran the required identity-wrapped `git rebase origin/main`: branch already up to date, no replay or conflicts.
- `git log origin/main..HEAD --format="%an <%ae>%n%cn <%ce>%n%(trailers:only,unfold)"` was empty: there are no candidate commits, including side parents, to repair. Cached and candidate CONTRACT diffs were empty.
- Fleet guarded product push succeeded on attempt 1. Remote `main` and `cloud/sx-coffer-c-f163` both advertised `c0bc83c0d2a0f1bf8c6ae730dc088a823ea923cf`. Main was neither pushed nor advanced by this run. Product checkout and index are clean.
- Product push and provenance are retained in `product-push.log` and `PROVENANCE.json`. Evidence is published separately; it is not product acceptance or a landing signal.

## Local checks

All commands below returned exit 0 on the unchanged exact product head. The actual output logs and machine-readable `RECEIPT.json` are included in the packet.

1. `COFFER_CHROMIUM_PATH=/usr/bin/chromium COFFER_EMAIL_ATTRIBUTION_BROWSER=<packet>/browser cloud_run timeout 1200 node --test --test-name-pattern="COMM-002: frozen campaign email links" tests/communications.test.mjs`: 1 registered sanity journey passed, 0 failed; duration 238740.950742 ms. It runs both sender variants internally, with only provider network boundaries faked.
2. `pnpm typecheck`: passed. VM Node was 24.19.0; the setup runner selected the repository's declared 22.20.0 for its own workflow. The typecheck emitted only the expected package-engine warning under the installed VM Node.
3. `pnpm exec rer check --profile first-party`: passed, with no output.
4. `node scripts/contract-docs.mjs write REPORT-004 DATA-004 MOVE-004 MOVE-010 MOVE-012 COMM-002`, followed by the identical `check` arguments: passed. Both generated view files were restored whole from origin main; no generated or CONTRACT changes remained.
5. `node scripts/edition-authoring/cli.mjs lock`, followed by `node scripts/edition-authoring/cli.mjs check`: passed, lock bytes unchanged. No migrations changed, so a migration-ledger check is not applicable.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock and check exit=0; views=node scripts/contract-docs.mjs write and check REPORT-004 DATA-004 MOVE-004 MOVE-010 MOVE-012 COMM-002 exit=0; ledger=none exit=0

No existing assertion was removed, narrowed, skipped or placed behind a new width or branch condition. No test registrations were added, and the focused test remains registered in the communications shard through `tests/communications.test.mjs:513`. Browser assertions execute at 1440; the existing driver captures the same states at 1440 and 390. Browser instances and test Workers closed normally.

## Exact-head CI and publication boundary

The first REST discovery call returned these completed successful runs on the exact product head, before this branch-only custody publication:

- Verify **42230330264**, event **push**, **completed/success**, `c0bc83c0d2a0f1bf8c6ae730dc088a823ea923cf`.
- Verify **42228057357**, event **push**, **completed/success**, the same exact SHA.
- Run site **42230330057**, event **push**, **completed/success**, the same exact SHA.
- Push on main **42230330202**, event dynamic, completed/success, the same exact SHA.
- Run demo **42230330342** was skipped and is not counted as proof.

A second discovery, made more than 300 seconds later, also records the named branch's automatic Verify **42233287757**, event push, **in_progress**, on this same exact SHA. Earlier main Verify 42230330264 and predecessor branch Verify 42228057357 remain completed/success. The required named-branch publication itself started this duplicate run; no dispatch was made. Actual API results, head branches and URLs are in `ci-initial.json` and `ci-final.json`. Two REST calls total; no short-interval polling. No Verify dispatch, rerun, failed-job log request or PR API write was made. CI success is cited only for this exact unchanged SHA; it is not a claim that a new run for this run's named branch had completed.

Full-history publication scanning is a fleet landing duty and was not run from this cloud. Exact-SHA scan receipt: `commit=c0bc83c0d2a0f1bf8c6ae730dc088a823ea923cf complete=UNESTABLISHED historyScanned=UNESTABLISHED findings=UNESTABLISHED`. This run makes no zero-finding or COMPLETE scan claim. Remote main equality is recorded directly, not inferred from CI. No new product text or email-shaped fixture string was introduced.

## Frozen native-link proof map

All rows below refer to `appealEmailAttributionJourney` in `tests/appeal-email-attribution-journey.mjs`, registered as **COMM-002: frozen campaign email links retain honest attribution through payment, reversal and custody**. The local exact-head run passed; the exact-head Verify push runs listed above are successful. `emailAttributionBrowser` in `tests/appeal-email-attribution-browser.mjs` supplies the native pages. None of these rows claims complete combined COMM-002 acceptance.

| Row | Planner outcome and public door | Exact proof | Result |
| --- | --- | --- | --- |
| N1 | Native owner-selected campaign link freezes with defined run code and approved wording | Journey lines 97–135: prepare and approve through native page; inspect exact source, rendered wording, recipient and actual Mailchimp composed body or Mango copyable handoff; replay submits nobody twice. Member and signed-out preparation and member approval or send refused. | PASS for the selected slice |
| N2 | Public resolution refuses unapproved, closed, forged, discarded and cross-campaign sources | Lines 115–128, 138–143 and 192–198: public giving GET and checkout POST exercise each refusal; sessions and sender claims stay empty on refused new work. Last organization-local day is open; after close is held. | PASS |
| N3 | Source survives one-time checkout, return and reordered or repeated signed payment events | Lines 138–165: $50 one-time checkout with a hostile caller channel flag, $20 refund observed first, later charge and checkout events and repeated return; original gift and correction recorded once. Source removal and source switching are refused. Earlier paid return still reconciles after campaign closure. | PASS |
| N4 | Gift attribution and actual fees reconcile to the real fund, campaign, appeal, channel and form | Lines 171–177: independently expected $30 signed contribution in every attribution dimension; $1.25 net fees and $28.75 net, grouped through current native fee reports. | PASS |
| N5 | Full charged receipt, honest recipient and consent and delivery boundaries | Lines 166–184: one $50 receipt, no marketing consent inferred, email recipient is not the independent giver, plain tracked link with caller email flag remains giving-form channel, delivery unknown and response count zero. | PASS |
| N6 | Current consent and ask restrictions hold the next outbound claim | Lines 185–202: withdrawal prevents approval; solicitation stop prevents handoff and creates no saved sender claim. Existing member refusals remain. | PASS for exercised native authority; broader TEAM-001 remains held |
| N7 | Archive, restoration, identity merge and erasure preserve custody without resurrection | Lines 203–223: restored source and frozen receipt; repeated return does not duplicate gifts; merged giver retains $30; erased giver return refused with donor count unchanged and erased address absent from a fresh archive. No extra provider mutation is submitted. | PASS |
| N8 | Native preparation, approval, handoff, giving, return and reports at both required widths | Browser lines 13–63: eight phases per provider at 1440 and 390, 32 actual PNG files; assertions at 1440. Giving requires one-time frequency and leaves marketing consent unchecked. | PASS |

## Complete clause acceptance map

These are the three semicolon-separated scenarios in COMM-002's Acceptance paragraph. The numbers are report references, not additions to the contract. No whole acceptance scenario is newly closed this run; the CLAIM therefore uses `points=none`.

| Scenario | Required outcome | Current proof and remaining outcome | Status |
| --- | --- | --- | --- |
| 1 | Mango and Mailchimp audience fields, exact frozen recipients, approved campaign send, recipient results and unsubscribe, then tracked-link gift | Existing provider journeys in `tests/communications.test.mjs` cover the current merge and list or sender doors; the newly rerun native attribution journey proves the tracked-link gift, accounting and custody. Mango remains a list handoff, with Base recipient results and the remaining full sender and timeline parity unestablished. | PARTIAL |
| 2 | Second appeal scheduled at the approved time and sent only when the test clock reaches it | The selected native-link journey does not exercise scheduled appeals. This remains outside the planner's explicitly limited link slice and remains owed. | NOT ESTABLISHED |
| 3 | Consenting do-not-solicit donor absent from both ask campaigns and present in newsletter campaign | Current solicitation guards remain and the focused journey proves a newly restricted donor prevents the next sender claim. It does not prove complete combined campaign and newsletter parity for both providers. | PARTIAL |

## DONE-RIDERS on this exact head

No DONE claim is made. Each rider is accounted for without promoting the contract.

| Rider | Result | Evidence or limit |
| --- | --- | --- |
| 1 | FAIL for full clause; native slice PASS | N1–N8 reach the selected native outcomes. Full acceptance scenarios 1–3 remain incomplete as above. |
| 2 | PASS for native slice | Real native records, independent $50 and $20 money facts, unsafe refusals and unchanged state assertions, journey lines 138–177 and 185–221. |
| 3 | PASS for native slice | Registration at communications test line 513; journey always calls the browser driver. Exact-head push Verify 42230330264 and 42228057357 successful. Full scheduled and Mango recipient-result proof absent. |
| 4 | PASS | Local proof ran on c0bc83c0d2a0f1bf8c6ae730dc088a823ea923cf; there were no later product-byte changes. |
| 5 | PASS by inspection for this unchanged slice | COMM-002 names APPEAL-001, RCPT-010, GIFT-003, DONOR-014 and DONOR-015 duties. No inheritance or acceptance rewrite was made. Existing wider authority duties remain held. |
| 6 | PASS mechanically; no promotion | Generator write and check passed; original main views restored; no Status, Gap or Evidence cell altered. Counts remain 96, 37, 20. |
| 7 | PASS | No acceptance, ruling, coverage map or contract text change. |
| 8 | PASS for exercised slice | Member and unauthenticated refusals plus stale consent and current ask restriction are exercised, lines 103–128 and 185–202; wider TEAM-001 scope unclaimed. |
| 9 | PASS boundary honesty | Only sender, payment, mail and security-challenge network edges faked. No live sending, delivery, provider MIME, RER Managed availability or Mango campaign rendering claimed. |
| 10 | N/A for new defaults | No policy decision or default introduced. Existing holds and rulings retained. |
| 11 | NOT ESTABLISHED by this cloud | Exact remote main equality and existing Verify and Run site success recorded. No fleet publication-scan receipt available. Counts are not promoted. |

## Pre-ready self-check and probes

1. The selected native outcome has passing sanity assertions through public doors. Full clause completion is expressly not claimed.
2. No assertion or test was changed, removed, narrowed or conditionally hidden.
3. Current role, consent and ask refusals, source replay, merge and erased-giver resurrection guards passed. This run does not expand credential or wider staff authority.
4. No screens were changed. Existing look was retained; the browser proof contains both widths. No new UI polish or icon-control audit was performed.
5. Exact-SHA Verify and Run site are green as listed, source lock is fresh, main equality is direct. Cloud scan COMPLETE and zero findings are unestablished and remain fleet custody. No new fixture was introduced.

PROBE COMM-002 1: native appeal preparation, approval and sender handoff with selected campaign -> exact frozen link and defined RUN code in approved wording; one handoff per recipient.
PROBE COMM-002 2: public checkout with frozen source plus caller channel=mail, signed $20 refund before $50 charge, repeated webhooks and returns -> one original gift, one correction, email attribution $30, actual fee $1.25, net $28.75 and one $50 receipt.
PROBE COMM-002 3: unapproved, unknown, forged, cross-campaign, discarded and closed source; repeated intent with changed source -> refused with no new payment session; prior paid checkout still reconciles after closure.
PROBE COMM-002 4: withdrawn consent, newly restricted recipient and member command requests -> approval or sender claim refused; repeat send adds nobody.
PROBE COMM-002 5: archive, restore, giver merge and erasure followed by return replay -> history retained once before erasure, erased giver refused without resurrection or address retention.
PROBE COMM-002 scheduling: none, outside this round's explicitly selected native link slice; remains owed.
PROBE COMM-002 Mango recipient results: none, the required Base integration door remains unavailable.

CLAIM COMM-002 PARTIAL points=none tests=tests/communications.test.mjs#COMM-002: frozen campaign email links retain honest attribution through payment, reversal and custody; tests/appeal-email-attribution-journey.mjs#appealEmailAttributionJourney; tests/appeal-email-attribution-browser.mjs#emailAttributionBrowser
GAP COMM-002: Native link POINTS are already implemented and pass on the unchanged main head; Base-held Mango recipient results, tag synchronization, scheduling, full campaign and timeline parity, stated live-provider accounts and existing authority and ct holds prevent full DONE. No status or count change.

The full execution plan is in `PLAN.md`. Actual local command output, machine-readable receipts, source provenance, CI discovery and the explicitly selected 32 screenshots accompany this report. Private setup state, credentials, environment files and held-out gate material are excluded.

Evidence transport check: the first report-only publication at `96c68ef0198d61e4d494263eacf3b8d1c7076dfc` was fetched into isolated temporary Git storage and all 45 explicitly selected files were restored with verified manifest hashes. `EVIDENCE-CHECK.json` records the actual successful transfer. This report update adds that receipt and the second CI discovery to the final evidence packet; product head and index remain unchanged.

# sx-coffer-c-f168 — authenticated MCP request capacity

Repository: just-every/run-coffer
Branch: cloud/sx-coffer-c-f168
Candidate: cce622130cf0d7cfca1162e09d5e9a6e43694abe
Baseline main: 87809ba5bce50d1413e6262f41e163d84945c43f
PR: none; branch push is the existing Verify entry point.

CLAIM BASE-AGENT-011 PARTIAL points=1 tests=tests/coffer.test.mjs#API-004: MCP donor context and preparation retain native keys and human approval
GAP BASE-AGENT-011: Company-policy measures and per-call and per-day business thresholds, provider-cost estimates and spend accounting, explicit no-cap policy answers, usage by class and decision and agent, Business Pause all agents and shared Base identity and policy integration remain owed. Existing compatibility daily quotas and human-only native kill and resume remain unchanged. No existing account, ct, Base, device, prerequisite or gate-loop hold is released.

Counts before and after: 96 DONE, 37 PARTIAL, 20 MISSING, 153 total. No Status, Gap, Evidence, acceptance text or generated summary changed. The contract's BASE-AGENT-011 row remains MISSING; this report claims only point 1 and asks the lander to retain the unproved remainder. Plan row reported: BASE-AGENT-011 capacity slice proved; full clause remains PARTIAL in the claim. No lane plan or inbox file was read or changed. No additional campaign target was taken because the remaining campaign entries and their holds are outside the selected capacity slice.

## Plan and completed implementation

1. Map the clause's seven acceptance points to current public MCP journeys and grant journeys. Point 1 had no request-capacity implementation. The brief explicitly holds the company-policy and shared Base remainder; neither current daily preparation quotas nor receipt-send limits establish it.
2. Add one durable transient counter for each existing authenticated bearer-key identity. Use one authority-guarded D1 transaction and an atomic conditional upsert, with no separate admission read. The row stores expiry and request count, has a foreign key to the existing key, and is excluded from archives alongside credentials.
3. Route the existing MCP path and canonical /mcp alias through the same admission function before tool execution. Use 120 requests in a 60-second window, anchored at the first admitted request. Return HTTP 429, MCP_CAPACITY and positive integer Retry-After on excess. A rejected request neither extends the window nor consumes preparation budget. The counter is installation protection, never a grant of business authority or a new company-policy disposition.
4. Extend the existing MCP journey, invoked by the existing API-004 test registration in tests/coffer.test.mjs. Retain the existing named and preparation grant journey unchanged. Use the real Worker, D1 and advancing-clock harness; fake no Coffer service. Prove browser review using the existing browser helper and synthetic installation at 1440 and 390.
5. Run touched journeys, typecheck, first-party check, native migration preflight, contract generation and lock validation. Merge current main without rewriting the published save, inspect every candidate identity and trailer, push the named branch, and return actual reports through the separate evidence ref. Main, default branches, workflow configuration, Base pin, homepage and logos are untouched.

Product commits: 1bb2b6da1320caec02840178eb9bcc4e0f63e859 (capacity save, skip ci) and cce622130cf0d7cfca1162e09d5e9a6e43694abe (final browser review proof and fresh source lock). The save was already published in this workspace; it was preserved. No published history was rewritten.

## Proof rubric for this round

Every row below refers to candidate cce622130cf0d7cfca1162e09d5e9a6e43694abe. The existing API-004 registration invokes mcpJourney, which invokes mcpCapacityJourney. Local run: three tests passed, zero failures, exit 0, 131713 ms total. Verify push run 42467545900 was in progress at first discovery; final status is recorded below and in LOCAL-RECEIPT.json.

| Item | Public door and independently observed result | Proof | Result |
| --- | --- | --- | --- |
| Point 1, rate overrun | 128 overlapping authenticated requests across both paths and both protocol revisions admit 120 and reject 8 with 429, Retry-After 60 and MCP_CAPACITY | tests/mcp-journey.mjs:248-259, API-004 registration at tests/coffer.test.mjs:16 | PASS locally |
| Same key, both paths | Alternating canonical and existing endpoints share admission; an independent key remains usable | tests/mcp-journey.mjs:248-259 and 275-277 | PASS locally |
| Refused preparation has no effect | Saturated key calls ack.prepare and appeal.prepare; letter and appeal lists remain equal, provider message count unchanged | tests/mcp-journey.mjs:260-272 | PASS locally |
| Expiry and Retry-After | At 59999 ms rejection returns 1 second; at the returned expiry an authorized preparation succeeds, with no provider submission | tests/mcp-journey.mjs:284-292 | PASS locally |
| Existing daily quotas preserved | Two preparations remain allowed under the existing daily budget, then a third preparation returns DAILY_LIMIT | tests/mcp-journey.mjs:293-301; unchanged tests/agent-grants-journey.mjs | PASS locally |
| Revocation wins over expiry | Revoke key, advance beyond another window, attempt preparation on both paths and both revisions; every request returns 401 and lists and provider count are unchanged | tests/mcp-journey.mjs:302-310 | PASS locally |
| Signed-in human remains usable | With agent throttled, owner approves a previously prepared letter batch; native readback reports approved with agent preparer and owner approver | tests/mcp-journey.mjs:245-246 and 278-283; tests/mcp-browser.mjs:5-20 | PASS locally; 1440 and 390 images selected |
| Durable schema and custody | New migration applies to real local D1; native preflight reports no pending native apply and migration inventory of 190; ordinary backup and restore journey passes with transient counters excluded | migration-ledger.log; backup test in journeys.log; src/coffer/archive-policy.mjs | PASS locally |
| Acceptance 2 | Company-policy outside-recipient cap and past-cap rule disposition | Explicit held remainder; existing daily compatibility quotas are not this proof | UNPROVED |
| Acceptance 3 | Provider spend cap, budget_exhausted, no partial effect, displayed spend | Explicit held Base and policy remainder | UNPROVED |
| Acceptance 4 | Explicit no-cap answer and spending usage; zero-spend calls unaffected by caps | Explicit held Base and policy remainder | UNPROVED |
| Acceptance 5 | Usage by calls, decisions, class, money and provider spend per agent | Explicit held Base and policy remainder | UNPROVED |
| Acceptance 6 | Native Pause plus Business Pause all agents and resume | Existing native kill coverage retained; shared Business integration held | PARTIAL only |
| Acceptance 7 | Agent cannot resume | Native manager-only command permission at src/coffer/commands.ts:139 retained; existing native kill and resume in tests/agent-grants-journey.mjs:174-184 retained; no new agent-resume probe or authority added | INSPECTED; not newly claimed |

PROBE BASE-AGENT-011 1: concurrent public MCP burst, alternating both paths -> 120 HTTP 200, 8 HTTP 429, Retry-After 60; blocked preparations -> no new draft or provider submission; 59999 ms -> Retry-After 1; 60000 ms -> authorized preparation succeeds; revoked key beyond expiry -> HTTP 401; human review -> approved.

## DONE riders

| Rider | Result for the exact candidate |
| --- | --- |
| 1 | Full clause FAIL for held acceptance 2-6; capacity point PASS locally through real public transport. No DONE claim. |
| 2 | PASS for selected security behavior: admitted and refused requests executed against populated records, refused preparation changes nothing. |
| 3 | Exact-SHA local journey PASS; push Verify 42467545900 pending at discovery. Browser proof is additional local evidence; no full conformance claim. |
| 4 | PASS: selected journeys ran on cce622130cf0d7cfca1162e09d5e9a6e43694abe; no source or test bytes changed afterward. |
| 5 | INSPECTED: this is the Base duty's own clause, with no receiving-clause inheritance rewrite. Existing AGENT-001, API-004 and DEV-012 authority retained. |
| 6 | Existing target-generator limitation: scripts/contract-docs.mjs recognizes the legacy *Acceptance:* shape, while this Base clause uses **Acceptance.**. Direct target write and check both fail with Clause has no acceptance BASE-AGENT-011. The documented legacy clause-set write and check pass. No contract or generated view is committed or repaired. |
| 7 | PASS by diff inspection: acceptance text and all judgment cells untouched; no point added, narrowed or removed. |
| 8 | PASS for touched authority: current key guarded atomically in D1; revoked key refuses on both paths and both revisions after capacity expiry. Existing grant authority journey passes unchanged. |
| 9 | PASS boundary: no live provider, delivery, account, legal or full shared Base qualification claimed. |
| 10 | N/A: installation capacity is explicitly authorized by the brief; no new spending, custody, consent or grant policy disposition adopted. |
| 11 | PENDING guarded Mac lander. Branch-only candidate; main is not the candidate. No publication scan or new Run site claimed. |

## Mechanical checks and pre-ready review

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then check exit=0; views=node scripts/contract-docs.mjs write then check REPORT-004 DATA-004 MOVE-004 MOVE-010 MOVE-012 exit=0; ledger=node migration-ledger-check.mjs <checkout> exit=0.

Direct target generator attempt: write BASE-AGENT-011 exit=1; check BASE-AGENT-011 exit=1, existing unsupported heading described above. The generated files were restored whole from origin/main after both attempts. Lock regenerated last and checked successfully; regeneration left a clean committed tree. git diff origin/main...HEAD -- CONTRACT.md is empty. git diff --check passes.

Pre-ready (1): all behaviors in this selected slice have dangerous allowed and refused public-door assertions; full clause remains unproved and is not DONE. (2): no existing assertion removed, narrowed or conditionally skipped; no permanent test registration added; existing browser option retains the non-browser human-approval assertion. (3): revoked credential, merged and erased donor and read replay paths covered by the existing MCP journey, tests/mcp-journey.mjs:206-231, and retained grants journey. (4): no UI source changed; existing human review captured once at each required width. (5): typecheck, first-party, touched journeys, migration ledger and lock pass; exact-SHA Verify recorded separately; publication scan, main equality and Run site remain lander gates. Changed source and fixtures introduce no email-shaped literal or provider credential. Existing fixture contact generation remains synthetic. The supplied source-lock command and documented generator command pass on the candidate; the target-only parser failure is a pre-existing heading mismatch and does not change the contract or acceptance scope. No credentials, environment dumps or private gate material selected for evidence.

Publication scan exact commit cce622130cf0d7cfca1162e09d5e9a6e43694abe: complete=unestablished, historyScanned=unestablished, findings=unestablished; not run in cloud per task adaptation. Baseline main Verify 42465995605 and Run site 42465995449 were successful in the retained baseline discovery. Candidate main equality: false. New Run site: pending landing. No claim of landed DONE or scan completeness.

## CI and terminal custody

Product push succeeded on first attempt with the required cloud push guard. Full candidate identity range including side parents contained only fleet author and committer identity, with no trailers. Branch head cce622130cf0d7cfca1162e09d5e9a6e43694abe; no force push and no default-branch write. Verify 42467545900, event push, exact head cce622130cf0d7cfca1162e09d5e9a6e43694abe, initially in_progress. Final observation will be appended below. All checks were executed with the supplied toolchain; it selected Node 24.19.0 for the minimum-compatible cloud path and pnpm 10.12.4. CI selects the repository's exact Node 22.20.0. Local pnpm reported the engine warning and completed successfully. Evidence publication is separate from product acceptance and will be cited by its exact evidence ref and commit in the final response.

Final CI observation 2026-11-08T09:37:14Z: Verify 42467545900 is still in_progress, conclusion null, head cce622130cf0d7cfca1162e09d5e9a6e43694abe. One discovery and one follow-up separated by more than 300 seconds were used in this continuation. No retry, rerun or dispatch. The cloud brief limits waiting to a few minutes and assigns final landing gates to the Mac; handoff is PUSHED, with no claim of green Verify, landing, complete scan or Run site. All selected local checks are complete; no local server, browser or test remains running.

PUSHED branch=cloud/sx-coffer-c-f168 head=cce622130cf0d7cfca1162e09d5e9a6e43694abe

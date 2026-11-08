sx-coffer-c-f166 — preparation retry custody

Repository: just-every/run-coffer
Branch: cloud/sx-coffer-c-f166
Candidate: bae5d2d9ffc4653b359614ee34387af8d874afac
Baseline main: c0bc83c0d2a0f1bf8c6ae730dc088a823ea923cf

The selected preparation slice is implemented and locally proven. BASE-AGENT-012 is claimed PARTIAL, with acceptance points 1, 2 and 3 demonstrated for the two existing preparation tools. No Status, Gap or Evidence cell was edited. No acceptance text or generated view was committed. Repository counts remain 96 DONE, 37 PARTIAL, 20 MISSING, total 153. The target's checked-in judgment remains MISSING pending fleet judgment; this report supplies a PARTIAL claim and adds preparation evidence to the plan row. No other campaign row changed.

The completed plan was to map current public RPC and native transaction behavior, introduce a private durable receipt for the two local preparation tools, publish the native effect and quota with that receipt atomically, recheck authority and custody on replay, extend the two existing sanity journeys, regenerate and restore the contract views, refresh the source lock, check the committed candidate and push only the named branch. All those steps completed. The implementation preserves stronger service authority predicates when staging writes. Existing clients without the header, human review, standing sending approval, daily limits and permanent dispatch claims remain enforced.

`Idempotency-Key` is opt-in for `ack.prepare` and `appeal.prepare`, with 1–200 visible ASCII characters. The key namespace is an agent principal, permanently bound to the original grant. A request hash covers the tool and canonical arguments, independent of JSON-RPC id; object properties sort, array order remains meaningful. Successful results retain the original aggregate outcome indefinitely, thus for at least 24 hours. Invalid preparations do not publish a receipt or consume preparation quota on this new atomic path. Request quota continues on replay. Current credentials, tool permission, grant scope, live donor identity and native result ownership are checked before replay. Erasure clears cached aggregates and donor references and keeps the key tombstone. Replay receipts are excluded from archives with agent credentials. No new provider call exists.

Frozen rubric for the selected POINTS, through `POST /api/coffer/mcp`:

| Row | Outcome | Result and public-door evidence |
| --- | --- | --- |
| R1 | Concurrent duplicates create one native preparation and equal results | PASS: `tests/mcp-journey.mjs` lines 45–52; `tests/agent-grants-journey.mjs` lines 77–87 and 138–146. Four ordinary duplicate calls, three named-grant calls and three limited-grant calls return one outcome; native batch and audit readback show one preparation. |
| R2 | Lost response and a new RPC id return the recorded outcome | PASS: `tests/mcp-journey.mjs` lines 79–87. Response bytes are discarded before the client records an outcome; a later RPC recovers it and native audit shows one effect. |
| R3 | Changed arguments or a different tool under one key conflict without effect | PASS: `tests/mcp-journey.mjs` lines 55–58 and 92–93; only the original result is retained. |
| R4 | The retained outcome survives more than 24 hours | PASS: `tests/mcp-journey.mjs` lines 72–75, with a request-local clock advanced 25 hours. |
| R5 | Independent principals have independent outcomes | PASS: `tests/mcp-journey.mjs` lines 88–91; identical key and arguments create distinct native appeal ids. |
| R6 | Current authority gates replay | PASS: `tests/agent-grants-journey.mjs` lines 108–128: kill switch, narrowed scope, removed permission, replacement grant and revoked key refuse; `tests/mcp-journey.mjs` lines 138 onward also exercise expiry and revocation of captured requests. |
| R7 | Human approval and quota remain intact | PASS: `tests/mcp-journey.mjs` lines 63–75: a real person approves, retained identities and hash match, replay does not change approved status. The limited preparation journey replays at quota one while fresh preparation is denied. |
| R8 | Merge and erasure cannot expose or resurrect the saved outcome | PASS: `tests/mcp-journey.mjs` lines 142 onward: merge and both receipt and appeal erasure replays refuse. The original hash is absent from refusal. |
| R9 | Preparation submits nothing to a provider | PASS: `tests/mcp-journey.mjs` asserts captured mail count zero before and after custody refusals. The named-grant journey asserts zero sends during preparation and retains its existing separately authorized two-send regression. |
| R10 | API-004 compatibility without the header remains | PASS: `tests/mcp-journey.mjs` retains the ordinary appeal and legacy handshake, and adds a successful legacy acknowledgment preparation without the header. |

Full clause acceptance and inherited duties:

| Item | Result |
| --- | --- |
| Acceptance 1: one effect and equal results | PASS for the selected preparation slice, R1. |
| Acceptance 2: retry with a new RPC id after dropped response | PASS for the selected preparation slice, R2. The simulated loss discards returned bytes rather than interrupting server execution. |
| Acceptance 3: different arguments conflict | PASS for the selected preparation slice, R3. |
| Acceptance 4: stale revision conflict with current revision | UNIMPLEMENTED and unclaimed; explicitly held remainder. |
| Acceptance 5: another person's job handle reads as not found | UNIMPLEMENTED and unclaimed; no new long-work handle exists. |
| Mandatory keys across every mutating tool | UNIMPLEMENTED and unclaimed; this slice preserves current no-header API-004 clients. |
| API-004 human review and AGENT-001 current authority | PASS in the extended API-004 journey; no approval tool is exposed to ordinary agent credentials. |
| DEV-012 scope, template approval, limits and kill switch | PASS in the existing DEV-012 test with the extended named-grant journey and unchanged automation-grant journey. |
| Shared Base identity and policy integration, provider effects and wider TEAM-001 authority | Held and unclaimed, exactly as the brief states. |

DONE-RIDERS assessment of this PARTIAL claim:

| Rider | Result and evidence |
| --- | --- |
| 1 | PARTIAL: full acceptance 4 and 5 remain unproved. Selected preparation outcomes pass the public journeys above. |
| 2 | PASS for the changed security boundary: allowed duplicates complete; changed input, revoked authority, moved scope, merge and erasure refuse. |
| 3 | PENDING: candidate Verify 42456321408, push event, in progress at discovery. The two journey registrations are already in the existing push Verify commands. |
| 4 | PASS for local proof: `checks-receipt.json` binds a clean checkout and the actual passing run to bae5d2d9ffc4653b359614ee34387af8d874afac. |
| 5 | INSPECTED: no receiving clause or inheritance text was changed or newly claimed. |
| 6 | PASS for applicable mechanics: documented generator write and check passed; generated files restored; status cells remain main's. |
| 7 | PASS: no acceptance sentence, coverage mapping, judgment or count changed. |
| 8 | PASS for touched authority: narrowed scope, removed permission, replacement grant, revoked key, expiry and kill switch are exercised through RPC. |
| 9 | PASS in scope: no live provider qualification claimed; preparation and replay add no provider submission. |
| 10 | INSPECTED: no new custody, consent or delegation policy default is adopted beyond the explicitly requested conservative preparation boundary. |
| 11 | PENDING fleet landing: main is still c0bc83c0d2a0f1bf8c6ae730dc088a823ea923cf, not the candidate; candidate Run site and publication scan are not yet established. |

Exact candidate checks completed successfully: the API-004 and DEV-012 registrations, including their real native HTTP and RPC journeys; typecheck; first-party rer check; source-lock freshness; native migration ledger preflight. The ledger probe reads only migration history from the local setup database, reports `nativeApply: true` for its pending new migration and performs no repair. The journey harness applied every current migration, including the new receipt table and erasure triggers, to each real test installation. No test registrations were added or removed, and no existing assertion was removed, skipped, narrowed or made conditional. No screen or UI component changed, so no new browser capture was required.

The API-001 REST transaction regression also passed before the final test-fixture adjustments; its product source is byte-identical to this candidate. The supplementary `development-regression.log` honestly retains that earlier combined run, which had an API-004 fixture failure because the fixture tried to merge an unsent batch. The final fixture discards that separate batch before merging and the final exact-candidate checks pass. That failure was not a red CI repair. An exploratory attempt to pass BASE-AGENT-012 to the legacy view generator reported `Clause has no acceptance BASE-AGENT-012`, since it only handles the existing legacy acceptance shape; the exact documented generator arguments then passed and generated files were restored. No generator source or clause text was changed.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then check exit=0; views=node scripts/contract-docs.mjs write REPORT-004 DATA-004 MOVE-004 MOVE-010 MOVE-012 then check exit=0; ledger=node /tmp/coffer-ledger-probe.mjs using nativeMigrationPreflight exit=0.

PROBE BASE-AGENT-012 1: concurrent public RPC ack.prepare with one Idempotency-Key -> equal result ids and one native audit effect; a quota-one principal can replay while a fresh preparation is refused.
PROBE BASE-AGENT-012 2: discard public appeal.prepare response bytes, then send a new RPC id and the same key -> original native outcome, one audit effect.
PROBE BASE-AGENT-012 3: replay with changed arguments or tool -> idempotency_conflict, original effect preserved.
PROBE BASE-AGENT-012 custody: replay after grant narrowing, permission removal, grant replacement, key revocation, merge or erasure -> refusal without extra submission.

Publication scan: commit=bae5d2d9ffc4653b359614ee34387af8d874afac complete=false historyScanned=unestablished findings=unestablished, NOT RUN in cloud; full-history scan belongs to the Mac lander. Baseline main had successful Verify runs 42233287757 and 42230330264 and successful Run site 42230330057. Candidate Verify is 42456321408, push event, in progress at the single discovery. No PR is required by the repository's branch push entry point and none was created. No workflow was dispatched or rerun. GitHub API calls used: two, one baseline lookup and one candidate lookup; no polling.

The guarded product push succeeded on its first attempt. Remote named branch equality was independently checked. Product history has one new fleet-authored and fleet-committed commit, no co-author trailer and a fresh lock. The main branch was never pushed or fast-forwarded. Local safety review found no email-shaped strings in added product lines. No credential, environment dump, held-out material or private setup file is selected for evidence publication. Evidence publication is separate from product custody and never asserts acceptance or landing.

CLAIM BASE-AGENT-012 PARTIAL points=1,2,3 tests=tests/coffer.test.mjs#API-004: MCP donor context and preparation retain native keys and human approval; tests/coffer.test.mjs#DEV-012: named and preparation grants enforce scope, template approval, atomic limits and immediate stops through HTTP, MCP and scheduled jobs
GAP BASE-AGENT-012: Mandatory keys beyond these opt-in preparation tools, expected-revision conflicts, sending and provider effects, long-work handles and their ownership, shared Base identity and policy integration and full clause acceptance remain owed; wider TEAM-001 authority and existing holds are unchanged.

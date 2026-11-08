# sx-coffer-c-f169: MCP credential boundary

Repository: https://github.com/just-every/run-coffer
Branch: `cloud/sx-coffer-c-f169`
Candidate: `d60c997d0b9c1124c9ba32be0eafb430584f09c9`
Starting and synchronized main: `cce622130cf0d7cfca1162e09d5e9a6e43694abe`.
No PR is required: the existing Verify workflow accepts the branch push directly.

BASE-AGENT-004 is claimed PARTIAL, with acceptance point 5 proven at the application boundary. No clause text, Status, Gap, Evidence or generated views were committed. Actual counts remain 96 DONE, 37 PARTIAL, 20 MISSING, 153 total before and after this round. The contract's BASE-AGENT-004 row remains MISSING pending the lane's judgment; the requested plan update is application-boundary point 5 complete with the full clause still PARTIAL. No DONE count is requested.

## Plan and result

1. Read the launcher instructions, repository instructions, full target clause and its Status row, the shipped plan extract, current ct rulings, and all eleven DONE riders. Map the seven acceptance points to current native MCP proof. Points 1–4, 6 and 7 have no complete OAuth or Business-token proof; native expiry and key revocation are regressions to preserve, not substitutes for that proof.
2. Place one shared refusal at the start of `cofferResponse`, before dispatch, native identity, quota reservation, execution and application request auditing. Main already contains the canonical `/mcp` route and the existing `/api/coffer/mcp` route; guard both without creating a route.
3. Refuse decoded, case-insensitive parameter names `access_token`, `refresh_token`, `id_token`, `token`, `bearer_token`, `api_key`, `apikey`, `key`, `authorization`, `client_secret` and `password`, including empty and repeated values and requests with a valid native header. Return the same HTTP 400 JSON body with no request-derived values and no-store response headers. Inspect names only and produce no application error, audit event or diagnostic for this refusal.
4. Extend the existing registered MCP journey using actual Worker HTTP, seeded donor and gift records, and migrated D1. Add an optional Worker structured-log observer to the common harness; replace no application service. Exercise both routes with 198 refused requests, checking donor-context withholding, identical response bodies, unchanged audit, native request capacity, preparation and named-grant usage, dispatch reservations, letter and appeal drafts, and provider submissions. Check the synthetic sentinels and the test-created native token are absent from responses, response headers, application audit and Worker diagnostics. Retain the existing header-only discovery, read, preparation, Origin, expiry, revocation and custody assertions. Retain the entire grant journey and its scheduled-job companion through the existing DEV-012 registration.
5. Run touched journeys and typecheck, run the first-party check, fetch main, and synchronize the unpublished branch without dropping another writer's work. Run the documented contract generator write and check, restore generated views from main, regenerate the source lock last, check it, inspect all candidate identities and trailers, commit and immediately push through the fleet guard. Rerun the touched checks on the exact published commit and record its branch workflow.
6. Publish this report and actual non-secret receipts through the separate evidence ref. Leave publication scanning, default-branch landing, generated-view landing output and resulting Run site proof to the maintained fleet lander. Delete the completed product clone only after evidence transfer is established.

All six implementation and reporting steps were executed. The only remaining work is the full clause's explicitly held identity requirements and the independent landing gates. There was no UI change, so no browser screens are touched or claimed. There was no migration or dependency-pin change. No permanent test registration was added or removed; two existing registrations were exercised. No existing assertion was deleted, narrowed or conditionally skipped.

## Public-door probes and frozen rubric

R1 / point 5 refusal: both MCP routes, the eleven documented credential parameters, no Authorization header and a valid native Authorization header, donor-context and two preparation tool calls -> HTTP 400 `query_credentials_not_allowed`; identical credential-free body; no seeded donor details. Encoded, uppercase, empty, duplicated and actual test-created credential values also refuse. Proof: `tests/mcp-journey.mjs` lines 249–279, inside `mcpJourney`, registered by `tests/coffer.test.mjs` line 15. MET locally on the exact candidate.

R2 / point 5 no effect: snapshot real D1 event and access tables, native capacity, both daily-use tables and dispatch reservations; read native letter and appeal collections and captured provider submissions before and after refused calls -> exactly unchanged. Proof: `tests/mcp-journey.mjs` lines 241–247 and 283. The response is returned before identity lookup in `src/coffer/http.ts` lines 261–264. MET locally; ordering also INSPECTED.

R3 / point 5 no credential disclosure: all refusal bodies and headers plus application audit and Worker structured diagnostics -> no synthetic sentinel or test-created key value. Proof: `tests/mcp-journey.mjs` lines 266–272 and 282–286; `src/coffer/mcp/credential-boundary.ts` lines 8–19 never interpolate request values. MET locally on the exact candidate. Hosting and proxy URL logs are outside this application's observation and remain unestablished.

R4 / native regression: header-only discovery, schemas, donor reads and preparations remain usable; wrong Origin, cookie-only actor, expired key and revoked key remain refused. Real merge and erasure readback and replay cannot recover erased context. Proof: `tests/mcp-journey.mjs` lines 45–74, 109–161 and 175–233. The retained `agentGrantsJourney` adds scope, permissions, daily limits, replay, erasure, template freshness and immediate kill or revocation proof. MET locally on the exact candidate.

PROBE BASE-AGENT-004 5: actual Worker POST to both MCP routes with credential query parameters, alone or alongside a valid native bearer header -> stable HTTP 400; no donor context, draft, quota, dispatch, provider, audit or diagnostic effect; header-only native requests still work.

## Acceptance sentence coverage

1. Unauthenticated 401 challenge with resource metadata, trusted servers and scopes: UNMET; native unauthenticated refusal alone is not OAuth resource-server proof.
2. Correct-seed Business token acceptance and sibling refusal: UNMET-EXTERNAL; trusted Business issuer and paired identity qualification remain held.
3. JWT expiry and maximum 15-minute lifetime: UNMET for RFC 9068; native-key expiry is preserved by `mcpJourney` lines 227–230 only.
4. Read-only token refusal with every required tool-family scope in one challenge: UNMET; current native grants do not establish OAuth scope challenges.
5. Query token refused and not logged: MET for the requested application boundary by R1–R3. Hosting or proxy logging is not established and is explicitly documented as outside this proof.
6. Consent revocation in seed or Business within 60 seconds: UNMET for the complete requirement; next-call native key revocation remains covered at lines 231–233 and the retained grant journey lines 191–197.
7. Business refusal after unpairing with continued own-sign-in acceptance: UNMET-EXTERNAL; unpairing and live trusted-issuer behavior are not implemented by this slice.

Inherited native obligations retained: AGENT-001 preparation-only authority and human review; API-004 transport and native-key restrictions; DEV-012 donor scope, standing approval, quota, replay and revocation restrictions. Proof remains in the existing API-004 and DEV-012 registrations. No company-policy authority or wider TEAM-001 permission is granted.

## DONE riders, one result per row

1. FAIL for full DONE: only point 5 is closed; full identity outcomes above remain owed. Scoped point 5 passes the real public-door journey.
2. PASS for this slice: seeded records, allowed native reads and preparations, unsafe requests and unchanged real state are exercised by R1–R4.
3. PENDING branch Verify: the existing push commands run both registrations through `tests/coffer.test.mjs`; exact local proof passes. See `CI.json` for the final observed run event, status and conclusion.
4. PASS: touched journeys, typecheck, first-party and source-lock checks were rerun on the full candidate SHA; no relevant bytes changed afterward.
5. NOT APPLICABLE to new inheritance: no receiving clause or Base citation was changed; existing native inherited duties remain in the contract and journeys.
6. PASS mechanical generation with the repository's exact documented clause arguments; no Status, Gap or Evidence cell was edited. Generated views were restored from main and not committed. No stale view was repaired by hand.
7. PASS: no acceptance text, ruling, coverage map or clause ID was changed.
8. PASS for the touched authority boundary: valid native credentials permit their old actions, while query credentials refuse and change nothing; named-grant authority and immediate stops pass unchanged.
9. PASS honest boundary: no OAuth, Business, JWT, live issuer, host logging or provider qualification is claimed. The limits remain explicit in this report and `docs/MCP.md`.
10. PASS: no new custody, consent, spending or authority default was adopted and no new ct ruling was required.
11. PENDING fleet landing: candidate is branch-only, main is its parent, publication scan and candidate Run site are not established. Main's recorded Verify and Run site were successful on main's own SHA and are not claimed as candidate proof.

## Mechanical and pre-handoff checks

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then check exit=0; views=node scripts/contract-docs.mjs write then check REPORT-004 DATA-004 MOVE-004 MOVE-010 MOVE-012 exit=0; ledger=none exit=0.

The contract generator is the seed's legacy generator. Adding BASE-AGENT-004 to its clause arguments produced `Clause has no acceptance BASE-AGENT-004` because it expects the legacy acceptance delimiter. No contract edit was needed or made, and the exact documented arguments subsequently passed write and check. This is reported as a generator limitation, not hidden or patched into the identity slice.

An initial local test attempt failed before sending the boundary requests because Miniflare requires complete options on `setOptions` (`workers: undefined`). Diagnostic observation was moved to initial harness options; both later touched runs passed. There was no failed CI repair and no weakened assertion.

Pre-handoff 1: requested user-visible and security behavior has public-door assertions; exact branch Verify is recorded separately, never inferred from local success.
Pre-handoff 2: no removed, narrowed or newly skipped assertions; no new registrations.
Pre-handoff 3: native revocation, merged and erased donor custody and replay paths pass unchanged in both retained journeys.
Pre-handoff 4: no screens or icon controls touched; UI proof not applicable.
Pre-handoff 5: lock is fresh; views generate; changed added text contains zero email-shaped strings. Added slash tokens were inspected: all are actual repository paths or existing protocol method identifiers. The full-history cloud clone was non-shallow. The Mac publication scan is NOT RUN here: commit=d60c997d0b9c1124c9ba32be0eafb430584f09c9, complete=unestablished, historyScanned=unestablished, findings=unestablished. No zero-findings claim is made.

Fleet identities and every candidate trailer were inspected before the product push. The sole product commit has the fleet author and committer, with no trailers. The push guard succeeded on attempt 1. The remote product branch was read back at the exact candidate SHA. The worktree and index are clean. There is no finished unpushed product work.

Main evidence at synchronization: Verify 42473545229 completed success and Run site 42473545261 completed success at cce622130cf0d7cfca1162e09d5e9a6e43694abe. Candidate equality with main is false by design; main is a preserved ancestor. These main runs do not satisfy a gate on the candidate.

CLAIM BASE-AGENT-004 PARTIAL points=5 tests=tests/coffer.test.mjs#API-004: MCP donor context and preparation retain native keys and human approval; tests/mcp-journey.mjs#mcpJourney; tests/agent-grants-journey.mjs#agentGrantsJourney
GAP BASE-AGENT-004: OAuth metadata, trusted issuers, RFC 9068 short-lived audience-bound JWTs, sponsoring-person and specialist identity, Business pairing, sibling rejection, tool-family scope challenges, complete consent revocation and unpairing proof remain owed; hosting and proxy URL logging is unestablished. Native bearer keys are not JWT or Business-token proof. Existing account, ct, Base, device and wider authority holds remain unchanged.

## Terminal custody and CI

Exact candidate Verify 42474853714, event push, remained in_progress with conclusion null at 2026-11-08T11:19:47Z, 308 seconds after discovery. Three GitHub API calls were used in total: exact candidate discovery, main run discovery, and one candidate status read. No dispatch, rerun or failed-log archive was requested. All local checks pass, but exact candidate green is not yet established. No READY or landing claim is made; terminal product custody is PUSHED. This honors the cloud CI observation limit and leaves the maintained fleet to evaluate the exact-SHA workflow and publication scan.

The evidence packet is selected explicitly and contains only this full report, the actual receipt, local touched-test and typecheck output, first-party output, mechanical results, remote product-ref readback, and the candidate and main CI observations. It contains no environment dump, credential values, signed browser link, held-out gate material or symlink. Evidence publication is separate from product acceptance and landing.

PUSHED branch=cloud/sx-coffer-c-f169 head=d60c997d0b9c1124c9ba32be0eafb430584f09c9

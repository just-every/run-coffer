# Coffer native MCP audit results

Tag: sx-coffer-c-f172. Repository: just-every/run-coffer.
Branch: cloud/sx-coffer-c-f172.
Candidate: 2c86a9af1c658e9965b17a35985fd336b9e9ef97.
Tree: 7b089c91a3fb4276c7f46848ebd279b38fe05c22.
Starting main: a96722be87079872a12454dbf494d8feff5b37aa.

The selected native slice is implemented and locally proven. BASE-AGENT-009 is claimed PARTIAL, with acceptance point 6 proven for the two existing native key profiles. Its complete fleet audit, company policy and Agents interface requirements remain held. No Status, Gap, Evidence or acceptance text was changed. Contract counts remain 96 DONE, 37 PARTIAL and 20 MISSING out of 153, before and after this candidate. The stored source status for BASE-AGENT-009 remains MISSING; the claim describes the implemented slice without preempting the lander's judgment.

The full execution plan is in PLAN.md. The only plan row affected is BASE-AGENT-009: correlated native MCP tool auditing is now proven; its explicitly held remainder is unchanged. No other campaign clause is claimed or changed.

## What changed

Each recognized authenticated native MCP tool call records an access attempt and a terminal outcome, with a distinct attempt UUID and server request UUID, server-known key ID and retained label, grant ID, grant version, native grant profile, recognized tool and native result code. Schema refusals retain the actual JSON-RPC code; domain refusals retain their native Coffer code. A success uses OK to mean native tool completion, never delivery or a company-policy disposition. Unexpected execution failures retain the generic JSON-RPC internal-error code without exception text.

Successful target identifiers come only from the native result: authorized donor IDs, receipt batch IDs or appeal IDs. Attempts and refusals retain no target IDs from request arguments. Native quota admissions preserve their ordering, counters, status and Retry-After behavior; a bounded inspection correlates recognized tool refusals without execution. Both existing MCP paths and both supported protocol revisions remain usable, including encoded MCP name headers. There is no new tool or grant.

Only a valid, 55-character, lowercase version-00 traceparent with nonzero trace and parent IDs and supported flags is retained. Invalid, duplicated or oversized trace context is omitted. All client name and version metadata is omitted, including otherwise well-formed client-supplied credential sentinels. Client RPC IDs, incoming request-ID claims, raw arguments, raw idempotency keys and exception messages are not retained in these rows. No fleet class, sponsoring person, specialist, company rule, policy revision or policy decision is fabricated from those inputs or native refusal codes.

Access rows remain installation-local and retain captured identity after key revocation. The terminal append can record the outcome of an already authenticated attempt after a native authority refusal; it appends only the captured access row and grants no domain authority. Existing domain events, human approval, native grant checks, atomic quotas, preparation replay and provider submissions remain in their existing services. No schema migration, screen or workflow changed. The current Base and rer pins were retained.

## Local execution and transport receipts

All four touched registrations passed on Node 22.20.0, the repository's exact CI runtime, with zero failures and zero skips. Their actual TAP output is in touched-node22.tap. No registration was added or removed and no existing assertion was narrowed, deleted or put behind a new branch condition. The same source and test bytes are bound to the candidate's committed tree by hashes in validation-receipt.json.

- tests/coffer.test.mjs, line 15: API-004: MCP donor context, generated catalog documentation and preparation retain native keys and human approval.
- tests/coffer.test.mjs, line 392: DEV-012: named and preparation grants enforce scope, template approval, atomic limits and immediate stops through HTTP, MCP and scheduled jobs.
- tests/audit.test.mjs, line 6: TEAM-003: owner filters changes by person, record and action and downloads the same audit as CSV.
- tests/audit.test.mjs, line 55: TEAM-003: the log pages without losing events and identity changes retain their actor.

The public-door probe ran on the committed candidate and created real Worker and D1 records. Its actual runtime-probe.json retains the non-secret transport correlation and access rows for both native profiles. It observed 12 attempts and exactly 12 outcomes, concurrent private reads sharing client RPC ID 7 with distinct server identities, native refusals, one preparation per replay identity, human approval required, retained rows after revocation and zero provider submissions. runtime-probe.mjs and runtime-probe.log preserve the actual probe and its output. No Coffer service or database was faked; only the existing harness's mail network boundary was available and received no submissions.

PROBE BASE-AGENT-009 concurrency: three simultaneous private-context calls per profile using the same client RPC ID -> separate server request and attempt IDs, each paired with exactly one outcome.
PROBE BASE-AGENT-009 1: authenticated ack.prepare and repeat with the same replay identity -> one prepared batch, matching success access rows, agent approval refused, signed-in human approval succeeds.
PROBE BASE-AGENT-009 2: authenticated private-context refusal -> NOT_FOUND for an absent preparation-key target and GRANT_SCOPE for an out-of-scope named-grant target; each terminal row has empty targets and no additional provider submission.
PROBE BASE-AGENT-009 3: none; class and decision counts on a new Agents page remain outside this native slice and require the held shared facts.
PROBE BASE-AGENT-009 4: none; a company-policy review feed and its review or undo actions remain held.
PROBE BASE-AGENT-009 5: owner-authenticated audit JSON and CSV filtered by key and action -> complete matching native event details and paired rows; class filtering remains held.
PROBE BASE-AGENT-009 6: revoke each native key, reread its owner-authenticated audit and retry the key -> unchanged retained rows and key label, credential rejected with 401.
PROBE BASE-AGENT-009 7: none; no Agents screen was added or changed, so no new screen or accessibility completion is claimed.

The existing journeys additionally cover scope narrowing, erased and merged identities, stale templates, shared daily sending limits, rejected preparation quota and request capacity, malformed metadata, forbidden tools, credential-bearing query refusals, anonymous and cookie actors, frozen human approval, replay custody and both admitted and refused named-grant sending. The named-grant sending journey still observes exactly two allowed provider submissions; refused and replayed operations add none. Preparation-only operations and the separate probe observe zero provider submissions.

One development run of the new audit-tracking helper failed because it initially treated an authentication refusal carrying a request ID as an executed tool. The helper now tracks admitted tool calls separately from 401 authentication refusals, and explicit assertions preserve the requirement that invalid credentials create no tool facts. The final Node 22 run is green. This was a local assertion-development failure, not an exact-SHA CI failure or a Verify repair round.

## Frozen native-slice rubric

| ID | Selected native obligation | Evidence and result |
| --- | --- | --- |
| R1 | Reads and preparations under both existing profiles have correlated attempt and terminal access rows with server identity and native code | PASS: tests/mcp-journey.mjs lines 36 and 355; tests/agent-grants-journey.mjs lines 189 and 251; runtime-probe.json has 12 paired attempts and outcomes. |
| R2 | Native scope, permission, schema, stale-state and quota refusals retain their code and no unauthorized target identifiers | PASS: tests/agent-grants-journey.mjs lines 125 and 189; tests/mcp-journey.mjs lines 478 and 520; runtime-probe.json records empty refusal targets. |
| R3 | Server request identity and bounded trace context distinguish concurrent attempts while malformed and untrusted metadata is rejected or omitted | PASS: tests/mcp-journey.mjs lines 132 to 151 and 355; tests/audit.test.mjs lines 15 to 31; runtime-probe.json retains repeated client RPC ID 7 with distinct server UUIDs. |
| R4 | Authenticated JSON and CSV expose the same retained facts, filters work, and revocation keeps rows and key labels | PASS: tests/mcp-journey.mjs lines 36 to 102 and 383 to 390; tests/agent-grants-journey.mjs lines 224 to 227; tests/audit.test.mjs lines 19 to 52. |
| R5 | Credentials, raw arguments, raw replay keys and out-of-scope private facts do not enter new tool audit output | PASS: tests/mcp-journey.mjs lines 355 to 360; tests/agent-grants-journey.mjs line 189; tests/audit.test.mjs lines 24 to 31; runtime-probe.json excludes the client credential sentinel. |
| R6 | Domain audit, replay, approval, quotas and provider submissions remain native | PASS: tests/mcp-journey.mjs retains existing preparation, human approval, replay, erasure and capacity assertions; tests/agent-grants-journey.mjs lines 145 to 194 and 224 to 252 retain one freeze and exactly two allowed sends, with no additional submission on refusal. |
| R7 | No unavailable shared class, company-policy, sponsoring-person or specialist facts are invented | PASS for this slice: tests/mcp-journey.mjs line 77 asserts no classes or decision field in native tool outcomes; src/coffer/mcp/audit.ts lines 37 to 51 retain only the declared access facts. Full shared integration remains owed. |

## Full clause acceptance sentences

| Point | Outcome | Candidate evidence and remaining duty |
| --- | --- | --- |
| 1 | PARTIAL | Native preparation writes now leave paired access facts, as proven by API-004 and DEV-012 and the committed-head runtime probe. A complete fleet row still needs classes and facts, company policy revision and rule, sponsoring person, specialist and the other held shared fields. |
| 2 | PARTIAL | Native refused calls are reached and audited through scope, permission, schema, stale-state and quota refusals. Pending, unset and self-escalation company-policy calls remain held and are not inferred from native errors. |
| 3 | HELD | No Agents class and decision counters are supplied by this slice. Shared classification and company-policy facts remain prerequisites. |
| 4 | HELD | No policy review feed, review mark or policy-driven undo door is supplied. Existing human batch approval remains intact and proven. |
| 5 | PARTIAL | Native agent-key and action filtering and complete matching JSON and CSV details pass TEAM-003 and the shared audit assertions. Class filtering and full fleet-field export await shared facts. |
| 6 | PASS for both existing native profiles | API-004, DEV-012 and TEAM-003 revoke the key, reject reuse, and compare retained audit rows and captured key names. The committed-head runtime probe repeats this for both profiles. |
| 7 | HELD | No new Agents page or accessibility proof is claimed. No existing screen was touched. |

## DONE-RIDERS

| Row | Result | Evidence or boundary |
| --- | --- | --- |
| 1 | PARTIAL for the full clause; PASS for the selected native slice | The rubric and seven acceptance rows above map outcomes reached by the existing public-door journeys. Held shared policy and Agents requirements prevent DONE. |
| 2 | PASS for native slice | API-004 and DEV-012 perform real allowed reads and preparations and real unsafe refusals on seeded Worker and D1 data. The provider submission and unchanged-batch assertions cover both sides. |
| 3 | PENDING candidate CI at report preparation | Push Verify 42485216600 targets this exact candidate. API-004 and DEV-012 run in the existing donors verification entry; both TEAM-003 registrations run in donor-custody. No workflow was changed or separately dispatched. |
| 4 | PASS local proof binding | validation-receipt.json binds all touched files and tests to tree 7b089c91a3fb4276c7f46848ebd279b38fe05c22. The separate runtime probe ran after committing this exact head. |
| 5 | INSPECTED, unchanged | BASE-AGENT-009 already extends BASE-OPS-005 in its requirement at CONTRACT.md line 1401. Existing AGENT-001, API-004 and DEV-012 duties are preserved, not expanded or substituted. |
| 6 | PASS mechanical; source judgment untouched | Documented contract write and check pass. Generated views were restored from origin/main; no Status, Gap, Evidence, acceptance or summary count changed. |
| 7 | PASS | CONTRACT.md is byte-identical to main; no acceptance text or clause ID was rewritten. |
| 8 | PASS native authority | API-004 and DEV-012 exercise forbidden approval, out-of-scope targets, current grant narrowing, expiry, revocation, kill switches and stale authority. TEAM-003 denies agent, member and anonymous audit access. |
| 9 | PASS boundary honesty | Network fixtures establish no live provider, delivery, company-policy or Business qualification. Existing provider and authority holds remain explicitly retained. |
| 10 | PASS, no new policy default | This slice records existing native facts and introduces no custody, spending, consent or authority disposition. No new ct ruling is claimed or needed for these access facts. |
| 11 | PENDING guarded lander | Product is branch-only. Candidate main equality, complete publication scanning and Run site are not established by this cloud run and remain guarded landing requirements. |

## Inherited duties and pre-ready self-check

| Duty | Result | Proof |
| --- | --- | --- |
| AGENT-001 read and preparation boundary; a person decides | PASS | API-004 retains the frozen batch, agent approval refusal and native human approval assertions; runtime probe independently observes prepared then human-approved state. |
| API-004 native credential and protocol boundary | PASS | API-004 retains both protocol revisions, discovery, body and metadata validation, cookie and anonymous refusals, credential-query refusals and revoked or expired credential behavior. New events begin only for recognized authenticated tools. |
| DEV-012 named scope, standing approvals and native limits | PASS | DEV-012 retains explicit donor scope, smaller private projections, atomic two-send limit, cross-key ownership refusal, template changes and kill switches. New access assertions compare the exact native code and grant version. |
| TEAM-003 owner or admin audit authority and export | PASS | Both existing TEAM-003 registrations pass; CSV and JSON details match and member, agent and anonymous callers are refused. |
| Replay, erasure and identity custody | PASS for existing native paths | API-004 and DEV-012 retain their merged or erased donor and replay refusals. New tool outcome targets arise only from current successful native results, and refused rows contain no request targets. |
| No removed or weakened assertion | PASS | Existing assertions and registrations were retained; the new assertions extend the existing registered flows. |
| Touched screen rules | NOT APPLICABLE | No screen, copy, layout or control was changed. |
| Source lock and migration ledger | PASS and NOT APPLICABLE | Source lock regenerated last and checked after the no-op rebase. No migration was added or edited. |
| Publication text and identity hygiene | PASS local changed-tree inspection | Candidate author and committer use the fleet identity; no trailer, new email-shaped fixture value or unrelated slash prose was added. This is not a complete publication scan. |

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock and node scripts/edition-authoring/cli.mjs check exit=0; views=node scripts/contract-docs.mjs write REPORT-004 DATA-004 MOVE-004 MOVE-010 MOVE-012 and matching check exit=0; ledger=none exit=0.

The generator was run with this edition's documented touched-clause argument list. BASE-AGENT-009 acceptance and source judgment were not edited. Generated ACCEPTANCE.md and docs/CLAIMS.md were restored from origin/main before the commit. The lock includes the new audit module and all final source and test edits.

## Publication and held remainder

The fleet push guard published the first real commit on its first attempt to the named product branch. All candidate commit identities and messages, including side parents, were inspected with the required origin/main range before pushing; there is one candidate commit, with fleet author and committer and no trailers. Main was fetched immediately before publication; the rebase was a no-op and the lock check still passed. No force push, default-branch push, PR, dispatch or workflow edit occurred.

Starting-main Verify runs 42480648831 and 42479271389 and Run site 42480648829 were observed completed successfully on a96722be87079872a12454dbf494d8feff5b37aa. Candidate push Verify 42485216600 was discovered in progress on 2c86a9af1c658e9965b17a35985fd336b9e9ef97 and remained in progress at the single permitted follow-up poll, more than 300 seconds later. Three GitHub API calls were used in total. No failed or green candidate conclusion is asserted. CI observations and their actual status are retained in the explicit packet receipt files; no other SHA's green result is claimed for the candidate.

Exact-candidate publication scan: commit=2c86a9af1c658e9965b17a35985fd336b9e9ef97 complete=NOT_RUN historyScanned=NOT_ESTABLISHED findings=NOT_ESTABLISHED. The full-history product clone was used, but the Mac publication scan is unavailable in this cloud adaptation. These are unestablished gates, never zero findings. Main equality and candidate Run site are likewise pending the guarded lander.

GAP BASE-AGENT-009: Fleet risk classes and computed-class tests; company-policy rules, revisions and dispositions; sponsoring-person and specialist identity; pending, unset and self-escalation outcomes; Agents counts, review, approval and setup UI; Business aggregation; non-MCP agent doors; shared Base registry and check integration; and the Base conformance journey under both real company policies remain owed. Existing AGENT-001, API-004, DEV-012 and wider TEAM-001 restrictions and every account, ct, Base, device, prerequisite and gate-loop hold remain unchanged. Native audit completion supplies none of those shared facts or authority.

CLAIM BASE-AGENT-009 PARTIAL points=6 tests=tests/coffer.test.mjs#API-004: MCP donor context, generated catalog documentation and preparation retain native keys and human approval; tests/coffer.test.mjs#DEV-012: named and preparation grants enforce scope, template approval, atomic limits and immediate stops through HTTP, MCP and scheduled jobs; tests/audit.test.mjs#TEAM-003: owner filters changes by person, record and action and downloads the same audit as CSV

The pushed candidate is handed to the maintained cloud lander under the brief's READY handoff rule. Local gates pass and no known real failure remains. READY is custody of this branch candidate, not a DONE claim, a CI-success claim, acceptance or landing. The lander must still require exact-SHA Verify and its own publication scan before landing and confirm Run site afterward. Product custody is independently recorded in product-custody.json.

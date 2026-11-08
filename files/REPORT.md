# sx-coffer-c-f164 plan and results

Repository: just-every/run-coffer
Branch: cloud/sx-coffer-c-f164

## Plan

1. Read the target clause, current MCP transport, native actions, permission services and registered journeys. Map points 1 to 6 and the eleven DONE riders before making claims.
2. Extract only the four currently exposed read and preparation tools and the existing conditional receipt-send tool into an executable catalog. Keep names, inputs, native bindings, discovery selection, refusal codes and authority unchanged. Add output schemas, Core-clause metadata and accurate descriptions.
3. Extend the existing API-004 and DEV-012 sanity journeys. Validate actual results with an independent JSON Schema validator; compare native reads and preparation state and audit event types; retain unsafe-action, quota, template, scope, kill-switch and key-revocation cases. Add no test registration.
4. Run only touched registered journeys, typecheck and the required first-party check. Run the documented contract generator, restore generated views, regenerate the source lock last and check it. Inspect staged contract changes and every candidate commit identity and trailer before pushing.
5. Push preservation saves and the final candidate only to the named cloud branch, merge current main after a published save, discover exact-SHA Verify using REST, and report actual CI custody. Publish this complete non-secret packet separately on the evidence ref. Leave publication scanning and landing to the fleet.

## Scope decision

BASE-AGENT-002 is MISSING in the repository Status table. This round proves the planner-selected permitted-tool slice. Its complete Core coverage, legitimate exemptions, canonical seed-prefixed names, embedded-agent reuse, and shared Base registry, check and conformance integration remain owed. Those requirements cannot honestly become DONE from a transport extraction. No Status, Gap or Evidence cell is edited. No policy default, permission expansion, UI change or live provider qualification is introduced.

## Initial baseline

Main: c0bc83c0d2a0f1bf8c6ae730dc088a823ea923cf
Counts before: {"done": 96, "missing": 20, "partial": 37}
Exact-main push Verify: 42233287757 and 42230330264 success. Run site: 42230330057 success.

## Final product result

Candidate: `4e4efb9eefdedc9f87b2a307658052470ee9fd78`. Both product commits are published on `cloud/sx-coffer-c-f164`; the first preservation save is `93e95a6fa8213f68e8d2ea3db4530a4a7736e3cf`. The clone retained full history and the configured fleet commit hook. The final fetch found main unchanged, so the published branch needed no merge commit and no history rewrite. Main remains `c0bc83c0d2a0f1bf8c6ae730dc088a823ea923cf`; the candidate is branch-only. There is no PR because the existing Verify has a direct branch-push entry point.

Counts after: 96 DONE, 37 PARTIAL, 20 MISSING of 153, unchanged from the actual initial main. The proposed plan update is BASE-AGENT-002 MISSING to PARTIAL for points 2, 3, 4 and 5 of the currently permitted tools. No contract Status, Gap, Evidence or generated view changed. No broader claim for Base jobs is made.

The executable catalog lives in `src/coffer/mcp/catalog.ts`, with the unchanged accepted inputs and validator in `src/coffer/mcp/input.ts` and native result schemas in `src/coffer/mcp/output.ts`. Discovery strips executable callbacks; transport execution calls that same selected entry. Native services remain the only authority and validation boundary. The read schemas preserve the separate preparation and named-grant projections, explicit nulls, typed native scalar extension columns and computed objects. No output is replaced by a fixture or a second read model.

## Frozen proof map

Existing Verify registrations: `tests/coffer.test.mjs:15`, **API-004: MCP donor context and preparation retain native keys and human approval**; `tests/coffer.test.mjs:392`, **DEV-012: named and preparation grants enforce scope, template approval, atomic limits and immediate stops through HTTP, MCP and scheduled jobs**. The existing push command includes both registrations. Added registrations: 0; removed registrations: 0. No existing assertion was deleted, narrowed or made conditional. The two touched registrations passed on Node v22.20.0 at the exact candidate; actual commands, exit codes, times and stdout hashes are in `checks.json`, with full small stdout files selected in this packet.

| Rubric | Acceptance sentence or inherited duty | Candidate evidence | Result |
| --- | --- | --- | --- |
| R1 | Point 1: Core ids, legitimate exemptions and complete coverage enforced by the shared harness and check | `tests/mcp-journey.mjs:45` reads actual catalog Core links; `src/coffer/mcp/catalog.ts:10` declares them. Complete Core coverage, exemptions and Base integration are still owed. | PARTIAL |
| R2 | Point 2: every exposed tool fixture result validates against its output schema | `tests/mcp-schemas.mjs:6` compiles discovered schemas with strict Ajv; `tests/mcp-journey.mjs:56`, `tests/mcp-journey.mjs:60`, `tests/mcp-journey.mjs:71`, `tests/mcp-journey.mjs:79`, `tests/mcp-journey.mjs:107`, `tests/mcp-journey.mjs:124` validate live native reads and preparation. `tests/agent-grants-journey.mjs:68`, `tests/agent-grants-journey.mjs:69`, `tests/agent-grants-journey.mjs:91`, `tests/agent-grants-journey.mjs:110` cover the named projection and actual send. | PASS; exact push Verify 42456540787 success |
| R3 | Point 3: truthful read, destructive and external annotations | `tests/mcp-journey.mjs:50` checks read and closed-world discovery; `tests/agent-grants-journey.mjs:64` checks conditional external sending. Nondestructive and non-idempotent preparation bindings are inspected in `src/coffer/mcp/catalog.ts:23`. | PASS locally and INSPECTED; exact push Verify 42456540787 success |
| R4 | Point 4: native stable business refusal codes | `tests/mcp-journey.mjs:73`, `tests/mcp-journey.mjs:119`; `tests/agent-grants-journey.mjs:113`, `tests/agent-grants-journey.mjs:120`, `tests/agent-grants-journey.mjs:127`: both public doors refuse settings, due-state, replay, limit and template violations without changing native records or sending again. `src/coffer/mcp.ts:78` retains the same error envelope. | PASS; exact push Verify 42456540787 success |
| R5 | Point 5: native action state and audit event parity | `tests/mcp-journey.mjs:59`, `tests/mcp-journey.mjs:62`, `tests/mcp-journey.mjs:81`, `tests/mcp-journey.mjs:89`, `tests/mcp-journey.mjs:109`, `tests/mcp-journey.mjs:117`; `tests/agent-grants-journey.mjs:91` and `tests/agent-grants-journey.mjs:117`. The same native functions are bound in `src/coffer/mcp/catalog.ts:12`. | PASS; exact push Verify 42456540787 success |
| R6 | Point 6: embedded agents audited through the same shared tools | No embedded agent is rerouted; the planner retains the shared Base registry and embedded adoption as remainder. | UNMET, Base integration required |
| R7 | AGENT-001 and API-004: ordinary preparation requires human approval; no export or sending authority | `tests/mcp-journey.mjs:95` refuses approval, receipt sending and document calls, retains prepared state, then verifies the actual owner approval and frozen hash at line 105. Existing expiry and revoke assertions remain at the journey end. | PASS; exact push Verify 42456540787 success |
| R8 | DEV-012: named, explicit, scoped, template-bound standing receipt permission | `tests/agent-grants-journey.mjs:72` to line 147: scope and related-recipient refusals, native freezes, atomic shared quota, own-batch checks, template change, immediate stop, narrowed permission and unchanged mail count. Actual allowed submissions use only the SendGrid network fake. | PASS; exact push Verify 42456540787 success |
| R9 | DONOR-008 and existing custody boundaries | `tests/mcp-journey.mjs:98` refuses record documents; line 70 withholds confidential note text. `tests/agent-grants-journey.mjs:70` withholds related household identities, line 98 erases a scoped donor, and line 113 refuses replay with no additional mail. | PASS; exact push Verify 42456540787 success |

## DONE-RIDERS

| Rider | Result | Evidence or remaining duty |
| --- | --- | --- |
| 1 | FAIL for whole-clause DONE | R1 and R6 remain unproved; R2 to R5 pass locally. No DONE claim. |
| 2 | PASS | Populated native records at `tests/mcp-journey.mjs:32` to line 72; allowed and refused receipt submission, scope, replay and unchanged mail counts at `tests/agent-grants-journey.mjs:72` to line 147. |
| 3 | PASS | Push Verify 42456540787 completed successfully on the exact candidate and includes both existing registrations. See `ci.json`. |
| 4 | PASS | All five local commands ran against the clean exact candidate; see `checks.json`. |
| 5 | INSPECTED, no new inheritance assertion | This change adds no acceptance text or new receiving clause. Existing AGENT-001, API-004, DEV-012, document and scope restrictions are retained and exercised as R7 to R9. |
| 6 | PASS for documented mechanical commands | The documented generator write and check passed for REPORT-004, DATA-004, MOVE-004, MOVE-010, MOVE-012. Generated files were restored from main and are not in either product commit. Exact-candidate check passed again in `checks.json`. Status and provenance remain the lander's property. |
| 7 | PASS | CONTRACT.md is byte-identical to main. No acceptance rewrite, addition or status edit. |
| 8 | PASS | Dangerous allowed and refused cases cover grant scope, permission, standing approval, template version, shared limit, erasure, replay and kill switches in the DEV-012 registration. |
| 9 | PASS with boundary retained | Only Coffer behavior is proven. SendGrid acceptance at the documented network edge is not delivery proof. No live provider qualification, Base completion or wider TEAM-001 authority is claimed. |
| 10 | PASS | No new policy default adopted; existing authority is unchanged. |
| 11 | PENDING LANDER | Candidate is published branch-only; main equality is false. Exact-SHA publication scan and Run site are fleet gates, not cloud claims. |

## Pre-handoff self-check

1. The selected catalog behaviors have public-door assertions in the two existing registrations; every current catalog tool returns actual native output validated by its discovered schema. Full-clause points 1 and 6 remain gaps. Exact-SHA push Verify 42456540787 completed successfully.
2. No assertion was removed, narrowed or moved behind a width or environment condition. The optional existing browser legs remain intact. No screen, component, homepage or design file was changed, so new browser proof is not applicable.
3. Existing revoked-key and global stop paths remain. New scoped erasure removes the donor from discovery and refuses context; a replayed submitted receipt is refused with unchanged mail count. Native transaction guards and services are unchanged.
4. UI layout and tooltip checks are not applicable to this API-only extraction.
5. Source lock is fresh on the exact committed tree; first-party check and typecheck pass. Publication scanning and Run site are not available from this cloud route and are unestablished until the fleet lander runs them. No new email-shaped string or secret pattern occurs in changed source, docs or test text. Required MCP method and MIME literals, plus the Node builtin assertion module, were manually distinguished from prose repository references.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then check exit=0; views=node scripts/contract-docs.mjs write then check REPORT-004 DATA-004 MOVE-004 MOVE-010 MOVE-012 exit=0, restored from main; ledger=none exit=0

Publication scan: commit=4e4efb9eefdedc9f87b2a307658052470ee9fd78 complete=unestablished historyScanned=unestablished findings=unestablished; deferred to the maintained Mac lander by the cloud adaptation. No COMPLETE or zero-finding result is invented.

## Claims and gaps

CLAIM BASE-AGENT-002 PARTIAL points=2,3,4,5 tests=tests/coffer.test.mjs#API-004: MCP donor context and preparation retain native keys and human approval; tests/coffer.test.mjs#DEV-012: named and preparation grants enforce scope, template approval, atomic limits and immediate stops through HTTP, MCP and scheduled jobs
GAP BASE-AGENT-002: Complete Core-job coverage and legitimate exemptions, canonical seed-prefixed names, embedded-agent adoption and shared Base registry, check and conformance integration remain owed. Existing approval, export, send, document, scope, TEAM-001 and all account and prerequisite holds are unchanged.

## Product commits

4e4efb9eefdedc9f87b2a307658052470ee9fd78 Prove populated MCP schemas and unchanged receipt authority
93e95a6fa8213f68e8d2ea3db4530a4a7736e3cf Extract the permitted MCP catalog with native result schemas [skip ci]

Runtime probes are in `probes.txt`. Actual local receipts are in `checks.json`; CI observations are in `ci.json`. No live secret, setup output, credential file, private gate material or symlink is selected for evidence.

## Final CI and custody

Verify run 42456540787, event push, status completed, conclusion success, head 4e4efb9eefdedc9f87b2a307658052470ee9fd78, URL https://github.com/just-every/run-coffer/actions/runs/42456540787 . Final observation: 2026-11-08T07:09:08Z. Five GitHub API calls in total, with one watcher and at least 300 seconds between candidate-run observations. No dispatch, rerun, failing-job repair or PR was needed.

The product branch and all actual local receipts are bound to the same full SHA. The remote ref and both fleet commit identities were rechecked and saved in `custody.json`. The separate evidence ref publishes this complete selected packet. The scratch product clone is removed only after successful report publication; the packet remains outside the clone. The official Status table and counts are unchanged until fleet judgment. Full-clause DONE is not claimed. Main equality, publication scan and candidate Run site remain lander conditions.

READY branch=cloud/sx-coffer-c-f164 head=4e4efb9eefdedc9f87b2a307658052470ee9fd78

# sx-coffer-c-f171 results

The selected native-key attribution slice is implemented. BASE-AGENT-008 is claimed PARTIAL, not DONE. The full clause retains the held scope explicitly named in the brief.

Product repository: just-every/run-coffer
Branch: cloud/sx-coffer-c-f171
Candidate: 6b16ac867cd8bec68603f1b7addc7efef16b48ed
Observed main: a96722be87079872a12454dbf494d8feff5b37aa
Published save: 47f48091e8a7fb79d1f4a1201562351baf5cbe7e
PR: none; the branch push is the existing Verify entry point.
Branch Verify: 42485097456, push event, exact candidate SHA; status=in_progress, conclusion=None, observed 2026-11-08T13:38:49.920478+00:00. This is a branch handoff, not a claim of green CI. The guarded fleet lander enforces exact-SHA success before landing.
Observed main Verify: 42480648831, push event, completed success.
Observed main Run site: 42480648829, push event, completed success.

## Change and scope

Both bearer authentication and stored-key delegation join the key's created_by relation to the actual native operator. A focused helper supplies a display snapshot consisting of the key label followed by the actual creator name. Key actor ID, agent role, grant identity, current-authority predicates and record scope stay intact. Request-supplied creator claims do not supply attribution.

Existing preparation, approval, activity and audit columns retain the display snapshot. New audit details retain the native key ID, label, creator ID and creator name. No migration or history backfill occurs. Old rows are not reinterpreted through a current creator join.

Human approval keeps the signed-in person as approver and the agent as preparer. Standing receipt approval now retains the actual approving person's ID, name and role and its standing-grant basis in audit details. The receipt Decision panel describes that basis explicitly. Existing audit, appeal and activity renderers already show their persisted names, so no unrelated rendering rewrite is needed.

The scope grants no OAuth, Business sponsorship, specialist role, company policy or new sending authority. Homepage, logo, Base pin, acceptance text, Status cells, Gap cells, Evidence cells and generated views are unchanged.

## Plan completion

The complete plan is in PLAN.md. Steps 1 through 7 are locally complete. The first real commit was preserved as a CI-skipped save. Current main was fetched and merged before the candidate; it was already up to date. The final source lock was regenerated after source edits. Exact-SHA CI discovery, product custody and evidence transport are recorded in receipt.json and CI.json. Publication scanning and landing belong to the fleet.

Selected plan row: BASE-AGENT-008 native-key creator attribution is closed by the named journeys. No other plan row changed. Status counts before and after are 96 done, 37 partial, 20 missing, total 153. The selected source Status row remains missing as required by the single-writer contract. The submitted claim is PARTIAL; the builder makes no DONE count change. The older plan extract's 139-clause counts are not substituted for the current repository.

No test registration was added or removed. Three existing registrations were extended, and the existing second audit registration still runs. No pre-existing assertion was removed, skipped, narrowed or moved behind a viewport condition. Assertions at one width and screenshots at both widths follow the UI proof rule; existing repeated approval assertions remain.

## Frozen rubric for the selected native slice

| Row | Outcome | Proof and result |
| --- | --- | --- |
| R1 | Native creator comes from authenticated key creation, independently of a caller's creator claims | PASS: tests/mcp-journey.mjs lines 45 to 48 and 143 to 150 create an admin-owned key with conflicting supplied creator claims and assert the native creator ID and name. |
| R2 | Both existing grant profiles preserve key identity and agent role on real preparation | PASS: tests/mcp-journey.mjs lines 140 to 150; tests/agent-grants-journey.mjs lines 154 to 163; existing API-004 and DEV-012 registrations. |
| R3 | A signed-in approver is distinct from the key creator and agent preparer | PASS: tests/mcp-journey.mjs lines 172 to 178 and 203 to 210; browser performs actual receipt and appeal approval. |
| R4 | Standing approval retains its actual approving person, separately from creator provenance | PASS: tests/agent-grants-journey.mjs lines 183 to 194; tests/audit.test.mjs lines 27 to 43. |
| R5 | Stored-key delegation reaches real preparation, activity, audit and CSV | PASS: tests/audit.test.mjs lines 17 to 49 through receipt settings and run routes; tests/mcp-browser.mjs mcpStoredBrowser. |
| R6 | Revocation refuses new work while historical attribution stays fixed | PASS: tests/audit.test.mjs lines 50 to 55, including creator deactivation and byte-identical filtered audit CSV; tests/mcp-journey.mjs lines 313 to 323; tests/agent-grants-journey.mjs lines 232 to 238. |
| R7 | Populated native records and audit show attribution on desktop and phone | PASS: tests/mcp-browser.mjs mcpBrowser, mcpAppealBrowser and mcpStoredBrowser run unconditionally through existing registrations, with assertions at 1440 and screenshots at 1440 and 390. |
| R8 | Historical rows without reliable immutable attribution are not rewritten | INSPECTED: no migration or update of historical actor names; helper operates only on current authenticated actors. Revocation retention is exercised through public reads. |

## Full acceptance sentence mapping

| Acceptance point | Claim and evidence |
| --- | --- |
| 1. Person-confirmation flags do not alter classification or decision | NOT CLAIMED. Shared Base classification and company policy integration remain held. Existing tool input validation remains intact. |
| 2. Agent or device tokens cannot approve, review or answer policy questions | PARTIAL EXISTING PROOF: API-004 attempts agent receipt approval and gets 403 without approval; DEV-012 retains its scoped refusals. Device, review and policy-question scope is not claimed. |
| 3. Form-mode elicitation accept never approves | NOT CLAIMED. Shared Base approval and elicitation integration remain held. |
| 4. Autonomous decisions, signatures and field confirmations truthfully name agent and person everywhere | NATIVE PREPARATION SLICE ONLY. Record and audit snapshots are proved; decisions, signatures, field confirmations and certificates are not implemented or claimed by this round. |
| 5. Human approval shows person as approver and agent as preparer | PROVEN for current native key-prepared receipt and appeal doors by API-004, DEV-012 and TEAM-003 journeys. Creator is deliberately different from approving person. |
| 6. Every agent act in activity and exports at 1440 and 390 has truthful attribution | NATIVE KEY SLICE PROVEN. Both native grant profiles and stored delegation are covered; record, activity, audit and actual audit CSV agree. Non-key development agents and shared identity integration remain owed. |
| 7. Outside mail and messages name agent and person as sender | NOT CLAIMED. No sender attribution change is included. Existing mail authority and provider boundaries remain owed. |

## Inherited duty mapping

| Duty | Proof or retained boundary |
| --- | --- |
| AGENT-001 and API-004 human approval, no arbitrary export, document or sending authority | PASS retained: existing API-004 registration checks catalogue omissions, native approval refusal, document denial, actual signed-in approval, request validation, replay and key expiry or revocation. |
| DEV-012 grant identity, explicit scope, current authority, templates, daily limits and kill switch | PASS retained: existing DEV-012 registration exercises HTTP and MCP, concurrent daily reservations, wrong-donor refusal, changed template, scope narrowing, independent key refusal, grant disable, key revocation and global stop. |
| Wider TEAM-001 and retained BASE-AGENT-001, 002, 003, 004, 011, 012 and 013 scopes | UNCHANGED. No broader staff authority, OAuth or Business authority is inferred from native creator provenance. |
| Historical custody, merged and erased donors, replay | PASS retained: API-004 performs merge and erasure then refuses stored preparation replay; DEV-012 refuses resources after merge and erasure. New attribution snapshots survive revocation and creator deactivation. |
| Provider qualification and outside sender identity | UNCLAIMED. Only provider network boundaries are faked. Native key ownership proves no Business sponsorship or live provider qualification. |

## DONE-RIDERS review

| Rider | Result on this candidate |
| --- | --- |
| 1 | PARTIAL for the full clause: native selected outcomes pass; the unclaimed acceptance scope above prevents DONE. |
| 2 | PASS for selected scope: real seeded records, actual native preparation and approvals, unsafe scope and revoked-key refusals, nonempty activity and actual CSV downloads. |
| 3 | CI status is recorded in CI.json. Browser proof is unconditional in existing push Verify registrations; no environment flag is required to execute it. |
| 4 | Exact candidate checks and screens are recorded in receipt.json. Relevant code and test bytes are committed on the candidate. |
| 5 | No new inheritance or acceptance rewrite is claimed. Existing native duties and wider Base holds remain named above. |
| 6 | Documented generator write and check pass; generated views are restored to main. Source Status, Gap and Evidence cells remain untouched. The optional invocation naming the newer BASE clause is unsupported by the existing legacy generator and is reported below. |
| 7 | PASS INSPECTED: acceptance text and all source contract cells are unchanged; no coverage rewrite. |
| 8 | PASS for selected scope: current authority, explicit record scope, wrong-key refusal, template and daily limits, kill and revocation paths run through HTTP and MCP. |
| 9 | PASS boundary: native creator is not Business sponsorship; no live provider, OAuth, device or sender qualification is claimed. |
| 10 | NOT APPLICABLE: this implementation adds provenance from an existing authenticated relation; it adopts no new authority or custody policy default. |
| 11 | PENDING FLEET LANDING: main equality, complete full-history publication scan with zero findings and resulting Run site belong to the guarded lander. |

## Mechanical checks and observations

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock, then check exit=0; views=node scripts/contract-docs.mjs write REPORT-004 DATA-004 MOVE-004 MOVE-010 MOVE-012, then check exit=0; ledger=none exit=0

The additional generator invocation naming BASE-AGENT-008 exits 1 with “Clause has no acceptance BASE-AGENT-008”. The existing generator reads legacy acceptance markers and does not handle this newer clause format. No contract content was edited. The exact documented invocation passes, as does the source-lock check. This is recorded as an existing tooling limitation, not repaired by editing generated views or acceptance text.

PROBE BASE-AGENT-008 native-creator: authenticated admin creates native key while supplying a different creator claim; real MCP preparation -> key ID and agent role retained, actual native creator shown, conflicting supplied claim ignored.
PROBE BASE-AGENT-008 5: real key-prepared receipt and appeal, followed by signed-in owner approval -> creator and key remain preparer provenance; Morgan Lee is the separate actual approver.
PROBE BASE-AGENT-008 6: both MCP grant profiles and stored receipt delegation -> prepared record, populated activity, audit and downloaded CSV agree on the native creator attribution at the proved native doors.
PROBE BASE-AGENT-008 custody: revoke key and deactivate creator -> stored run returns 401; retained record and filtered audit CSV keep their original attribution. Existing erased and merged preparation replays remain refused.

Pre-ready self-check: selected behaviors have public-door assertions; none of the old assertions was removed or weakened; the authority, erasure and replay paths retain their refusals. Changed screens retain existing components and readable type, with no new icon-only control or configuration surface. Added text contains no email-shaped fixture string. Required MIME values and actual file paths remain ordinary protocol and path strings. Publication scan commit=6b16ac867cd8bec68603f1b7addc7efef16b48ed complete=NOT_RUN historyScanned=NOT_RUN findings=NOT_ESTABLISHED. The cloud does not claim main equality. The guarded lander must establish both.

The initial local attempt exposed a new test's incorrect activity URL (404) and an unavailable default Playwright executable. The URL was corrected to the existing agent summary route, and Chromium was selected at the VM's installed path. Touched tests then passed, including their exact-candidate run. No CI repair round or test weakening occurred.

GAP BASE-AGENT-008: Shared Base identity and policy integration, OAuth scope and specialist roles, Business-token sponsorship, non-key Development-agent attribution, outside sender attribution, agent decisions, signatures, field confirmations and full clause acceptance remain owed. Old rows without reliable immutable creator evidence remain unpromoted. Existing account, ct, Base, device, prerequisite and gate-loop holds are unchanged.

CLAIM BASE-AGENT-008 PARTIAL points=5 tests=tests/coffer.test.mjs#API-004: MCP donor context, generated catalog documentation and preparation retain native keys and human approval; tests/coffer.test.mjs#DEV-012: named and preparation grants enforce scope, template approval, atomic limits and immediate stops through HTTP, MCP and scheduled jobs; tests/audit.test.mjs#TEAM-003: owner filters changes by person, record and action and downloads the same audit as CSV

Product custody: the named branch was pushed successfully and its advertised head matched the candidate. The first evidence publication was fetched back and all 30 then-selected file hashes and bytes matched. This final packet includes the updated CI observation and main baseline; its separate evidence commit is reported in the terminal EVIDENCE line.

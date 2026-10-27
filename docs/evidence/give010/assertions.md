# GIVE-010 public-door assertion map

The dated rulings are available in this repository: [01:50 Coffer section](ct-0150.md), [04:40 review](ct-0440.md), [05:22 fix ruling](ct-0522.md), and [DONE-RIDERS](DONE-RIDERS.md). Archived local citations have been replaced with portable repository references or labelled as historical sources; the branch label and one repository mention have been expanded into prose. The policy and acceptance paragraphs are unchanged.

All four journeys below are invoked by the existing DEV-002 registration in [tests/agent-recovery.test.mjs](../../../tests/agent-recovery.test.mjs#L204). Push Verify loads that registration with its browser flag in [verification.json](../../../verification.json#L177). No test registration was added. Each UI invocation asserts at one width; the same invocation captures the pre-closure form and end states at 1440 and 390 pixels. Stripe and mail are faked only at their network edges. Provider acceptance is not delivery proof, and no live Stripe retry or production delivery claim is made.

References used in the tables:

- N: `recoveryNoticesJourney`, [tests/recovery-notices-journey.mjs](../../../tests/recovery-notices-journey.mjs), run for monthly, quarterly and annual plans.
- U: `uncertainRecoveryJourney`, [tests/recovery-uncertainty-journey.mjs](../../../tests/recovery-uncertainty-journey.mjs).
- I: `inflightRecoveryJourney`, [tests/recovery-inflight-journey.mjs](../../../tests/recovery-inflight-journey.mjs).
- B: `investigatedRecoveryBrowser`, [tests/recovery-notices-browser.mjs](../../../tests/recovery-notices-browser.mjs).

The original retained DEV-002 target, its 23 October riders, and the complete 27 October GIVE-010 policy and additional acceptance are preserved in CONTRACT.md and ACCEPTANCE.md. The following map groups repeated sentences under their shared assertions without narrowing any duty. Mutation names resolve to the executed table below.

| Existing sentence or duty | Exact public-door assertions | Behavior mutation |
| --- | --- | --- |
| Read plan history, consent and past messages, prepare the permitted notice, follow its schedule until update, recovery or closure, and attribute the recovery step. | N 53–68, 79–103, 113, 117–122, 163–178; exact prior-message identity and facts at N 81–84. | actual-source-facts; prior-notice-context; current-selected-channel; elapsed-interval; latest-preceding-contact-attribution; hosted-handoff-is-not-update |
| Major donors and revised amounts wait for the named lead; frequency limits and stop requests hold. | N 51, 67–74, 79–90, 124–132, 171–182, 199–203. | major-prospect-changed-amount-review; notice-limit; no-silent-lead-transfer; resumed-current-account-authority |
| A current owner or admin explicitly self-designates with audit; designation never silently transfers. | N 32, 35–42, 192–203. | explicit-lead-required; no-silent-lead-transfer |
| Merge disables source permission, closes queued notices, and undo requires explicit reconfirmation. | N 143–155. | source-permission-after-merge; undo-permission-reconfirmation |
| Current account role and version are checked on approval and dispatch. | N 71–74, 192–200; U 135–141. | resumed-current-account-authority |
| Fail three plans including a major donor; send two standard notices under standing approval, hold the major notice, recover one plan and report each outcome. | N 34–59, 79–97; exact three-donor set at N 52. | standing-approval-required; automatic-standard-notices; major-prospect-changed-amount-review; latest-preceding-contact-attribution |
| A sending or uncertain submission holds later same-donor contact across invoices, plans, channels and a moved plan. | I 35–46 while the response is deferred; U 35–46 and 67–73 for uncertainty, moved plans and manual channels. | sending-donor-hold; uncertain-new-invoice-hold; moved-plan-uncertainty |
| Contact holds do not pause Stripe retries, payment reconciliation or unrelated donors. | I 48–49; U 47–60 reads provider recovery and exactly one $25 ledger gift after repeated reconciliation and a paid webhook, while the other plan stays held; U 174 excludes every financial POST. | unrelated-donor-eligibility; payment-reconciliation-during-hold; no-financial-posts |
| Current native owner and admin investigate and close the affected plan, recording plan, finding, reason, actor and time; still unknown is valid. | U 77–94 and 120–123; B 51–71 submits both native closures; U 78 refuses the member at the native form endpoint, with API refusal at U 77. | member-closure-through-both-guards; required-investigation-finding; investigation-plan-actor-time-facts; audit-plan-scope; closure-stale-version |
| Preserve the original uncertain outcome, claim and prior contact count; send no replacement. | U 88, 95–99, 148–150 compares original immutable fields, investigations and provider submission counts. | original-outcome-and-counts |
| Closure sends nothing, retries nothing and does not cancel or change the Stripe plan; no automatic retry, amount change or catch-up authority is granted. | U 88, 125, 146–150, 175; the provider edge records requests before refusing financial mutations. | no-financial-posts; original-outcome-and-counts |
| Deliberately closed plans stay stopped, including after a later donor merge, permission change, new invoice and elapsed interval. | U 160–172 explicitly merges after both closures, confirms new destination permission, fails new invoices after the full interval and reads both permanent plan closure keys. | closed-plan-custody-after-later-merge |
| Every independent blocking submission needs its own investigated closure. | U 89 and 99 preserve the second hold after the first closure and restart. | independent-second-hold |
| Other plans resume only after all investigations and under current approval, permission, consent, interval, limit, named-lead review and stops. | U 125–147 proves interval refusal, withdrawn permission, withdrawn consent, same-role account-version invalidation, then positive resumption; retained N 51–90 proves lead, interval and maximum checks. | positive-resumption; resumed-donor-permission; resumed-channel-consent; resumed-current-account-authority; notice-limit |
| A new invoice, merge, permission or policy change cannot itself clear uncertainty or reopen closed plan contact. | U 38–46, 62–73, 160–172. | uncertain-new-invoice-hold; moved-plan-uncertainty; closed-plan-custody-after-later-merge |
| Native review shows the blocking submission, plan-only closure scope and identified remaining held or eligible plans. | B 47–54, 66–86 asserts visible plan identifiers, scope, findings, preserved uncertain states and the identified Mira plan's held or accepted state. | visible-plan-identity; visible-plan-only-scope |
| Restart and archive recovery preserve unresolved and investigated custody without reviving outbound approval. | U 95–114, 148–150, 173–174 compares exact immutable originals and investigations in both fresh restores; U 104 requires disabled policy and null approval. | archive-investigation-custody |
| Each UI test asserts at one width; exact-SHA landing proof covers the clause's own screens at 1440 and 390 pixels, including the pre-closure form. | B 43–44 sets the single assertion width; B 57–62 captures the populated form before clicking; B 89–95 captures outcomes and the identified remaining plan. Push Verify enables these calls. | visible-plan-identity; visible-plan-only-scope; exact-SHA Verify event and run ID in the judge request |

The additional acceptance's seven sentences repeat the corresponding rows above: uncertain and moved-plan hold with unrelated eligibility; native owner and admin closure with member refusal and audit; unchanged original and no replacement; independent-plan resumption with a second hold and closed-plan stops; resumed permission and authority refusal; restart and archive custody; one assertion width and both recorded widths. GIVE-003 retains the receiving recovery duties verbatim in both documents and keeps its separate financial and scheduling Gaps.

## Executed mutation table

The mutations alter production behavior temporarily and run the named existing journey through its public doors in Node's test runner. Each source file is restored after the probe. The table identifies the first failed assertion; a shared HTTP assertion includes its journey call site in the captured stack. Removing the inner action authorization alone leaves the independent route authorization intact, so that isolated defense removal survives. Removing both enforcement guards fails the member refusal; the table preserves both results. No production mutation is retained.

| Mutation | Result | Failed assertion | Runtime source |
| --- | --- | --- | --- |
| standing-approval-required | KILLED | `tests/harness.mjs:48:194` | `src/coffer/agent/recovery-policy.ts` |
| explicit-lead-required | KILLED | `tests/harness.mjs:48:194` | `src/coffer/agent/recovery-policy.ts` |
| automatic-standard-notices | KILLED | `tests/recovery-notices-journey.mjs:45:10` | `src/coffer/agent/recovery-notices.ts` |
| separate-donor-permission | KILLED | `tests/recovery-notices-journey.mjs:45:10` | `src/coffer/agent/recovery-policy.ts` |
| major-prospect-changed-amount-review | KILLED | `tests/recovery-notices-journey.mjs:51:10` | `src/coffer/agent/recovery-notices.ts` |
| actual-source-facts | KILLED | `tests/recovery-notices-journey.mjs:57:10` | `src/coffer/agent/recovery-notices-rules.ts` |
| prior-notice-context | KILLED | `tests/recovery-notices-journey.mjs:81:10` | `src/coffer/agent/recovery-notices-rules.ts` |
| elapsed-interval | KILLED | `tests/recovery-notices-journey.mjs:52:10` | `src/coffer/agent/recovery-notices.ts` |
| notice-limit | KILLED | `tests/recovery-notices-journey.mjs:90:10` | `src/coffer/agent/recovery-notices.ts` |
| current-selected-channel | KILLED | `tests/recovery-notices-journey.mjs:121:10` | `src/coffer/agent/recovery-notices.ts` |
| latest-preceding-contact-attribution | KILLED | `tests/recovery-notices-journey.mjs:95:10` | `src/coffer/agent/recovery-notices.ts` |
| hosted-handoff-is-not-update | KILLED | `tests/recovery-notices-journey.mjs:113:10` | `src/coffer/agent/recovery-notices-rules.ts` |
| source-permission-after-merge | KILLED | `tests/recovery-notices-journey.mjs:143:10` | `src/coffer/donor-merge.ts` |
| no-silent-lead-transfer | KILLED | `tests/recovery-notices-journey.mjs:32:10` | `src/coffer/agent/recovery-policy.ts` |
| sending-donor-hold | KILLED | `tests/recovery-inflight-journey.mjs:43:12` | `src/coffer/agent/recovery-notices-rules.ts` |
| uncertain-new-invoice-hold | KILLED | `tests/recovery-uncertainty-journey.mjs:40:10` | `src/coffer/agent/recovery-notices-rules.ts` |
| unrelated-donor-eligibility | KILLED | `tests/recovery-uncertainty-journey.mjs:36:10` | `src/coffer/agent/recovery-notices-rules.ts` |
| moved-plan-uncertainty | KILLED | `tests/recovery-uncertainty-journey.mjs:45:10` | `src/coffer/agent/recovery-notices-rules.ts` |
| payment-reconciliation-during-hold | KILLED | `tests/recovery-uncertainty-journey.mjs:55:10` | `src/coffer/agent/recovery.ts` |
| member-closure-refused | SURVIVED | `Route guard still enforces the same refusal` | `src/coffer/agent/recovery-policy.ts` |
| member-closure-through-both-guards | KILLED | `tests/harness.mjs:48:194` | `src/coffer/agent/recovery-policy.ts` |
| required-investigation-finding | KILLED | `tests/harness.mjs:48:194` | `src/coffer/agent/recovery-policy.ts` |
| investigation-plan-actor-time-facts | KILLED | `tests/recovery-uncertainty-journey.mjs:91:10` | `src/coffer/agent/recovery-policy.ts` |
| audit-plan-scope | KILLED | `tests/recovery-uncertainty-journey.mjs:94:10` | `src/coffer/agent/recovery-policy.ts` |
| original-outcome-and-counts | KILLED | `tests/recovery-uncertainty-journey.mjs:96:148` | `src/coffer/agent/recovery-policy.ts` |
| independent-second-hold | KILLED | `tests/recovery-uncertainty-journey.mjs:88:10` | `src/coffer/agent/recovery-notices-rules.ts` |
| positive-resumption | KILLED | `tests/recovery-uncertainty-journey.mjs:126:10` | `src/coffer/agent/recovery-notices-rules.ts` |
| closed-plan-custody-after-later-merge | KILLED | `tests/recovery-uncertainty-journey.mjs:169:10` | `src/coffer/donor-merge.ts` |
| visible-plan-identity | KILLED | `tests/recovery-notices-browser.mjs:49:11` | `src/coffer/agent/recovery-ui.ts` |
| visible-plan-only-scope | KILLED | `tests/recovery-notices-browser.mjs:54:11` | `src/coffer/agent/recovery-ui.ts` |
| resumed-donor-permission | KILLED | `tests/recovery-uncertainty-journey.mjs:130:10` | `src/coffer/agent/recovery-policy.ts` |
| resumed-channel-consent | KILLED | `tests/recovery-uncertainty-journey.mjs:133:10` | `src/coffer/agent/recovery-notices-rules.ts` |
| resumed-current-account-authority | KILLED | `tests/recovery-uncertainty-journey.mjs:141:10` | `src/coffer/agent/recovery-notices-rules.ts` |
| closure-stale-version | KILLED | `tests/harness.mjs:48:194` | `src/coffer/agent/recovery-policy.ts` |
| archive-investigation-custody | KILLED | `tests/recovery-uncertainty-journey.mjs:96:255` | `src/coffer/archive-policy.mjs` |
| no-financial-posts | KILLED | `tests/recovery-uncertainty-journey.mjs:174:10` | `src/coffer/agent/recovery.ts` |
| undo-permission-reconfirmation | KILLED | `tests/recovery-notices-journey.mjs:147:10` | `src/coffer/merge-journal.ts` |

The exact substitutions and exits are in [mutations.json](mutations.json). There are 36 killed behavior-changing mutations and one surviving isolated removal protected by a second guard. The unmodified DEV-002 registration passed both without browser capture and with browser capture. The latter recorded the populated owner and admin investigation forms before closure, original uncertain outcomes, the remaining held plan, positive resumption, and both archive states at 1440 and 390 pixels. All controls in this recovery screen have visible text labels; no icon-only action was introduced.

These probes ran against the same recovery runtime and journey bytes as the candidate. Subsequent GIVE-010 edits are confined to clause status, counts, provenance, this evidence, and its source lock. Concurrent main work is retained; its changes do not alter these recovery runtime and journey bytes. Exact candidate SHA, full-history scan fields, main equality, Verify event and Run site run IDs are supplied inline in the fresh judge request after the landing gates, avoiding a circular commit hash inside its own committed document. Earlier judgments and workflow runs in the archived rulings are historical, not claimed as execution of this candidate.

# sx-coffer-f174fix1 — PAY-006 blocking FIX round

Repository: just-every/run-coffer.
Product branch: cloud/sx-coffer-f174fix1.
Product head: 47d268f79a32c00016d076f6333f905cf9d6b489.
Start: ef73001250888e694b3fc9106270ef353d89ed5d.
Merged main: 73ba072 (already an ancestor, checked again after the save push).
PR: none; the fleet lander owns landing. Main was never pushed.

## Plan and scope

The complete plan is PLAN.md. This round fixes only the three blocking findings carried from sx-coffer-c-f174-gate-1. It retains every existing test assertion and the partial Shopify capability boundary. No contract Status, Gap or Evidence cell changed. There is no UI change, provider write, publication scan, held-key use, or live-provider qualification claim.

1. Reproduce each blocking delivery order on the original source through native signed webhooks and authenticated public routes.
2. Scope resolved Shopify source erasure to its selected donor; remove an erased alternative candidate reference without erasing another donor's refund evidence.
3. Retain the customer identity hash when the paid-order observation follows a refund, allowing subsequent donor erasure to tombstone that customer even after an email change.
4. Reserve the exact verified linked Stripe charge atomically with the signed paid-order observation, before human review or fee allocation. Keep the generic recorder's atomic reservation checks. Refund observations persist their hold independently of provider reads; stricter classification, refund and fee qualification still occurs at review/approval.
5. Extend only tests/shop-orders-journey.mjs, adding one regression assertion per item under its existing PAY-006 registration. Retain the existing race assertion by starting the generic request before the Shopify reservation is committed, which preserves the intended concurrent-recording scenario.
6. Generate/check contract views, restore ACCEPTANCE.md and docs/CLAIMS.md from main, regenerate/check the source lock last, commit, audit all candidate identities/trailers, push only the named product branch, and inspect exact-SHA Verify via the bounded REST watcher.
7. Publish this explicitly selected non-secret packet separately on evidence/sx-coffer-f174fix1. Product custody and report transfer remain separate.

## Before and after

| Blocking case | Original source | Fixed source |
|---|---|---|
| Erase an unselected shared-email candidate after another donor's contribution approval, then fully refund | HTTP 409; $25 remains credited | HTTP 200; lifetime credit $0 |
| Refund first, then paid delivery, donor erasure, same customer changes email | New order retains private source and facts in held state | New order erased; source null and facts empty |
| Linked Stripe webhook after Shopify observation and before human review | One $74.20 whole-order gift | No gift and $0 credited |

before-regressions.txt contains the three actual failing assertions from the original SHA. after-regressions.txt contains the focused passing runs. final-shop-journey.txt proves the final committed source through the complete existing Shopify journey and all three added cases. No existing assertion was removed or weakened. No test registration was added: one existing registration gained three assertions. The separate focus selector is for before/after receipts; the normal PAY-006 registration runs its original flow and all three regressions.

## Local validation

- Node 22.20.0, repository pnpm pin 10.12.4; system Chromium /usr/bin/chromium with --no-sandbox.
- Initial touched run: node --test --test-name-pattern='PAY-006|PAY-001:' tests/payments.test.mjs — 2 passed, 0 failed. This includes the shared donor-review erasure path and the original Shopify browser flow.
- Final source run: node --test --test-name-pattern='PAY-006:' tests/payments.test.mjs — 1 passed, 0 failed, including all three regressions.
- pnpm typecheck — passed.
- node scripts/contract-docs.mjs write/check REPORT-004 DATA-004 MOVE-004 MOVE-010 MOVE-012 PAY-006 — passed. Generated view files were restored from main and neither was committed.
- node scripts/edition-authoring/cli.mjs lock/check — passed; lock regenerated after the final source edit.
- git diff --check — passed. All candidate authors/committers are Run Edit Run fleet <fleet@runeditrun.com>; candidate trailers absent.
- The first standalone probe used Node's --input-type=module stdin mode and stalled the synchronous Miniflare binding worker. Only owned processes were stopped. Actual receipts were collected using normal .mjs entrypoints and the repository's exact Node runtime; no product/harness workaround was committed.

The public-door tests fake only provider network boundaries; there are no live Shopify or Stripe provider credentials or provider acceptance receipts. No full local suite or publication scan ran, as assigned.

## Contract and existing capability boundary

The original builder claim below is preserved verbatim from its published builder report on evidence/sx-coffer-c-f174; no independent gate material was accessed.

Before/after contract summary: 96 done, 37 partial, 20 missing, 153 total. Published: 9 done of 9. Target/push-further: 87 done, 37 partial, 20 missing of 144. PAY-006 remains missing in the source status table; the builder's Shopify slice remains a partial capability claim, with no promotion requested in this FIX round.

Stall, round-ups, charity-priced items, fee cover, partial refunds, order edits, other currencies/gateways and linked-gateway refund qualification remain outside the existing slice. RER Managed availability and live provider qualification remain unclaimed. These are unchanged capability gaps, not new work in this blocking-only FIX round.

CLAIM PAY-006 PARTIAL points=none tests=tests/shop-orders-journey.mjs#shopOrdersJourney; tests/shop-orders-browser.mjs#shopOrdersBrowser
GAP PAY-006: Existing Shopify-only partial slice and provider-qualification gaps remain unchanged; this round fixes only the three named blockers.

## Product custody and CI

Save e895dcba4e6a33246af7f828dbf28349c8c4e107 pushed successfully with [skip ci]. Final candidate 47d268f79a32c00016d076f6333f905cf9d6b489 pushed successfully. Both product pushes used cloud-push.py and succeeded on their first attempt. No force push, main push, published-history rewrite or PR was used.

Exact-SHA Verify: run 42517036282, https://github.com/just-every/run-coffer/actions/runs/42517036282, completed SUCCESS on 47d268f79a32c00016d076f6333f905cf9d6b489 at 2026-11-08T20:04:16Z. The watcher made four REST calls total, at least 300 seconds apart, including discovery. No failed-job log reads, reruns or dispatches were needed. ci-status.json is the terminal actual receipt; ci-discovery.json and ci-call-2.json through ci-call-4.json retain all observations.

## Terminal result

All three named blockers have passing before/after regression proof. Local touched tests, typecheck, contract generation/check, source-lock check and exact-SHA Verify pass. There are no remaining blockers for this FIX candidate. The independent gate and landing remain fleet work; no acceptance or main landing is claimed.

The explicitly selected packet is returned separately through refs/heads/evidence/sx-coffer-f174fix1. Report transport does not change product custody, checkout, index or head.

READY branch=cloud/sx-coffer-f174fix1 head=47d268f79a32c00016d076f6333f905cf9d6b489

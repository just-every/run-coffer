# sx-coffer-f174fix2

Repository: just-every/run-coffer. Product branch: cloud/sx-coffer-f174fix2.
Scope: the one BLOCKING B money regression from f174fix1; no additional feature work.

The existing Stripe charge is now found before applying a later Shopify reservation. Balance entries defer to that saved charge before treating a reservation as a reason to skip an entry. New generic whole-order Stripe gifts remain blocked after Shopify observation, including the existing atomic guard against in-flight recording. The reservation and conflicting prior-custody hold remain intact.

The single new regression assertion is folded into tests/shop-orders-journey.mjs, under the existing PAY-006 registration in tests/payments.test.mjs. It exercises the real signed webhook doors: Stripe charge first, Shopify paid observation, Shopify full refund, Stripe full-refund event. Identical probe before the fix: credited 7,420 cents before and 7,420 after, failing the expected zero. After the fix: 7,420 cents before and zero after, passing. No existing assertion was removed, weakened or skipped.

The previous three rows remain in the same journey: erasure of an unselected shared-email candidate must preserve the chosen donor's full contribution refund; refund-first/paid-later customer custody must survive erasure and changed-email redelivery; Shopify observation before review must prevent a linked Stripe payment from crediting the whole merchandise order. The broader payment file also covers staff refunds, disputes, won disputes, notices, immutable originals, receipt correction, fee/payout reconciliation, donor selection, provider races and archive/restore.

An initial diagnostic command using --input-type=module stalled Miniflare's synchronous RPC worker, before exercising the product. The corrected dynamic-import command runs under the pinned Node 22.20.0. Only owned process PIDs were stopped; no harness or dependency source was changed.

Main integration: full-history start at 47d268f79a32c00016d076f6333f905cf9d6b489, merged origin/main (73ba072819742dc675195fa3f9c5f772d49fecf0): already up to date. CONTRACT.md, ACCEPTANCE.md, docs/CLAIMS.md and docs/contract/ID-MAP.json have no diff against main. The ID map is absent on this main and candidate. Main's highest migration is 0191; inherited candidate migrations 0192, 0193 and 0194 are already above it. This FIX adds no migration or migration reference. Source lock was regenerated last with node scripts/edition-authoring/cli.mjs lock and its check passed. No contract generator output is committed. No publication scan ran, as this FIX brief expressly forbids one.

Counts: contract done/partial/missing 96/37/20 before and after (153 total); PAY-006 stays missing in CONTRACT.md, and no Status, Gap or Evidence cell changes. Existing payments registrations 7 before and 7 after; delivery-order cases 3 before and 4 after. This FIX adds one assertion and no test registration. No clause promotion is claimed; independent gate and lander own judgments.

Validation and product/CI/evidence custody are recorded in receipt.json, ci-receipt.json and the selected actual logs. The full task plan is PLAN.md. Provider proof uses network-edge fakes and establishes Coffer behavior, without claiming live provider acceptance. There are no UI changes. The existing browser assertions run at their original width using /usr/bin/chromium.

CLAIM PAY-006 PARTIAL points=none tests=tests/payments.test.mjs#PAY-006: signed Shopify orders hold exact donation classification, actual fee allocation and current donor authority, then record and fully reverse only the contribution once
DEFAULT PAY-006: Retain the original Stripe gift and process its full refund when Stripe recorded it before Shopify observation; keep shop review blocked by conflicting prior custody.
GAP PAY-006: This limited FIX does not discharge the clause's other pre-existing obligations; contract judgments remain with the independent gate and lander.

Product commit: 170ee80d652dd51f2b415ed58d17816ea1fd2cbc. Product push succeeded on the first guard attempt. Local validation: 7/7 payment tests passed, zero failed/skipped; duration 394,301.794315 ms. The focused after probe, typecheck and source-lock check passed. The single CI watcher looks only for Verify on this exact SHA, with at most one request per 300 seconds. No PR was created; this repository has branch-push Verify and fleet landing.

Final CI: Verify run 42527867739 completed/success on exact head 170ee80d652dd51f2b415ed58d17816ea1fd2cbc: https://github.com/just-every/run-coffer/actions/runs/42527867739. Five GitHub REST calls total, with one watcher and at least 300 seconds between requests. No failed-job log calls, workflow reruns, dispatches, PR or main/default-branch pushes. Builder candidate is READY; the independent gate and fleet landing are separate and have not been claimed. No blockers remain.

The complete selected plan, report, receipts and logs are published only on refs/heads/evidence/sx-coffer-f174fix2. All product work is pushed; clone cleanup follows evidence publication as required by builder rules.

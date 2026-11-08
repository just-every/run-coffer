# sx-coffer-f174fix2 plan

Scope: BLOCKING B only, Stripe-first full-refund reversal. Retain the three f174fix1 rows and existing assertions. No contract status, gap or evidence changes, no publication scan, no UI changes.

1. Clone full history, start at f174fix1 47d268f79a32c00016d076f6333f905cf9d6b489, merge current main retaining its contract and generated views and ID map. Confirm candidate migrations are above main's maximum.
2. Extend the existing shop-order public-door journey with one assertion: signed Stripe charge first, signed Shopify observation and full refund next, then signed Stripe refund; credited total must fall from 7,420 to 0 cents. Run the same probe before and after the fix.
3. Preserve saved Stripe charge custody ahead of shop reservations in charge and balance-entry synchronization, while retaining reservation refusal for new whole-order Stripe gifts.
4. Regenerate the source lock last; commit product changes with fleet identity and hooks. Publish first real commit using the fleet guard after inspecting all candidate identities and trailers.
5. Run touched payments regression file (including previous three rows), typecheck and source-lock check. Require exact-SHA Verify via bounded REST polling; repair in scope if needed without rewriting published history.
6. Save actual non-secret reports and receipts outside the product clone, publish the complete selected packet to evidence/sx-coffer-f174fix2, and return product custody plus lane POST and claim lines. The fleet arms the independent gate.

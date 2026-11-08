# Reviewed Shopify contribution orders

This native slice receives a signed one-time USD paid order and a full refund.
It supports an explicit donation line and merchandise; it creates no giving
form, consent, automatic receipt, refund request or background schedule.
Stall, round-ups, charity-priced items, fee cover, partial refunds, order edits,
other currencies and other gateways remain held. Network fixtures establish no
live Shopify qualification, tenant authority or RER Managed availability.

The installation owner privately configures `SHOPIFY_SHOP_DOMAIN`,
`SHOPIFY_SHOP_ID`, `SHOPIFY_ACCESS_TOKEN` and `SHOPIFY_WEBHOOK_SECRET`.
Use the original canonical myshopify domain and shop ID. Credentials never enter
product tables, exports or archives. Configure the provider's paid-order and
refund-created subscriptions explicitly; Coffer does not register them.
The webhook address is `/api/coffer/shops/shopify/webhook`.

## Provider contracts

- [Shopify HTTPS webhook verification](https://shopify.dev/docs/apps/build/webhooks/subscribe/https):
  verify the base64 `X-Shopify-Hmac-Sha256` with HMAC SHA-256 over the original
  request bytes before decoding JSON. Bind `X-Shopify-Shop-Domain` to the exact
  configured shop and retain the event identity from `X-Shopify-Event-Id`.
  Supported topics denote paid orders and created refunds.
- [Shop resource](https://shopify.dev/docs/api/admin-rest/2026-10/resources/shop):
  read the current shop's `id` and `myshopify_domain` before review. No credential
  may redirect to a different host.
- [Order resource](https://shopify.dev/docs/api/admin-rest/2026-10/resources/order):
  read `/admin/api/2026-10/orders/{order_id}.json`. Freeze the original order ID,
  paid date, email, currency, line IDs, quantities, prices, discounts, taxes,
  properties, shipping and total. Current source facts must equal the signed
  paid-order snapshot. A refund changes financial status, not original prices.
- [Order Transaction resource](https://shopify.dev/docs/api/admin-rest/2026-10/resources/transaction):
  read `/admin/api/2026-10/orders/{order_id}/transactions.json`. Require one
  successful sale or capture for the full order. Full refunds need one successful
  refund of that exact amount and a matching parent payment. Uncertain history,
  unsupported kinds and partial or conflicting refunds stay held.
- [Shopify Payments balance transactions](https://shopify.dev/docs/api/admin-rest/2026-10/resources/transactions):
  exhaust `/admin/api/2026-10/shopify_payments/balance/transactions.json` with
  documented Link pagination, bounded at twenty pages. Match exact
  `source_order_transaction_id` and `source_order_id`, source type, USD amount,
  actual `fee`, `net`, `payout_id` and paid payout status. Missing or ambiguous
  settlement evidence holds money. No undocumented upstream endpoint is used.

REST is Shopify's documented legacy Admin API, pinned here to 2026-10. This
implementation is for an existing installation with appropriate read access;
it does not promise new public-app admission. Access restrictions remain real
provider qualification work.

## Classification and approval

`_coffer_kind`, `_coffer_fund` and `_coffer_campaign` are explicit installation
source properties, not Shopify-defined donation semantics. An upstream shop
must deliberately supply them. A reviewer confirms them against the real sale;
an item name never establishes a donation. Every other supported line must
explicitly be merchandise. Missing or conflicting provenance stays held.
The single donation line has quantity one, positive price, no discount and no
tax. Source campaign must identify an existing campaign on the chosen fund or
explicitly state `none`. Existing recorded facts cannot be reclassified.

Use Shop orders from the Payments donor-review queue. Review every source line,
fund and campaign, actual fee evidence and an explanation of the exact
contribution and noncontribution fee allocation. Neither allocation is described
as a provider-reported donation fee. Both must sum to the actual order fee.
Then select the current version of an existing canonical donor through the
shared queue; no shared email is resolved automatically. A separate current
owner or admin approves that exact version and fingerprint before money. Donor,
operator and source changes invalidate stale decisions. Restored evidence cannot
reuse another installation's approval.

For a $40 item, $6 shipping, $3.20 tax and $25 donation, the gift and contribution
receipt are $25. Excluded sale proceeds are $49.20. An actual $2.50 order fee may
have a separately reviewed $1 contribution allocation and $1.50 noncontribution
allocation: contribution net $24 plus noncontribution net $47.70 equals order
net $71.70. The contribution subset is never inserted as the whole shop payout.
The fee report labels these allocations and keeps their absent giving-form
provenance explicit. Actual fees never reduce the contribution receipt.

## Refunds and processor custody

A signed refund observation first persists a hold independently of later reads and voids existing receipts. A provider read that still shows the paid order cannot clear it. New receipts and corrected replacements remain blocked while the refund or a source conflict is unresolved. Refresh current complete
provider facts, review the actual refund fee and both signed allocations, then
approve the exact full contribution reversal. This appends one reversal and
voids existing receipts using native correction rules. A fully reversed receipt
cannot be reissued. A refund observed before donor selection also stays held;
separate full-refund approval records the original and its reversal atomically.
The original gift is never rewritten, and no receipt is sent automatically.

An optional linked Stripe gateway requires an explicit `SHOPIFY_STRIPE_ACCOUNT`
and the Order Transaction's gateway-specific `authorization` identifying a
charge. Only the `stripe` gateway and an exact current Stripe account, successful
charge amount, currency and actual available balance fee are supported. Do not
assume a Shopify Payments authorization is a Stripe charge. Review reserves
that exact charge before generic Stripe recording can handle it. Shared,
unsupported or conflicting prior imports remain held; they do not rewrite
historical gifts or suppress unrelated charges. Linked-gateway refunds remain
unsupported and held. No metadata guess claims ownership of an entire account.

Signed observation hashes, private order, payment, line and refund references and candidate
identities are reviewer-private. Portable archives keep this evidence with its
installation binding. Donor-request files omit it. Erasure scrubs retained source facts
and review evidence, retaining opaque replay and source-identity tombstones and
anonymous ledger amounts. A changed email for the same erased shop customer
cannot recreate that identity.

Observations retain the original byte digest and allowlisted source facts. Provider session tokens, customer blobs, order-status capabilities and unrelated gateway response fields are never retained.

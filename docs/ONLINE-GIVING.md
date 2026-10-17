# Online and monthly giving

On a self-hosted install, set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as Worker secrets. Use a Stripe test secret key while testing. Keep the install's mail provider, `MAIL_FROM` and `MAIL_API_KEY` configured for donor links. These credentials never enter browser code or exports.

An owner or admin opens **Giving**, publishes a campaign with its own page address, story, fund and goal, and shares `/give/<address>`. Donors choose once or monthly and continue to Stripe Checkout for card or Link. Apple Pay appears in Stripe Checkout on eligible devices; register your install's domain under Stripe payment method domains. US bank giving is coming soon. Coffer does not store payment card numbers.

Create a Stripe webhook endpoint at `https://<your-install>/api/coffer/giving/webhook`, with API version `2026-09-30.endive`, for:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`
- `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.updated`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`

Save the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`. Without that secret, webhook requests are refused. Coffer verifies the raw signature, retrieves current provider state, matches the donor by email and writes each successful gift once to the immutable ledger with its campaign and fund. The return page also reconciles a completed checkout. A failed payment never counts as money raised.

Monthly plans run as Stripe subscriptions. Configure your account's Billing revenue recovery retry schedule in Stripe. Coffer follows that schedule and records failures, next attempt and successful recovery from verified events. It emails the donor a private card update link after a failed attempt; a failed email delivery leaves the webhook unacknowledged so Stripe can redeliver it. Notices are transactional, independent of appeal consent. Expiry warnings and staff escalation after retries run out are not implemented.

Donors open **Manage my monthly gift**, request an emailed link and confirm it to see only their own plans. Links expire after 30 minutes and work once; sessions last one hour. Card updates take place in Stripe Billing Portal. Cancellation stops future installments at the end of the current billing period. Donations already received remain in the ledger. Development and demo mode do not send email or create a local inbox.

RER Managed does not yet have the integration egress relay. Any Stripe operation on a managed install says that Stripe is not available yet. Use a self-hosted install for giving today.

The target contract also calls for advanced form fields, embedding, donor walls, campaign closing dates, additional recurring frequencies, ACH/PayPal and broader donor self-service. Those remain partial or missing in `CONTRACT.md`.

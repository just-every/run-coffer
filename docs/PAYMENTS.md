# Stripe payments and payout accounting

Self-hosted Coffer accepts signed Stripe events at `POST /api/coffer/giving/webhook`.
Keep `STRIPE_SECRET_KEY` and the endpoint's `STRIPE_WEBHOOK_SECRET` in the installation's private runtime settings. Register charge succeeded/updated/refunded/failed, refund created/updated/failed, charge dispute events, payment_intent.payment_failed, and payout events in Stripe. Keep the existing Checkout, invoice and subscription events enabled for online giving. Stripe sends retries on a failed response; Coffer checks the unmodified body, a five-minute timestamp tolerance and every v1 signature during secret rotation.

Event IDs, charge references and balance transaction IDs prevent duplicate money entries across retries, out-of-order delivery, payout refreshes, Coffer Checkout returns and saved-page move-in. Events read current provider state. Successful external charges match a donor by Stripe customer or email; a payment with neither is refused until its donor email is supplied in Stripe. No marketing consent is inferred. Fees never reduce the donor's contribution. Refunds, dispute withdrawals and wins append processor adjustments; neither the original gift nor an earlier payout is edited. Donor and campaign totals include contribution adjustments. Saved-page move-in already netted historical refunds; those are retained as originals and not deducted twice. A corrected receipt remains a separate unfinished contract item.

The payments ledger and Pantry books currently require USD. A non-USD balance transaction is refused rather than treating another currency as dollars. The supplied fleet test account is AU and settles AUD; `STRIPE_US_TEST_SECRET_KEY` was unavailable on 17 October. The core-flow test proves Coffer's Stripe boundary with synthetic USD responses. A separate live check posts those synthetic payout records through the public API of a local Pantry started with `rer dev`, confirms its bank debit and fund credits, and refreshes the approved journal in Coffer. A USD-settling test account is still needed for a real Stripe USD payout-to-Pantry acceptance.

## Reconcile a payout

Open **Payouts** and sync all payouts or a specific Stripe payout ID. Automatic payouts read every page of Stripe's payout-filtered balance transactions. A manual payout has no processor-defined membership: paste the exact available balance transaction IDs from your Stripe records and confirm the selection. Coffer checks that the transactions existed and were available at payout creation, belong to no other payout and sum to the payout amount. It never assigns by date or amount alone.

Open the payout to see each gift, refund, dispute, fee, fund split, match difference and accounting destination. Unmatched, non-paid or incomplete payouts cannot be posted or exported as journals. Unsupported processor adjustments remain separately named and require an explicit account mapping. Refreshing cannot change immutable money or the membership of a submitted journal.

## Post into Pantry

Run Pantry using `rer dev just-every/run-pantry`, or `rer dev` from a Pantry checkout. In Pantry, start the chart, create a bank account, a fee expense account and an income account for each fund. Create a Pantry agent key. Configure Coffer's private settings:

- `PANTRY_ORIGIN`: Pantry's bare HTTPS origin; HTTP is allowed only for loopback development.
- `PANTRY_AGENT_TOKEN`: the key shown once by Pantry.
- `PANTRY_DEPOSIT_ACCOUNT`: the bank ledger account ID.
- `PANTRY_FEE_ACCOUNT`: the processing-fee expense account ID.
- `PANTRY_FUND_ACCOUNTS`: JSON mapping each Coffer fund name to its Pantry income account ID.

In `.dev.vars`, keep JSON literal with single quotes, for example `PANTRY_FUND_ACCOUNTS='{"Reading":"reading-account-id","Meals":"meals-account-id"}'`. In a `rer deploy --env-file` input, write the JSON unquoted after `=` instead. Use the same format for `QBO_ACCOUNT_NAMES`.

For each payout, download **evidence CSV**, upload the unmodified file in Pantry Documents and paste its document ID into Coffer. Coffer checks the source file's SHA-256 against Pantry, checks current active account revisions and submits one balanced journal proposal: bank net debit, fee debit and income credits split by fund, with refunds reducing their fund. Pantry retains the evidence and source passages.

Approve the proposal in Pantry to post the deposit. Back in Coffer, choose **Refresh Pantry posting** to record its posted journal ID. A pending proposal is labelled awaiting approval, never posted. Interrupted submissions retain their claim; refresh recovers by proposal ID or verified marker and payload hash. An uncertain result is never automatically resent. Rejected or stale proposals stay visible for reconciliation in Pantry. A revoked Coffer session is checked again inside each write transaction.

## QuickBooks exports

Set `QBO_ACCOUNT_NAMES` to JSON mapping the same mapped account IDs to exact QuickBooks account names (including parent names for subaccounts). Download the payout's journal CSV, then use QuickBooks Online **Settings → Import data → Journal entries** and map its debit, credit, account and class columns. Fund names become classes; configure class tracking in QuickBooks if used. Keep its duplicate journal-number warning enabled and reconcile the deterministic compact `CF-…` journal reference (the full payout ID stays in each line description). A file download does not establish that QuickBooks imported it. The separate IIF file targets QuickBooks Desktop, which accepts IIF; it is not a QBO API connection.

[QuickBooks document-number limits](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/0b5f8961-f32e-e396-3a39-7b3e241434e8.htm), [QuickBooks journal CSV instructions](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US), [Stripe payout membership](https://docs.stripe.com/api/balance_transactions/list).

On RER Managed, provider calls show one plain line: **Stripe and Pantry are not available yet on RER Managed.** No Stripe or Pantry request is sent. Existing records and local file exports remain available. Self-hosted installations use their own provider connections.

# Stripe payments and payout accounting

Payouts use the same Stripe connection as online giving. Open **Giving → Connect Stripe** in Coffer: it explains each step, and its webhook includes the charge, refund, dispute and payout events this page relies on (the full list is in [Online and monthly giving](/docs/online-giving#webhook-events)). Stripe retries a message Coffer did not accept; Coffer checks the unmodified message, a five-minute timestamp tolerance and every signature during a secret change.

Event IDs, charge references and balance transaction IDs prevent duplicate money entries across retries, out-of-order delivery, payout refreshes, Coffer Checkout returns and saved-page move-in. Events read current provider state. Successful external charges match a donor by Stripe customer or email; a payment with neither is refused until its donor email is supplied in Stripe. No marketing consent is inferred. Fees never reduce the donor's contribution. Refunds, dispute withdrawals and wins append processor adjustments; neither the original gift nor an earlier payout is edited. Donor and campaign totals include contribution adjustments. Saved-page move-in already netted historical refunds; those are retained as originals and not deducted twice. Affected receipts are voided; prepare a corrected replacement for the remaining gift from Letters and approve it before sending.

The payments ledger and Pantry books use US dollars. A Stripe account that settles in another currency still takes USD gifts, but its payouts arrive in that currency: Coffer refuses a non-USD balance transaction rather than treating another currency as dollars, so payout reconciliation needs a USD-settling Stripe account.

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
- `PANTRY_FUND_CLASSES`: optional JSON mapping of funds to Pantry class names; the fund name is the default class.
- `PANTRY_FUND_LOCATIONS`: optional JSON mapping of funds to Pantry location names.

In `.dev.vars`, keep JSON literal with single quotes, for example `PANTRY_FUND_ACCOUNTS='{"Reading":"reading-account-id","Meals":"meals-account-id"}'`. In a `rer deploy --env-file` input, write the JSON unquoted after `=` instead. Use the same format for `QBO_ACCOUNT_NAMES`.

For each payout, download **evidence CSV**, upload the unmodified file in Pantry Documents and paste its document ID into Coffer. Coffer requires a bank asset for the deposit, an expense account for fees and income accounts for funds. It checks the source file's SHA-256 against Pantry, checks current active account revisions and submits one balanced journal proposal: bank net debit, fee debit and income credits split by fund, with refunds reducing their fund. Pantry retains the evidence and source passages.

Approve the proposal in Pantry to post the deposit. Back in Coffer, choose **Refresh Pantry posting** to record its posted journal ID. A pending proposal is labelled awaiting approval, never posted. Interrupted submissions retain their claim; refresh recovers by proposal ID or verified marker and payload hash. An uncertain result is never automatically resent. Rejected or stale proposals stay visible for reconciliation in Pantry. A revoked Coffer session is checked again inside each write transaction.

## Post a check batch

In **Gifts → Batches**, enter each check with its fund; the batch fund supplies the default. A campaign batch retains its campaign’s fund requirement. Close the batch once the entered gifts equal the deposit total, then open **Pantry accounting** on the closed batch. Download its evidence CSV, upload the exact file in Pantry Documents, and submit its document ID for approval. The proposal debits the bank for the deposit and credits the mapped income accounts with each fund’s class and optional location. Checks retain their references in the evidence; there is no processor fee on an offline deposit.

Approve and post in Pantry, then choose **Refresh Pantry posting** in Coffer. Proposed or uncertain submissions do not count as posted accounting. The reconciliation report includes the batch by its received date and each gift’s fund, and removes its unposted difference only after the journal ID is confirmed. A saved submission survives export and restore and is refreshed without another proposal.

## QuickBooks exports

Set `QBO_ACCOUNT_NAMES` to JSON mapping the same mapped account IDs to exact QuickBooks account names (including parent names for subaccounts). Download the payout's journal CSV, then use QuickBooks Online **Settings → Import data → Journal entries** and map its debit, credit, account and class columns. Fund names become classes; configure class tracking in QuickBooks if used. Keep its duplicate journal-number warning enabled and reconcile the deterministic compact `CF-…` journal reference (the full payout ID stays in each line description). A file download does not establish that QuickBooks imported it. The separate IIF file targets QuickBooks Desktop, which accepts IIF; it is not a QBO API connection.

[QuickBooks document-number limits](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/0b5f8961-f32e-e396-3a39-7b3e241434e8.htm), [QuickBooks journal CSV instructions](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US), [Stripe payout membership](https://docs.stripe.com/api/balance_transactions/list).

On RER Managed, provider calls show one plain line: **Stripe and Pantry are not available yet on RER Managed.** No Stripe or Pantry request is sent. Existing records and local file exports remain available. Self-hosted installations use their own provider connections.

## Period journals (FIN-004)

In **Payouts → Journal for a period**, choose inclusive From and To arrival dates and CSV or QuickBooks Desktop IIF. The file includes every recorded payout in that period, independently of the latest 100 shown in the list. Each payout keeps its own balanced journal and deterministic reference, with the same account and fund-class mapping as its individual export. A payout that is not paid, fully matched or correctly mapped refuses the download; resolve it before closing the period. An empty period downloads headers only.

The authenticated HTTP door is `/api/coffer/payments/journal?from=2026-10-01&to=2026-10-31&format=csv` (or `format=iif`). These journal files can be mapped into other ledgers such as Xero, Aplos and Sage Intacct; confirm that ledger’s import-column mapping before importing. Check batches are not implemented yet (GIFT-002/FIN-001).

## Refunds and disputes (PAY-003)

In **Payouts → Refunds and disputes**, an owner or admin enters an exact USD amount against a recorded Stripe gift. The form freezes the remaining contribution. A saved attempt identity prevents a repeated submission from making another refund. Pending refunds wait for Stripe; failed refunds leave the gift unchanged. An uncertain answer blocks a new refund for that charge: check Stripe, then let its signed refund event reconcile the saved attempt. Do not create a new attempt to retry an uncertain charge.

Refunds, dispute withdrawals and reinstatements each retain one relationship-manager notice attempt, routed as donor replies are (portfolio manager, opportunity owner, then owner). SendGrid acceptance is **submitted**, not delivery. Unavailable or uncertain notices need human review and are not automatically sent again. Disputes show Stripe's current status, exact UTC evidence deadline and evidence flags, with a link to review and submit evidence in Stripe. The ledger, original receipts and new corrected copies retain their separate identities.

[Stripe refund creation](https://docs.stripe.com/api/refunds/create) and [dispute status/evidence fields](https://docs.stripe.com/api/disputes/object) define the provider boundary. The automated journey uses documented synthetic Stripe and SendGrid edges; it does not claim a live account refund or notice delivery.

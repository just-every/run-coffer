# Stripe payments and payout accounting

Payouts use the same Stripe connection as online giving. Open **Giving → Connect Stripe** in Coffer: it explains each step, and its webhook includes the charge, refund, dispute and payout events this page relies on (the full list is in [Online and monthly giving](/docs/online-giving#webhook-events)). Stripe retries a message Coffer did not accept; Coffer checks the unmodified message, a five-minute timestamp tolerance and every signature during a secret change.

Event IDs, charge references and balance transaction IDs prevent duplicate money entries across retries, out-of-order delivery, payout refreshes, Coffer Checkout returns and saved-page move-in. Events read current provider state. Successful external charges match a donor by Stripe customer or email; a payment with neither is refused until its donor email is supplied in Stripe. No marketing consent is inferred. Fees never reduce the donor's contribution. Refunds, dispute withdrawals and wins append processor adjustments; neither the original gift nor an earlier payout is edited. Donor and campaign totals include contribution adjustments. Saved-page move-in already netted historical refunds; those are retained as originals and not deducted twice. Affected receipts are voided; prepare a corrected replacement for the remaining gift from Letters and approve it before sending.

The payments ledger and Pantry books use US dollars. A Stripe account that settles in another currency still takes USD gifts, but its payouts arrive in that currency: Coffer refuses a non-USD balance transaction rather than treating another currency as dollars, so payout reconciliation needs a USD-settling Stripe account.

## Review ambiguous donors

Open **Payouts → Review donor matches** for external charges whose email belongs to several current donors. Coffer holds those payments without assigning a donor, creating a gift or making a receipt eligible. Any affected payout stays incomplete and cannot be exported as a journal or posted.

An owner or admin opens the charge, compares the current donor records, selects the actual donor and explicitly confirms that assignment. Approval checks the saved review version, current account authority, installation, Stripe account, charge, actual processing fee and complete history of completed refunds again. Changed source facts or donor records require **Refresh provider and candidates** and another review. A missing provider page or fee leaves the payment held. Known Coffer checkout associations keep their existing donor.

Approval records the full paid gift, actual fee and completed refunds through the ordinary payment ledger once. Repeated events and approval retries cannot create another gift. The selection grants no marketing consent, merges no donors and creates no reusable customer association. External gifts retain their unknown goods answer until staff review it, and receipts still need the ordinary preparation and approval.

Private review evidence travels in the owner archive. A restored installation cannot reuse another installation's approval. Merged or edited candidates require fresh review; erasure removes source email and candidates while retaining opaque references that stop replay from recreating the person. OAuth, automatic webhook registration, complete historical backfill and a daily sweep remain unavailable; this queue does not establish live Stripe qualification.

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

## Connect QuickBooks Online

The owner opens **Settings → QuickBooks accounting settings**. Configure `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` in the installation's private environment. Register the exact callback shown by the installation origin followed by `/app/settings/quickbooks/callback` in the Intuit application. Set `QBO_SANDBOX=true` for an Intuit sandbox; production is the default. Choose **Connect QuickBooks**, authorize the company at Intuit, then return to Coffer. The authorization state is short lived, single use and bound to the owner. Access and rotating refresh tokens are encrypted with this installation's secret and excluded from portable archives.

Choose separate checking and Stripe clearing bank accounts, a processing fee expense account, and an income account with a class or location for every fund. Accounts must be active and use USD; the company's home currency must also be USD. QuickBooks allows one transaction location per deposit, while classes can differ by line. Use line classes and one shared location when several funds share a deposit.

Open a payout or closed check batch and choose **Review QuickBooks deposit**. Review each fund, fee and separate adjustment, confirm the exact deposit, then choose **Post to QuickBooks**. The owner alone authorizes these accounting writes. A payout requires complete, balanced processor membership; an offline batch must be closed and balanced. The returned QuickBooks dates, account lines, dimensions and bank total must match the frozen request before Coffer calls it posted.

Refunds and disputes retain the contribution treatment already present in Coffer's ledger. Each processor balance transaction has its own balanced journal against Stripe clearing, including any dispute fee. The bank deposit includes its clearing movement, so the refund or dispute reduces fund income exactly once and checking receives the net payout. Check batches have no processor fee.

A refused post remains visible with the provider error code. Resolve the account, authorization or closed-period issue in QuickBooks and choose **Retry saved QuickBooks post**. Interrupted requests also retain their exact payload and permanent Intuit request ID; retry recovers that result instead of creating a new entry. Mappings changed later never rewrite an authorized request. Confirmed entries are not sent again. Archives preserve financial claims and mappings; reconnect the same company with the original Intuit application after restore before recovering any unfinished request. Disconnect removes Coffer's local credentials; revoke the application in Intuit too if its provider authorization should end.

The FIN-001 journey fakes the Intuit network boundary. It proves OAuth, refresh, three-fund deposits, closed check batches, separate refunds and disputes, exact returned amounts, refusal and recovery, and duplicate safety after restore. It makes no live QuickBooks settlement claim. QuickBooks provider calls remain unavailable on RER Managed.

## QuickBooks exports

Set `QBO_ACCOUNT_NAMES` to JSON mapping the same mapped account IDs to exact QuickBooks account names (including parent names for subaccounts). Download the payout's journal CSV, then use QuickBooks Online **Settings → Import data → Journal entries** and map its debit, credit, account and class columns. Fund names become classes; configure class tracking in QuickBooks if used. Keep its duplicate journal-number warning enabled and reconcile the deterministic compact `CF-…` journal reference (the full payout ID stays in each line description). A file download does not establish that QuickBooks imported it. The separate IIF file targets QuickBooks Desktop, which accepts IIF; it is not a QBO API connection.

[QuickBooks document-number limits](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/0b5f8961-f32e-e396-3a39-7b3e241434e8.htm), [QuickBooks journal CSV instructions](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US), [Stripe payout membership](https://docs.stripe.com/api/balance_transactions/list).

On RER Managed, provider calls show one plain line: **Stripe and Pantry are not available yet on RER Managed.** No Stripe or Pantry request is sent. Existing records and local file exports remain available. Self-hosted installations use their own provider connections.

## Period journals (FIN-004)

In **Payouts → Journal for a period**, choose inclusive From and To arrival dates and CSV or QuickBooks Desktop IIF. The file includes every recorded payout in that period, independently of the latest 100 shown in the list. Each payout keeps its own balanced journal and deterministic reference, with the same account and fund-class mapping as its individual export. A payout that is not paid, fully matched or correctly mapped refuses the download; resolve it before closing the period. An empty period downloads headers only.

The authenticated HTTP door is `/api/coffer/payments/journal?from=2026-10-01&to=2026-10-31&format=csv` (or `format=iif`). These journal files can be mapped into other ledgers such as Xero, Aplos and Sage Intacct; confirm that ledger’s import-column mapping before importing. Check batches are posted from their own closed-batch deposit pages.

## Refunds and disputes (PAY-003)

In **Payouts → Refunds and disputes**, an owner or admin enters an exact USD amount against a recorded Stripe gift. The form freezes the remaining contribution. A saved attempt identity prevents a repeated submission from making another refund. Pending refunds wait for Stripe; failed refunds leave the gift unchanged. An uncertain answer blocks a new refund for that charge: check Stripe, then let its signed refund event reconcile the saved attempt. Do not create a new attempt to retry an uncertain charge.

Refunds, dispute withdrawals and reinstatements each retain one relationship-manager notice attempt, routed as donor replies are (portfolio manager, opportunity owner, then owner). SendGrid acceptance is **submitted**, not delivery. Unavailable or uncertain notices need human review and are not automatically sent again. Disputes show Stripe's current status, exact UTC evidence deadline and evidence flags, with a link to review and submit evidence in Stripe. The ledger, original receipts and new corrected copies retain their separate identities.

[Stripe refund creation](https://docs.stripe.com/api/refunds/create) and [dispute status/evidence fields](https://docs.stripe.com/api/disputes/object) define the provider boundary. The automated journey uses documented synthetic Stripe and SendGrid edges; it does not claim a live account refund or notice delivery.

The external-payment donor review schema is added by `migrations/core/0178_coffer_payment_donor_match.sql`; apply it after the existing core migrations before using the queue.

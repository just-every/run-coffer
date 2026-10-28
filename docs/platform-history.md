# Givebutter and Zeffy history

Owners and admins open **Move in from your CRM**. Preview reconciles cash before
apply; the import journal checks again afterward. Undo removes untouched source
history together. Existing contacts and later native changes are retained.

## Givebutter read

Use the read form and a Givebutter API key. The server makes GET requests only to
`https://api.givebutter.com/v1/contacts`, `https://api.givebutter.com/v1/transactions`,
`https://api.givebutter.com/v1/plans` and `https://api.givebutter.com/v1/campaigns`,
following bounded numbered pages, then reads each transaction detail. Redirects,
failed pages and incomplete pagination stop the review. The key is neither saved
nor returned. Confirm the amount unit from the source account before preview.

The [contact reference](https://docs.givebutter.com/api-reference/contacts/list-all-contacts),
[transaction reference](https://docs.givebutter.com/api-reference/transactions/get-a-transaction)
and [plan reference](https://docs.givebutter.com/api-reference/recurring-plans/list-all-recurring-plans)
describe the source fields. Name parts, primary contacts, campaign identity,
amount, fee, fair market value and dedication come from those records. Custom
question answers become `Question: <title>` contact columns; explicitly map each
one to an existing or new typed constituent custom field. Conflicting answers
require review rather than overwriting a donor value.

The API does not guarantee receipt history, explicit household heads or processor
references. Attach CSV evidence from the source when available, one row per ID:

- `Constituent ID`: optional `Household ID`, `Household Name`, `Head of Household`,
  `Household Addressee`, `Household Formal Salutation`, `Household Informal Salutation`,
  `Email Preference`, `Mail Preference`, `SMS Preference`, `Phone Preference` and
  `Preference Date`. Unknown remains unknown; later native choices are protected.
- `Gift ID`: `Acknowledgment Status`, `Acknowledgment Date`, `Acknowledgment Method`,
  `Acknowledgment Reference`, `Acknowledgment Interaction ID`, optional source tribute
  group and independently prefixed `Soft Credit` acknowledgment columns. A dated
  receipt defaults to acknowledged by email; missing historical facts stay absent.
- `Plan ID`: `Processor Customer Reference`, `Processor Payment Method Reference`
  and `Campaign`. These must be opaque source identifiers, never payment credentials
  or card or bank details. Missing references are explicitly flagged.

An interaction file uses `Note ID`, `Constituent ID`, `Note`, `Note Date` and
`Note Type`. A soft-credit file uses `Soft Credit ID`, `Soft Credit Constituent ID`,
`Related Gift ID` and `Soft Credit Amount`, with its independent acknowledgment
columns. All linked source IDs must resolve to the correct constituent.

## Zeffy exports

In Zeffy's Payments screen, export **Payments**, with stable payment and contact
IDs, buyer names, date, amount, payment method, form, custom questions and advantage
amount. Use the [Zeffy export guide](https://support.zeffy.com/export-or-download-all-payments-or-tickets-associated-with-a-specific-form-u0tyj).
Use one row per payment; itemized rows repeating the same payment are refused.
Upload the contact export and the payment export together, choosing Zeffy.

Supported payment labels include `Payment ID`, `Contact ID`, `First name`,
`Last name`, `Form name`, `Payment date`, `Donation amount`, `Payment method`,
`Advantage amount`, `Tax receipt date` and `Receipt number`. Common CRM columns
also work, including the explicit source-evidence columns above, tribute facts,
independent soft credits and linked interactions. Map each custom question column
explicitly. A zero fee is the Zeffy default; a supplied `Fees` value is retained.

Include a `Currency` column containing `USD`; an absent currency requires review.
This door accepts completed USD payments. It refuses unresolved refunds, failed
or pending payments and other currencies. Unsupported filled columns remain in
the review with their row locations and require explicit acceptance; they are
never claimed as imported. Complete source-object coverage and live provider
qualification are unclaimed.

## Custody and recurring evidence

Recurring source evidence can be read by the current owner or admin at
`/api/coffer/move-in/source-history?donorId=<native-id>`. The same read shows current
email and postal audience eligibility with exclusion reasons, without preparing
or submitting a mailing. It follows reviewed donor
merges, is portable in an archive, and is erased with its person. A revoked admin
cannot read or apply. Replay cannot duplicate cash, acknowledgments or plans, and
erased source IDs cannot be restored through an old import.

Importing history does not contact donors or alter source plans. Stored customer
and payment method references do not implement MOVE-009: cross-account vault
transfer, ACH mapping and donor-authorized replacement schedules remain separate
work. Source preferences do not waive DONOR-009 address verification or DONOR-015
solicitation, frequency and custody rules.

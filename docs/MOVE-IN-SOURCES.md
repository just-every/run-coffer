# CRM export move-in sources

Checked against public vendor documentation on 17 October 2026. Verification fixtures must be synthetic. These are **selected report/export layouts**, not promises that every vendor backup, account-specific report label, or ZIP dump has one fixed schema. The preview reports every populated unconsumed field, as well as unsupported empty columns; nothing is silently dropped. Source IDs remain strings, including leading zeroes. CSV/XLSX files are parsed locally by the server; no CRM credentials or live API connection are used.

## Files and common rules

Upload the constituent report and the matching transaction report together, including every constituent referenced by gifts, credits, pledges, or relationships. CSV needs UTF-8 text with a header row. XLSX uses its sheet names and all sheets. The batch is bounded to 20 uniquely named files, 4 MB of source bytes, 1000 data rows across files/sheets, and 256 columns. Workbook archives have an additional 16 MB verified expansion/200-entry bound. ZIP backups, legacy XLS, PDFs, formulas without exported values, repeated horizontal gift blocks, and multi-valued cells requiring allocation are not import layouts. Save a plain values-only CSV/XLSX report instead. Keep source IDs and postal codes as text in Excel.

Dates accept `YYYY-MM-DD`, US `MM/DD/YYYY`, or actual Excel date cells; four-digit years and real calendar dates are required. Dollar amounts accept plain decimals, `$`, and conventional thousands separators, with at most two decimal places. Currency conversion is outside this importer; export one currency matching Coffer's ledger. Refunds, negative adjustments, securities, in-kind gifts, recurring schedules, and unrecognized transaction types require separate review, rather than being converted into received cash.

Column matching ignores capitalization, spaces and punctuation. The authoritative accepted aliases are in `src/coffer/move-in/source-columns.ts`. Do not relabel an unrelated source field to make it match. Select one primary address/email/phone. Full name is preferred; first/middle/last name columns are joined when no full name is supplied. Conflicting donor values for one ID are errors. Household membership needs both a stable exported household ID and name; names alone are never used to merge families.

## Little Green Light

Use a **Constituents** report for constituent rows and a **Fundraising** report for gift rows. LGL documents the distinction and customizable labels in [Generating custom reports](https://help.littlegreenlight.com/article/126-generating-custom-reports-from-the-constituents-or-fundraising-tab). The gift `Full Export -- CSV` template is a starting point; review its date range and selected fields using [Common reports](https://help.littlegreenlight.com/article/128-common-reports-and-how-to-create-them). A [Comprehensive Export](https://help.littlegreenlight.com/article/459-create-a-comprehensive-export-of-your-database) is a ZIP of CSV files: extract and inspect the relevant files first; the ZIP itself is not accepted.

Select these fields in the report; custom labels may use the listed aliases:

| Report | Required columns | Additional mapped columns |
| --- | --- | --- |
| Constituents | `LGL Constituent ID`, `First Name`/`Last Name` or `Name` | `Email Address`, `Phone Number`, `Address Line 1`, `Address Line 2`, `City`, `State`, `Postal Code`, `Country`, `Note` |
| Fundraising | `LGL Gift ID`, `LGL Constituent ID`, `Gift Type`, `Gift Date`, `Amount` | `Fund`, `Campaign`, `Payment Type`, `Gift Notes`, `LGL Parent Gift ID`, `Deductible Amount` |

LGL explicitly documents constituent/gift IDs and `Parent Gift ID` for pledge payments in [Mapping pledges](https://help.littlegreenlight.com/article/295-mapping-pledges). `Gift` rows become received gifts, `Pledge` rows become commitments, and `Installment` rows become scheduled amounts only. An installment needs its source installment/gift ID, parent pledge ID, due date, and amount. No installment schedule is guessed from frequency; export explicit scheduled rows. A gift linked to a pledge remains one received gift.

For recognition, [Related gifts](https://help.littlegreenlight.com/article/105-gift-entry-soft-credits-and-other-related-gifts) explains selecting the `Related Gifts` field and increasing its Count. Supply one credit per row with the credited constituent ID, credit amount, and original received gift ID (`Related Gift ID`, `Original Gift ID`, or the parent gift field). `Soft Credit` rows never enter cash totals. Names or bundled related-gift text alone cannot establish a reliable reference and remain unmapped.

LGL's [Relationships report](https://help.littlegreenlight.com/article/454-reporting-on-relationships) exports individual relationship columns. Select both constituent IDs and a relationship type. The parser accepts `Related Constituent ID` and `Relationship Type` labels for the counterpart and role. Repeated numbered relationship blocks are surfaced for review; export individual relationship rows for automatic mapping. Do not assume a custom household field is a built-in LGL household identifier.

## Bloomerang CRM

Build separate **Constituent**, **Transactions**, and, when needed, **Notes** reports. The official [Report Columns and Filters](https://help.bloomerang.com/en/articles/17568803-report-columns-and-filters) lists exact selectable fields. Use the source's primary contact values, selected through its address/email/phone columns. [Release notes](https://help.bloomerang.com/en/articles/16058779-2026-bloomerang-crm-release-notes) document CSV alongside Excel report export.

| Report | Select these source columns |
| --- | --- |
| Constituents | `Account Number`, `Name`, `Email Address`, `Phone Number`, `Street`, `City`, `State`, `ZIP Code`, `Country`, optionally `Household Name` |
| Transactions | `Transaction Number`, constituent `Account Number`, `Type`, `Date`, `Amount`, `Fund`, `Campaign`, `Method`, `Note`, optionally `Non-deductible Amount`/`Deductible Amount` |
| Notes | constituent `Account Number`, `Date`, `Note` |

`Donation`, `Pledge Payment`, and `Recurring Donation Payment` are received gifts; `Pledge` is a commitment; `Soft Credit` is recognition. Recurring/membership schedules are not received cash. Preserve linkage to the parent pledge/original transaction in separate ID columns when your report supplies it. First/next/final installment columns alone are not a complete schedule; [Projected Revenue](https://help.bloomerang.com/en/articles/17568826-report-on-projected-revenue) is explicitly based on scheduled amounts, not payment receipts.

Split payments have unique `Transaction Number` values per designation, while sharing a `Payment Number`. Import the designation `Amount` once per transaction; do not substitute `Payment Amount`, which repeats the whole payment. Extra payment-level columns remain visible as unmapped metadata. Credit recipient **names** (`Donor Name`, `Soft Credit Name(s)`) are never treated as the paying constituent. A credit needs a credited account ID plus its original transaction number and amount; missing ID links are blocking errors.

The Relationships column can contain names rather than IDs. Such text remains unmapped. For automatic relationships provide a report with `Account Number`, `Related Account Number`, and `Relationship Type`, preserving direction. Household names alone are likewise insufficient; include the source household account number where available. Bloomerang's [archive](https://help.bloomerang.com/en/articles/16193304-bloomerang-crm-release-notes-archive) documents household account numbers, account/transaction numbers, and notes. General notes keep their text and optional date; an absent date remains unknown.

## Raiser's Edge NXT

Prefer NXT **database-view Export** with separate constituent and gift export types, header inclusion, and one record per row. Blackbaud's [Query & Export Guide](https://webfiles-sc1.blackbaud.com/files/support/guides/re7/query_export.pdf) documents these export types, CSV, IDs, and selecting fields. Its [custom-report tutorial](https://webfiles-sc1.blackbaud.com/files/support/guides/re7ent/crystal_tutorial.pdf) illustrates Gift ID, Gift Amount, Gift Date, and fund descriptions. Configure plain, descriptive column labels; technical abbreviations from older saved export definitions remain unmapped until correctly identified.

| Export | Select these source fields |
| --- | --- |
| Constituent | `Constituent ID`, `Name`, `Email Address`, `Phone`, `Address`, `City`, `State`, `ZIP`, `Country` |
| Gift | `Gift ID`, `Constituent ID`, `Gift Type`, `Gift Date`, `Gift Amount`, `Fund`, `Campaign`, `Pay Method`, `Gift Reference`, optionally parent `Pledge ID` and `Receipt Amount` |

Use a consistent source ID domain in both files. `Cash`, `Pay-Cash`, and `Recurring Gift Pay-Cash` are received gifts; `Pledge` is a commitment. Soft credits require the credited constituent ID, gift ID, and amount. [Gift records](https://webfiles-sc1.blackbaud.com/files/support/guides/re7/gift_record.pdf) documents pledge payments and recognition. Individual Relationships exports can supply both constituent IDs and the relationship type; preserve which person holds the role. Household aliases are accepted only when an explicit ID/name pair is exported; spouse names alone do not create a household.

NXT web-view [Export Lists](https://webfiles-sc1.blackbaud.com/files/support/helpfiles/rex/content/bb-export-lists.html) expands summary columns and groups multiple campaigns with semicolons. A web list missing constituent/gift IDs is insufficient. `View record` URLs are not guessed into IDs. Grouped multi-fund/campaign splits and repeated gift IDs are blocked: obtain source designation IDs and separately allocated amounts before automatic import. This release does not allocate NXT grouped splits. Anonymous flags and unsupported extra columns remain in the unmapped review.

## Reconciliation and acceptance

Cash count/cents and year/fund/constituent totals are computed in a pass over raw received-gift rows before entity mapping, then independently compared with mapped gifts. Pledges, installments and soft credits are excluded. This proves mapping conservation; it cannot prove that the CRM export included every record.

Exported source controls provide that second check when available. Accepted count labels include `Gift Count`, `Total Number of Gifts`, and `TG Count`; amount labels include `Total Gift Amount`, `Total Amount of Gifts`, `TG Amount`, and Bloomerang `Lifetime Revenue`. A control row may use exactly one scope: `Year`, `Fund`, or a constituent ID. With no grouping it controls the whole batch. LGL's `TG Amount`/`TG Count` must be customized to the same gift types/date range; its unfiltered Total Giving includes commitments and recognition and cannot be assumed to equal cash. Bloomerang lifetime revenue controls require the complete lifetime receipt history. Raised/projected/giving totals are not interchangeable with cash.

Controls preserve exported values, independently calculated actual values, and a match flag. Missing/invalid references, malformed dates/amounts, duplicate gift IDs, and conflicting donor identities are structural errors. Control differences and unmapped fields require an explicit recorded acceptance reason or a corrected export before commit. Review positive benefits before receipting: source non-deductible amounts or gift-minus-deductible differences are preserved; explicit source zero establishes no goods/services. The checkbox only fills genuinely unknown benefit information. A missing payment method is labeled `imported`; unfamiliar source methods remain intact with a warning.

Relationships normalize Spouse, Employer, Board Member, Foundation Officer, and Introduced By to Coffer's existing directional role names. Other roles remain raw for the transaction service to assess. Notes without source IDs use a visible file/sheet/row provenance key, not an invented vendor ID. Source gift, constituent and pledge IDs are always required. No live customer exports belong in fixtures or source control.

# Move in from a CRM

Open **More → Move in from a CRM** in Coffer. Choose where you are moving from, add your export files, preview them and compare totals before anything changes. The page lists each CRM's export steps; this guide adds the detail behind them. It was checked against each vendor's public documentation on 17 October 2026.

These are the report layouts Coffer reads. Your account may label a column a little differently; Coffer matches common variants. The review lists every filled column it cannot use, so nothing is dropped without you seeing it. Record IDs stay as text, including leading zeroes. Coffer reads the files itself; it never asks for your CRM password and never connects to the CRM.

## Export steps at a glance

| Moving from | File 1: people | File 2: gifts | Optional |
| --- | --- | --- | --- |
| Little Green Light | **Constituents** tab → **Reports** → new custom report → **Export → CSV** | **Fundraising** tab → **Reports** → **Full Export -- CSV** template, all years → **Export → CSV** | **Constituents → Reports → Relationships** report |
| Bloomerang | **Reports** → new **Constituent** report → **Export** | **Reports** → new **Transactions** report, all dates → **Export** | **Reports** → **Notes** report |
| Raiser's Edge NXT | Database view → **Export** → **New export** → **Constituent** type, one row per record, **Include header** → **Export now** as CSV | Same with the **Gift** export type | Relationships export |

Upload all the files for one move-in together. The columns to select for each are in the sections below.

## Files and common rules

Upload the constituent report and the matching gift report together, including every constituent that gifts, credits, pledges or relationships point to. CSV files need UTF-8 text with a header row. In an XLSX workbook every sheet is read. One move-in takes up to 20 files, 16 MB in total, 100,000 rows and 256 columns: about 10,000 donors with 80,000 gifts. ZIP backups, old XLS files, PDFs and formulas without saved values cannot be read: save a plain CSV or XLSX report instead. Keep IDs and ZIP codes as text in Excel.

**Bigger than that?** Split the gift report by year and move the years in oldest first. Upload `constituents.csv` again with each year's gift file (the relationships report only with the first). Donors and pledges an earlier move-in brought are found by their CRM ID, never copied, and each year's gifts and pledge payments attach to them. A payment whose pledge is in a later year's file is named in the review: keep that Pledge row in the file, or move that year in first. Each move-in's totals check compares that move-in's files with the same gifts in Coffer, donor by donor.

**How a large move-in runs.** Coffer reads and checks every file first, against what is already in Coffer, and shows the totals. Anything that would stop the move-in part-way (a soft credit repeated for the same gift and person, a gift Coffer already holds with other details) is named in this review with its file and row, not discovered later. When you press **Move these records in**, it moves the records in parts of about 800 (donors first, then relationships, pledges, gifts, soft credits and notes). The journal shows how many parts are in; press **Continue** until it says **Moved in**. You can leave between parts: nothing is applied twice. When the last part is in, Coffer adds up the gifts it now holds from this move-in and compares them with your files by year, fund and donor (**Totals check**). Press **Check totals again** at any time before you switch over.

Dates accept `YYYY-MM-DD`, US `MM/DD/YYYY`, or actual Excel date cells; four-digit years and real calendar dates are required. Dollar amounts accept plain decimals, `$`, and conventional thousands separators, with at most two decimal places. Currency conversion is outside this importer; export one currency matching Coffer's ledger. Refunds, negative adjustments, securities, in-kind gifts, recurring schedules, and unrecognized transaction types require separate review, rather than being converted into received cash.

Column matching ignores capitalization, spaces and punctuation, and accepts the column names listed in this guide. Do not rename an unrelated column to make it match. Select one primary address/email/phone. Full name is preferred; first/middle/last name columns are joined when no full name is supplied. Conflicting donor values for one ID are errors. Household membership needs both a household ID and a household name from the export; names alone are never used to merge families. When the export has no household columns, people linked as **Spouse**, or who share one mailing address (street, unit and ZIP), become one household; organizations never join one. A household never joins one already in Coffer because the names match: when the name is taken, the imported one is numbered (for example *Ana and Sam Rivera (2)*).

## Little Green Light

Use a **Constituents** report for constituent rows and a **Fundraising** report for gift rows. LGL documents the distinction and customizable labels in [Generating custom reports](https://help.littlegreenlight.com/article/126-generating-custom-reports-from-the-constituents-or-fundraising-tab). The gift `Full Export -- CSV` template is a starting point; review its date range and selected fields using [Common reports](https://help.littlegreenlight.com/article/128-common-reports-and-how-to-create-them). A [Comprehensive Export](https://help.littlegreenlight.com/article/459-create-a-comprehensive-export-of-your-database) is a ZIP of CSV files: extract and inspect the relevant files first; the ZIP itself is not accepted.

Select these fields in the report; custom labels may use the listed aliases:

| Report | Required columns | Additional mapped columns |
| --- | --- | --- |
| Constituents | `LGL Constituent ID`, `First Name`/`Last Name` or `Name` | `Email Address`, `Phone Number`, `Address Line 1`, `Address Line 2`, `City`, `State`, `Postal Code`, `Country`, `Note` |
| Fundraising | `LGL Gift ID`, `LGL Constituent ID`, `Gift Type`, `Gift Date`, `Amount` | `Fund`, `Campaign`, `Payment Type`, `Gift Notes`, `LGL Parent Gift ID`, `Deductible Amount` |

LGL explicitly documents constituent/gift IDs and `Parent Gift ID` for pledge payments in [Mapping pledges](https://help.littlegreenlight.com/article/295-mapping-pledges). `Gift` rows become received gifts, `Pledge` rows become commitments, and `Installment` rows become scheduled amounts only. An installment needs its source installment/gift ID, parent pledge ID, due date, and amount. No installment schedule is guessed from frequency; export explicit scheduled rows. A gift linked to a pledge remains one received gift.

For recognition, [Related gifts](https://help.littlegreenlight.com/article/105-gift-entry-soft-credits-and-other-related-gifts) explains selecting the `Related Gifts` field and increasing its Count. Supply one credit per row with the credited constituent ID, credit amount, and original received gift ID (`Related Gift ID`, `Original Gift ID`, or the parent gift field). `Soft Credit` rows never enter cash totals. Names or bundled related-gift text alone cannot establish a reliable reference and remain unmapped.

LGL's [Relationships report](https://help.littlegreenlight.com/article/454-reporting-on-relationships) exports one relationship per row. Select both constituent IDs (`LGL Constituent ID`, `Related Constituent ID`) and `Relationship Type`. LGL has no household ID of its own: it keeps a couple as a **Spouse** relationship, so Coffer turns each spouse pair, and people at one mailing address, into one household named after its people (for example *Ana and Sam Rivera*). LGL's `Is Org` column keeps organizations out of households. Upload the relationships report to bring spouses in. Spouses who share one email address both move in, in their household: the email stays on the first, and the second gets a note with it.

The LGL gift report can hold pledges, pledge payments and soft credits in the same file. A `Pledge` row becomes a pledge; its `Campaign` and `Payment Type` are kept in the pledge's note. A `Gift` row with `LGL Parent Gift ID` pays off that pledge. A `Soft credit` row with `Related Gift ID` recognizes its constituent for the original gift; its date, fund and campaign repeat the original gift's, so the original gift keeps them and the money is counted once.

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

## Checking totals, and what still needs you

Coffer adds up your gift rows straight from the files (count and dollars, by year, fund and donor) before it turns them into Coffer gifts, then adds up the gifts it would hold, and shows both side by side. Pledges, installments and soft credits are promises and recognition, not money received, so they are not in these totals. Matching totals prove nothing was lost on the way in; they cannot prove your CRM export included every gift. For that, also export a totals report from your CRM.

A totals report adds that second check. Coffer reads count columns such as `Gift Count`, `Total Number of Gifts` or `TG Count`, and amount columns such as `Total Gift Amount`, `TG Amount` or Bloomerang's `Lifetime Revenue`. Each row may be for one `Year`, one `Fund`, one constituent ID, or everything. In LGL, set `TG Amount`/`TG Count` to the same gift types and dates as the gift report: LGL's unfiltered total giving includes pledges and soft credits.

The review marks rows that **must be fixed** (a missing ID, an unreadable date or amount, a repeated gift ID, a repeated soft credit, two unrelated constituents with the same email, a constituent with two different values, a gift whose deductible amount is zero) and rows to **check** (an unfamiliar payment method kept as written, a constituent already in Coffer). **Rows to look at** lists every one with its file, row number, column and what to change, 50 to a page, filtered by kind, reason or file, and downloads them all as a spreadsheet. Fix them and upload the corrected files on the same page: the review checks them again and names anything still to fix. **Columns left out** names each column Coffer has no place for, with how many values it holds and example rows. Fix the file and upload again, or keep the values out and say why in **Why the differences or left-out values are fine**. A gift with a non-deductible amount keeps it; a zero says no goods or services were given. The checkbox on the upload page only fills in gifts where the export says nothing. A gift with no payment method is marked `imported`; an unfamiliar method is kept as written.

**Already thanked?** Before you move in, Coffer asks whether gifts before a date (the move-in date by default) were already thanked in your old CRM. With **Yes**, those gifts never show as letters due or missing receipts. Gifts on or after that date wait for a letter as usual.

Relationships normalize Spouse, Employer, Board Member, Foundation Officer, and Introduced By to Coffer's existing directional role names. Other relationship types are listed in the review for you to fix. Notes without a note ID are named by their file and row. Gift, constituent and pledge IDs are always required.

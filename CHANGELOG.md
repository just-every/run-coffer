# Changelog

## 0.1.0 — 2026-10-18

The first release. Commit `4ba9d72` was gated independently on 18 October 2026 on a fresh install, on a computer at 1440 and 390 pixels and on a hosted Cloudflare Worker with real SendGrid mail and Stripe test cards. The gate backed up a hosted Coffer holding the full 5,000-constituent Little Green Light move-in (245 parts, about 105 MB), removed it, redeployed the environment empty and restored it with the documented command on the first attempt; every archived table's row count, every year and fund total and owner sign-in by email were the same afterwards.

### What an owner gets

- **Donors and households.** People and organizations, households, spouse and other relationships, consent per channel with its evidence and a timeline on every donor.
- **An exact gift ledger.** Check, cash and card gifts to the cent with fund, reference and a goods-or-services answer; corrections are reversal lines. Soft credits are recognition kept apart from giving totals. Tribute gifts record the honoree and a contact. Pledges have dated installments, a balance kept current and reminders a set number of days before each installment.
- **Online and monthly giving.** Publish a campaign page; donors give once or monthly by card through Stripe Checkout, email permission is recorded from the checkout tick, and a donor portal reached by an emailed link updates the card or cancels. Connect Stripe from **Giving → Connect Stripe**, with the exact lines for your computer or your hosted Coffer and the 28 webhook events.
- **Receipts, letters and statements.** An online gift's receipt is emailed at once with the amount, date, fund, EIN, the 501(c)(3) line and "No goods or services were provided in exchange for this contribution." Thank-you letters and calendar-year statements are prepared, approved by a person and then emailed (hosted) or sent to a print batch. On your own computer no email is sent; letters are marked "Not emailed" and print instead.
- **Follow-up and reports.** Lapsed donors (LYBUNT and SYBUNT) with the amount at risk, a call list, a major-gift pipeline, retention between years and appeal audiences of consenting donors to export.
- **Move in from Little Green Light.** Upload LGL's constituent, gift and relationship exports. The review lists every row to fix at once with file, row, column and what to change; spouses become households; the move-in goes in parts with Continue and ends with a totals check by year, fund and donor. A 5,000-constituent, 40,002-row export moved 38,551 gifts, $20,200,908.23, matching to the cent on a computer and on a hosted Coffer.
- **Your team.** Owner, admin and member roles; invitations and sign-in by emailed link on a hosted Coffer. Members add donors and record gifts; only the owner backs up, restores and erases.
- **Own it.** Your data lives in your own D1 database. Back up and restore on your own computer, or a hosted Coffer through its owner-authenticated backup (below). Erase a donor on request and keep the anonymous ledger line.

### Not in this release

The homepage describes some things the code does not do yet:

- US bank (ACH) checkout: the giving page shows "US bank · Coming soon".
- Apple Pay: Stripe offers it only after you register your domain with Stripe, and it has not been proven on a device.
- Notes to the family for tribute gifts: Coffer records the honoree and notification contact but sends nothing.
- A live QuickBooks Online connection.

PayPal, Venmo, text-to-give, staff-entered card payments, native phone apps, prospect research, grants and planned giving are later targets in `CONTRACT.md`.

### Known issues

- Lapses, Retention, Calls and Pipeline put every record on one page, and the donor pickers on Calls and Pipeline list every donor. At 5,000 donors they are slow to use on a phone.
- **Download backup** shows no progress while it builds (40 to 80 seconds for a 100 MB archive).
- Donor-facing pages (giving, thank-you, portal) carry Coffer's name rather than your organization's, and the thank-you page does not repeat the amount.
- The invitation email does not name your organization or who invited you, and mail comes from the bare `MAIL_FROM` address with no display name.
- Retention compares calendar years even when the fiscal year starts in another month.
- Preparing statements for everyone refuses the whole batch when one donor already has a statement for that year; prepare the others one by one.
- An LGL move-in refuses two organizations sharing one email; clear it on one of them. LGL's Salutation, Addressee and Anonymous? columns are left out and named on the review.
- Stripe Checkout may offer the donor's local currency first; the gift records in USD.

### Back up first

- On your own computer: **More → Data & access → Download backup**, or stop Coffer and run `rer export --output exports/coffer.rer`. Restore into an empty installation with `rer import --input exports/coffer.rer --yes`.
- A hosted Coffer: sign in as the owner, save the owner cookie as described in [docs/backup.md](docs/backup.md), and run `rer run backup:hosted -- --environment NAME --output exports/coffer.rer --session-file owner-session.txt` from the folder that deployed it. Restore into a newly deployed, empty environment with `rer run backup:hosted -- --environment NAME --restore exports/coffer.rer --session-file restored-owner-session.txt --yes`, then re-enter its mail and Stripe secrets. The restore retries a part that fails for a moment; if it stops, run the same command with `--resume JOB_ID` and it uploads only the parts the server does not have yet. `rer export` saves only the local copy.

### Migrations

A fresh install applies 43 forward-only migrations in order:

- `migrations/core/0001_owner.sql`
- `migrations/core/0002_outbox.sql`
- `migrations/core/0003_portability.sql`
- `migrations/core/0004_first_run.sql`
- `migrations/core/0005_identity_providers.sql`
- `migrations/core/0006_provider_control.sql`
- `migrations/core/0007_dependencies.sql`
- `migrations/core/0008_owner_claim.sql`
- `migrations/core/0009_idp_owner.sql`
- `migrations/core/0010_provider_pins.sql`
- `migrations/core/0011_dependency_setup.sql`
- `migrations/core/0012_dependency_approval.sql`
- `migrations/core/0013_erasure.sql`
- `migrations/core/0014_owner_signin.sql`
- `migrations/core/0015_import_kit.sql`
- `migrations/core/0016_coffer.sql`
- `migrations/core/0017_coffer_giving.sql`
- `migrations/core/0018_coffer_receipts.sql`
- `migrations/core/0019_coffer_payments.sql`
- `migrations/core/0020_coffer_donor_depth.sql`
- `migrations/core/0021_coffer_pledges.sql`
- `migrations/core/0022_coffer_gift_depth.sql`
- `migrations/core/0023_coffer_donor_merge.sql`
- `migrations/core/0024_coffer_major_gifts.sql`
- `migrations/core/0025_coffer_call_tasks.sql`
- `migrations/core/0026_coffer_subscription_gifts.sql`
- `migrations/core/0027_coffer_move_in.sql`
- `migrations/core/0028_coffer_communications.sql`
- `migrations/core/0029_coffer_agent.sql`
- `migrations/core/0030_coffer_recovery.sql`
- `migrations/core/0031_coffer_stewardship.sql`
- `migrations/core/0032_coffer_ai_workspace.sql`
- `migrations/core/0033_coffer_giving_consent.sql`
- `migrations/core/0034_coffer_online_receipts.sql`
- `migrations/core/0035_coffer_email_connection.sql`
- `migrations/core/0036_coffer_move_in_parts.sql`
- `migrations/core/0037_coffer_move_in_review.sql`
- `migrations/core/0038_coffer_fiscal_year.sql`
- `migrations/core/0039_coffer_gift_splits.sql`
- `migrations/core/0040_coffer_stripe_subscriptions.sql`
- `migrations/core/0041_coffer_audit.sql`
- `migrations/core/0042_coffer_duplicates.sql`
- `migrations/core/0043_coffer_access_audit.sql`

The checkout pins rer 0.2.52.

### Changes before the release

- The app wears Coffer's own look: the indigo rail with its lit windows, a top bar with search and Record gift, dense gift ledgers and the donor panel with the development agent's card. At phone width the rail and top bar keep their height on short pages. Recorded actions read as words in the audit log, a donor's activity and a letter batch ("Gift recorded by June Albright", "Paid online via Stripe"); the API and the audit CSV keep their codes.
- CRM reviews run every check even when other rows are invalid, with a file, row, column and concrete correction for blocking rows. Pledge rounding within one cent per payment is accepted; promises and actual paid cents are preserved, including partly allocated gifts.
- LGL Prefix/Suffix stay in donor names; Check No. stays in the gift reference alongside the source ID; Appeal fills the appeal field and Campaign stays in the note.
- Letter headers, preparation dates, logged calls and the CRM thanked-before date use the organisation’s time zone. The monthly-giving test has a fixed clock and retains its assertions.
- First/last-name search finds names with middle initials. Duplicate suggestions require shared contact evidence or matching name and address, and say which values matched. Pipeline close dates are visibly required.

- LGL move-in uses constituent names as authoritative and accepts gift/relationship display labels without name blockers; export guidance states the confirmed LGL fields and remaining format limits.
- Stripe move-in reads the connected account or a temporary restricted read key, follows pages automatically, previews gifts and supported monthly plans, checks applied count and cents, and supports undo. Saved JSON is an advanced option.
- Pin the package runner to rer 0.2.51.

- **Every row that blocks a CRM move-in is on the page.** The review lists all “Must fix” and “Check” rows with file, row, column and what to change, 50 to a page, filtered by kind, reason or file, and downloads them as CSV; uploading the corrected files on the same page checks them again. Left-out values are named per column with counts.
- **Preview and apply agree.** The review plans every part against Coffer before anything moves, so repeated soft credits and conflicts with earlier records are named there; a part that still fails names its part, rows and reason.
- **Real households.** Spouses and people at one mailing address become a household named after its people; a household never merges into another by surname or name, and organizations stay out. Spouses sharing one email both move in.
- **Hosted move-ins at full size, and year by year.** Staged parts and review rows go to the database in bounded requests, so a 100,000-row move-in works on a hosted Coffer. A later year's file finds donors and pledges from an earlier move-in by CRM ID, and its totals check compares like with like.
- **Connect Mango or Mailchimp from the Appeals page.** A connect page says what Mango is and how to get it, how to make a Coffer credential inside Mango (Settings → Integration credentials, four boxes), and takes Mango's address and credential; Coffer checks every permission with Mango before saving it in its own database. Mailchimp connects the same way with an API key and an audience picked from your account. The old `MANGO_*`, `MAILCHIMP_*` and `COMMUNICATIONS_PROVIDER` deploy settings are gone.
- **Approved email appeals go out through Mango.** Coffer puts the consenting recipients on a Mango list named after the appeal, with their consent, and shows the subject and message to approve in Mango, which sends it. Without a connection the send button leads to the connect page instead of an error.
- **Big CRM move-ins from the page alone.** Up to 16 MB and 100,000 rows per move-in (about 10,000 donors and 80,000 gifts), moved in parts of about 800 records with a Continue button and a totals check from the gifts in Coffer at the end. LGL pledge and soft-credit rows import without warnings, spouse pairs become households, and every left-out value says exactly what to do.
- **Already-thanked history stays thanked.** The move-in asks whether gifts before a date were already thanked in the old CRM (yes by default); those never show as letters due.
- **Online gift receipts go out on their own.** Each paid online gift's receipt is emailed at once, at any amount; Letter settings can hold them for approval instead.
- **Local letter sending.** On this computer, **Send approved letters** marks emailed letters “Not emailed” and routes the rest to print instead of failing.
- **Appeal subject.** The email subject and message are visible on the form, and a missing one is shown on the same page.
- **Connect Stripe on this computer** no longer shows Dashboard webhook steps for a localhost address Stripe cannot reach.

- **Connect Stripe from Coffer.** A Giving setup page explains what Stripe is for, where to find the test and live keys, and gives the exact lines to enter them: on this computer they go into the private settings file, followed by the restart command; hosted it is the `rer deploy --set-secret` line with the Worker named. It also walks through the webhook. The donor page and Payouts link to it.
- **Invite people from Data & access.** An invite form (email, role) sends Base's sign-in invitation; on this computer no mail is sent and each person's sign-in-as link is shown instead.
- **Move in from a CRM from the page alone.** The move-in page names each source's export steps (menu path, export, file).
- **Receipts go by email by default.** A donor who gives an email address gets the receipt by email; the giving page asks for appeal consent separately. Print is for donors without an email address or with a bounced one.
- **Year-end statements are one letter** listing every gift once with the total.
- **Restore a downloaded backup.** The Data & access page and the backup guide give the exact commands, including making the browser's download private before `rer import`.
- **Replies from mail services.** A reply sent through a mail service is matched to its donor by the DMARC-aligned From address that Cloudflare verified.
- **Docs.** New online-giving, payments, move-in, people and hosting guides on the docs site; README mail setup, and hosted take-down after a hosted export.

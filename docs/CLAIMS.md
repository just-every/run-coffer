# Coffer homepage claims → code

Every capability claim on the built homepage (`src/site/landing/`, branch `br/style`), tracked against the current implementation. Giving and receipt rows were updated on 17 October 2026. The copy is the desk's owner-accepted copy and is not watered down; this table is what the run-site gate reads before any deploy.

`CONTRACT.md` defines the full fundraising CRM target. Its Status table keeps broader unfinished features explicit; the giving rows here describe the self-hosted donation, subscription and donor portal implementation.

**Totals: 61 claims · 31 in code · 10 partly · 20 contract, not yet in code.**

| # | Section | Claim | Status | Backed by |
|---|---|---|---|---|
| 1 | Hero | "Coffer takes donations" | in code | Self-hosted campaign checkout takes card and Link gifts through Stripe and writes each paid gift once to the immutable ledger with its fund and matched donor (`src/coffer/giving/checkout.ts`, `src/coffer/giving/recording.ts`). Managed integrations are not available yet. |
| 2 | Hero | "keeps every donor's story" | in code | `src/coffer/donors.ts` `donorHistory` (gifts, pledges, consent, letters, appeals, activity) on `src/coffer/ui/donors.ts` `donorPage`. |
| 3 | Hero | "sends the receipts" | in code | Approved per-gift receipts are emailed through the installation’s SendGrid account; current consent and email are checked at dispatch, otherwise letters go to print (`src/coffer/letter-delivery.ts`, `tests/receipts.test.mjs`). Managed email integrations are not available yet. |
| 4 | Hero | "and thank-yous" | in code | The charity’s reviewed wording is frozen and approved, then sent by Coffer through SendGrid in bounded batch steps; no-consent/no-email donors go to print (`src/coffer/receipt-mail.ts`, `src/coffer/ui/letters.ts`). |
| 5 | Hero | "shows who needs a call" | contract, not yet in code | No lapsed-donor or call list; Today (`ui/home.ts`) lists letters due and waiting approvals only. |
| 6 | Hero | "100% free, open source alternative to Bloomerang, Little Green Light and Neon CRM" | partly | Free and MIT (`LICENSE`); covers donor records, gift ledger, consent, letters and appeals, not the incumbents' giving, email or reporting. |
| 7 | Hero card | Spring appeal $48,210 of $60,000, gifts and recurring donors | in code | Campaign pages show goal, ledger-derived raised total, gift count and recurring donor count (`src/coffer/giving/campaigns.ts`, `src/coffer/giving/ui.ts`). |
| 8 | Hero card | Monthly $25 · Active | in code | Stripe monthly subscriptions appear on donor records and in the donor portal with amount and active/past-due/cancelled state (`src/coffer/giving/recording.ts`, `src/coffer/giving/manage-ui.ts`). |
| 9 | Hero card | Failed card · Retried successfully | in code | Verified invoice outcomes record failed attempts, Stripe next-attempt timing and successful recovery; donors receive a private card-update link (`src/coffer/giving/webhooks.ts`, `tests/giving.test.mjs`). |
| 10 | Hero card | Receipt sent · Gift $250.00 · No goods or services provided | in code | Gift receipt email contains donor, gift amount/date, organization and the reviewed goods-or-services statement; signed provider events confirm delivery (`tests/receipts.test.mjs`). |
| 11 | Hero card | Call Tom Okafor · lapsed 14 months | contract, not yet in code | No lapse detection or call tasks. |
| 12 | Online giving | Donation forms and campaign pages | in code | Admins publish campaign donation forms at `/give/<slug>` with a story, fund, goal and once/monthly checkout (`src/coffer/giving/http.ts`, `src/coffer/giving/ui.ts`). |
| 13 | Online giving | monthly giving | in code | Monthly Stripe subscriptions, installment ledger entries, recovery and end-of-period cancellation (`src/coffer/giving/recording.ts`, `src/coffer/giving/portal.ts`). |
| 14 | Online giving | card, bank and Apple Pay checkout | partly | Card and Link use Stripe Checkout; Apple Pay is offered by Stripe on eligible devices with a registered domain. US bank is explicitly coming soon; the available test account is AU. A real Apple Wallet device is still needed to exercise Apple Pay. |
| 15 | Online giving | a portal where donors update their own card | in code | Emailed, hashed, expiring one-use donor links open only that donor’s monthly plans; card updates use Stripe Billing Portal (`src/coffer/giving/portal.ts`). |
| 16 | Donors | Households | in code | `src/coffer/donors.ts` `household()` finds or creates by name; members listed on the donor page. |
| 17 | Donors | relationships | partly | Household membership only; no other relationship types. |
| 18 | Donors | every gift | in code | `src/coffer/gifts.ts` ledger lines; `donorHistory` lists them by year. |
| 19 | Donors | every conversation in one place | contract, not yet in code | Gift notes and the audit trail only; no interaction or conversation records. |
| 20 | Donors | soft credits | contract, not yet in code | None in code. |
| 21 | Donors | tributes | contract, not yet in code | None in code (a gift note can mention one). |
| 22 | Donors | employer matches | contract, not yet in code | None in code. |
| 23 | Donors card | Lifetime giving and first gift | partly | Lifetime and yearly totals in `donorHistory` `totals`; first-gift date is not shown. |
| 24 | Payments | Gifts sync from Stripe as they happen | in code | Signed Stripe charge webhooks share the giving endpoint, match external payments and saved-page move-ins, and deduplicate by event, charge and balance transaction (`src/coffer/payments/`, `tests/payments.test.mjs`). Self-hosted USD; Managed provider calls are not available yet. |
| 25 | Payments | fees, refunds | in code | Immutable balance entries retain gross, processing fees, refunds, disputes and wins. Refunds append contribution reversals; saved move-in refunds are not counted twice (`migrations/core/0019_coffer_payments.sql`, `src/coffer/payments/entries.ts`, `tests/payments.test.mjs`). |
| 26 | Payments | failed monthly payments | in code | Signed failed-invoice events update monthly state, email card-update links and record successful retries without counting failed charges as gifts (`src/coffer/giving/webhooks.ts`, `tests/giving.test.mjs`). |
| 27 | Payments | each payout matches its deposit in QuickBooks Online or Pantry | partly | Paid USD payouts reconcile to exact balance transactions and submit an evidence-backed fund journal to Pantry. A person approves in Pantry; refresh records its posted journal ID without resending. QBO-ready journal CSV and Desktop IIF ship; a live QBO connection remains later. Live Stripe-to-books proof awaits a USD-settling test account: the supplied account settles AUD (`docs/PAYMENTS.md`). |
| 28 | Payments | split by fund | in code | Payout detail shows gross, fees and net per fund; mapped fund accounts become balanced Pantry journal lines or QBO journal export lines. Automatic payout membership comes from Stripe; manual payout membership is explicitly reviewed and must match to the cent (`tests/payments.test.mjs`). |
| 29 | Receipts | Thank-you letters | in code | Reviewed, hash-approved thank-you letters are sent through install mail or printed individually or by batch, with donor-level delivery states (`src/coffer/acknowledgements.ts`, `src/coffer/letter-delivery.ts`). |
| 30 | Receipts | year-end tax receipts | in code | Calendar-year statements itemize every unreversed gift, total gifts, goods value and deductible portions; approved statements use the same email/print workflow (`src/coffer/year-end.ts`, `tests/receipts.test.mjs`). |
| 31 | Receipts | by email | in code | Self-hosted SendGrid sending uses the installation’s existing sign-in mail credentials and sender. RER Managed provider integration is not available yet (`src/coffer/receipt-mail.ts`). |
| 32 | Receipts | print-ready for mail | in code | Standalone print-styled US Letter documents for each letter and whole or pending print batches, with window-envelope address placement and browser Save as PDF, alongside CSV (`src/coffer/ui/print-letters.ts`). |
| 33 | Receipts | with the right IRS language | in code | `settings.ts` requires donor, amount, date, organization and the goods-or-services statement; default 501(c)(3) wording in `migrations/core/0016_coffer.sql`. |
| 34 | Receipts | proof of delivery | in code | Signed SendGrid delivered/bounce events and explicit Email Logs lookups are recorded per letter and shown on donor and batch; bounced donors route to print. Configure a signed webhook or grant Email Logs access; submission alone is never labeled delivered (`src/coffer/letter-delivery.ts`, `tests/receipts.test.mjs`). |
| 35 | Interlude | Thank-yous sent · 48 donors tonight | in code | Batch sending reports the number submitted and separately the number provider-confirmed delivered; repeated send clicks do not resubmit claimed letters (`src/coffer/ui/letters.ts`, `tests/receipts.test.mjs`). |
| 36 | Appeals | Appeals and welcome journeys go out through Mango or Mailchimp | contract, not yet in code | Appeals export a CSV audience (`recipientsCsv`); no journeys or email integrations. |
| 37 | Appeals | welcome journeys | contract, not yet in code | None in code. |
| 38 | Appeals | Unsubscribes are honored everywhere | partly | Append-only consent per channel; appeals include only donors whose latest answer is yes and refuse approval or export when it changes (`appeals.ts`); no unsubscribe link or sync. |
| 39 | Appeals | replies land with the right person | contract, not yet in code | No inbound mail. |
| 40 | Major gifts | major-gift pipeline with next steps, owners and engagement scores | contract, not yet in code | None in code. |
| 41 | Development agent | reconciles every gift | contract, not yet in code | Agent keys can only read and prepare (`auth.ts`, `commands.ts`). |
| 42 | Development agent | rescues failed monthly gifts | contract, not yet in code | None in code. |
| 43 | Development agent | sends missing receipts | partly | An agent key may run `ack.prepare`; a person approves and sends. |
| 44 | Development agent | drafts stewardship from your own history | contract, not yet in code | None in code. |
| 45 | Development agent | tracks retention donor by donor | contract, not yet in code | No retention reporting. |
| 46 | Move in | Move from Little Green Light | contract, not yet in code | Only the Stripe importer exists (`src/coffer/imports/`). |
| 47 | Move in | Bloomerang | contract, not yet in code | No importer. |
| 48 | Move in | Raiser's Edge NXT | contract, not yet in code | No importer. |
| 49 | Move in | with every donor, household and gift | partly | Stripe customers become donors and charges become gifts; no households from Stripe. |
| 50 | Move in | check the totals before you switch | partly | Preview shows donors, gifts, the total and every skip with its reason, and apply needs the reviewed fingerprint (`imports/service.ts`, `ui/move-in.ts`). |
| 51 | Ownership | Run Coffer on your own computer | in code | `rer dev` (`scripts/installer/local.mjs`, README), local D1. |
| 52 | Ownership | keep every donor record / Your donors, your database | in code | The installation's own D1 database (`wrangler.jsonc`, `migrations/`). |
| 53 | Ownership | Export everything, any time | in code | `/app/backup` and `rer export` through Base portability (`src/coffer/http.ts`, `archive-policy.mjs`). |
| 54 | Quiet details | Soft credits | contract, not yet in code | None in code. |
| 55 | Quiet details | Tribute gifts | contract, not yet in code | None in code. |
| 56 | Quiet details | Matching gifts | contract, not yet in code | None in code. |
| 57 | Quiet details | Pledges: schedules, reminders and balances kept current | partly | Pledges with due-by date, paid and remaining balance (`donors.ts`, `gifts.ts` pledge link); no schedules or reminders. |
| 58 | Quiet details | Consent: email and mail preferences honored everywhere | in code | `donors.ts` consent history per channel; enforced in `appeals.ts`. |
| 59 | Quiet details | Gift ledger: every change recorded; no gift is silently edited | in code | Database triggers refuse changes; corrections are reversals (`gifts.ts`, `migrations/core/0016_coffer.sql`); every command writes `cf_events`. |
| 60 | Closing | Open source donor management for every nonprofit | in code | MIT `LICENSE`; donor records as above. |
| 61 | Closing | Free and open source, MIT licensed | in code | `LICENSE`. |

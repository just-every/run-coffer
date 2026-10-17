# Changelog

## Unreleased

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

# Changelog

## Unreleased

- **Connect Stripe from Coffer.** A Giving setup page explains what Stripe is for, where to find the test and live keys, and gives the exact lines to enter them: on this computer they go into the private settings file, followed by the restart command; hosted it is the `rer deploy --set-secret` line with the Worker named. It also walks through the webhook. The donor page and Payouts link to it.
- **Invite people from Data & access.** An invite form (email, role) sends Base's sign-in invitation; on this computer no mail is sent and each person's sign-in-as link is shown instead.
- **Move in from a CRM from the page alone.** The move-in page names each source's export steps (menu path, export, file).
- **Receipts go by email by default.** A donor who gives an email address gets the receipt by email; the giving page asks for appeal consent separately. Print is for donors without an email address or with a bounced one.
- **Year-end statements are one letter** listing every gift once with the total.
- **Restore a downloaded backup.** The Data & access page and the backup guide give the exact commands, including making the browser's download private before `rer import`.
- **Replies from mail services.** A reply sent through a mail service is matched to its donor by the DMARC-aligned From address that Cloudflare verified.
- **Docs.** New online-giving, payments, move-in, people and hosting guides on the docs site; README mail setup, and hosted take-down after a hosted export.

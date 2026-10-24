# Sending and printing receipts

Review your organization name, EIN and letter wording in Letter settings. Prepare
per-gift thank-yous in Letters, read every frozen letter and approve the batch.
Send approved letters in steps of up to eight. Each letter goes by email
whenever the donor has an email address: a receipt is transactional mail, so it
never depends on appeal consent, and a marketing opt-out does not stop it.
Only donors without an email address, or whose earlier receipt bounced or drew
a complaint, go to the print batch; so does a letter whose donor's address
changed after approval. Email goes through the installation's
`MAIL_PROVIDER`, `MAIL_API_KEY` and `MAIL_FROM` settings, the same
provider and sender used for sign-in mail (see [Coffer deployment details](/docs/deployment#mail)).
RER Managed uses the assigned relay. Assisted hosting supports SendGrid, Resend and Cloudflare Email Sending. Coffer on your own computer
sends no email: **Send approved letters** marks each letter that would have
been emailed “Not emailed · email is off on this computer” and moves the rest
to print, so you can try the whole flow without a mailbox.

Online gifts do not wait for a batch: each paid online gift's receipt is
emailed as soon as the gift is recorded, at any amount. Choose **Hold online
receipts for me to approve in Letters** in Letter settings to review them first.

Submitted means the configured provider accepted the email; it does not mean delivered. To
have delivery and bounces show up on their own, turn on SendGrid's Event
Webhook: in SendGrid, open **Settings → Mail Settings → Event Webhook**, set the
URL to `https://YOUR-INSTALL/api/coffer/mail/events`, select Delivered,
Bounced, Dropped and Spam Reports, and turn on **Signed Event Webhook**.
SendGrid then shows a **Verification Key**: a long line of letters and digits.
Copy it whole and save it as the deployment secret `MAIL_EVENT_PUBLIC_KEY`, the
same way as the other secrets (`read -rs MAIL_EVENT_PUBLIC_KEY && export MAIL_EVENT_PUBLIC_KEY`,
then `rer deploy --environment <name> --set-secret MAIL_EVENT_PUBLIC_KEY`).
Coffer accepts only events signed with that key, and repeated events are
counted once. Negative delivery evidence
wins over a late delivery event and moves the letter to the print batch. A bounce creates one address-fix task for the document, shown in Letters and on the donor. Staff check the current email, record how they checked it, and complete the task. The document stays available to print; completing the task never claims email or postal delivery. Both
the donor and batch show delivery results. Coffer does not configure other SendGrid account webhooks.

If your own SendGrid account already has Open Tracking on, you may also select
Open webhook events. Coffer supplies an escaped HTML alternative of the exact
frozen receipt text so SendGrid can track that format. Coffer never enables
tracking or adds a pixel. It retains only the signed event ID, document ID and
time; no recipient IP address or user agent is stored. The donor timeline says
**provider-reported open, not proof of reading**: mail software may open messages
automatically. Open events never replace delivered, bounced or complained results.

In Engagement settings an owner or admin may assign a weight to provider-reported
opens (zero by default). Each distinct document opened in today and the preceding
364 organization-calendar days earns 5 base points, capped at 25; repeated opens
of the same document score once. The usual weight/25 formula applies. Opens do
not change giving recency or the retention-risk clock. Donor factors show the
provider, actual contributing events, document count, weight and points.

The explicit **Check delivery with SendGrid** action also reads provider events
through the Email Logs API, using the stored provider message ID and exact
recipient address. It requires Email Logs access on the installation’s
SendGrid account. If that access is unavailable, the action reports the missing
access; it never substitutes a guessed delivery result.

A failed submission with an uncertain outcome is kept for investigation rather
than resent. Check that message with the provider before mailing a paper copy;
Coffer does not automatically retry it. Fix an incorrect donor address before
preparing future letters. Letters already approved retain their exact address
and wording.

Print all letters, a single letter, or the pending print batch. Choose US Letter,
100% scale and no browser headers/footers; use Print or Save as PDF. Each letter
starts on a new page, with the address positioned for a window envelope. Long
statements continue onto additional pages. Test a sheet with your envelopes.
After printing, record the print batch as printed. CSV export remains available.
Printing records staff action, not postal delivery.

For year-end statements, choose a calendar year in Letters, optionally one donor.
Each donor gets one letter that lists every unreversed gift in that year once,
including imported entries, with its fund, goods or services and deductible
portion, then the total gifts, goods or services value and deductible total,
and your reviewed goods-or-services wording.
Unknown goods answers must be resolved first. Review and approve the statements,
then email or print them in the same flow. Statements do not replace per-gift
acknowledgements. A donor's existing statement batch prevents duplicate annual
runs; discarded batches can be prepared again. Automatic reissues and donor
portal statements are not implemented yet.

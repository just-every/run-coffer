# Sending and printing receipts

Review your organization name, EIN and letter wording in Letter settings. Prepare
per-gift thank-yous in Letters, read every frozen letter and approve the batch.
Send approved letters in steps of up to eight. Each letter goes through the
installation's existing `MAIL_PROVIDER=sendgrid`, `MAIL_API_KEY` and `MAIL_FROM`
settings, the same provider and sender used for sign-in mail. Current email
consent and the unchanged recipient email are checked when each letter is
claimed for sending. No consent, no email, or an earlier bounce/complaint routes
the donor's letters to print. RER Managed provider calls are not available yet.
Local development and demo email remains suppressed and never counts as sent.

Submitted means SendGrid accepted the email; it does not mean delivered.
Configure a signed SendGrid Event Webhook for `https://YOUR-INSTALL/api/coffer/mail/events`
and enable Delivered, Bounced, Dropped and Spam Reports. Save its verification
public key as the optional deployment secret `MAIL_EVENT_PUBLIC_KEY` (base64
SPKI, as supplied by SendGrid). The webhook requires the provider's signature
and timestamp; repeated events are deduplicated. Negative delivery evidence
wins over a late delivery event and moves the letter to the print batch. Both
the donor and batch show delivery results. Coffer does not configure other SendGrid account webhooks.

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
The statement lists every unreversed gift in that year, including imported
entries, with total gifts, goods or services values and deductible portions.
Unknown goods answers must be resolved first. Review and approve the statements,
then email or print them in the same flow. Statements do not replace per-gift
acknowledgements. A donor's existing statement batch prevents duplicate annual
runs; discarded batches can be prepared again. Automatic reissues and donor
portal statements are not implemented yet.

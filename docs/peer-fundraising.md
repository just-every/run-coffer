# Supporter fundraising

A supporter signs into their own giving portal and follows **My fundraising
pages** to create a personal page or team under a published campaign. Public
recognition requires explicit permission. Withdrawing that permission hides the
page; a later permission grant does not publish it again automatically.

Gifts through a personal page belong to the actual donor. The fundraiser receives
separate soft credit. Public page and team totals use signed received money,
including reversals. Team and personal totals describe the same underlying
money and must not be added together.

The current notice command is an explicit owner or admin action through
`POST /api/coffer/commands`. Connect the existing Mailchimp audience and sender
first. A subscribed provider contact, current Coffer email consent, a unique
fundraiser email and newsletter-topic permission are required. Local and demo
mode suppress submission. No other supporter or ordinary staff member can send.

Use command `peer.sendNotice` with these input fields:

- `recordId`: the current fundraising page or team identifier.
- `recordType`: `page` or `team`.
- `version`: the current record version, available from the supporter's own state.
- `notice`: `thank` or `milestone`.
- `confirm`: `SEND`.

The thank-you acknowledges creation. The milestone congratulates the fundraiser
when signed received money reaches the record's goal; a team counts its public
members' pages. Both messages have fixed non-ask wording. They leave solicitation
restrictions and appeal-frequency limits intact, and cannot be edited into asks.
Changed publication, goal, amount, identity, consent or sender authority refuses
the provider handoff. Review the current record before making a new submission.

Each notice is claimed once per record. Repeating the command returns its saved
outcome. An uncertain submission stays held for review and is never automatically
retried. A provider's sent result is distinct from delivery or reading. The donor
timeline retains the message; the donor's data file and installation archive keep
its history. Restore preserves those claims without restoring sender credentials.
Merge withdraws publication; erasure removes personal message content and keeps
anonymous financial history. Neither operation authorizes a new send.

The current owner-only notice default awaits ct approval. It does not establish
live Stripe or Mailchimp qualification, automatic notice scheduling, broader
staff delegation or another mail provider's acceptance.

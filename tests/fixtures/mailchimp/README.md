# Mailchimp provider fixtures

`responses.json` contains documentation-derived synthetic examples for the real
Mailchimp Marketing API adapter. Its provenance section attributes each response
shape to official Mailchimp documentation. These are not account recordings.
No Mailchimp account was connected and no provider send was performed.

The adapter uses the API key's `-usN` suffix to construct the HTTPS API hostname.
It never accepts a configurable API origin, follows redirects, or retries a send.
Contact lookups use the documented MD5 of the lowercase address.

New contacts use `status_if_new: pending`, with no `status` update. Existing
contacts are returned unchanged, including unsubscribed and cleaned contacts.
Coffer retains the donor's consent evidence; this API call starts Mailchimp's
confirmation flow and does not claim that evidence has been confirmed there.
Audiences with mandatory merge fields may reject this minimal opt-in request;
the adapter reports the provider failure instead of inventing field values.

Each communication creates a separate static segment and regular campaign. The
adapter checks that the segment contains exactly the intended subscribed contact,
and checks the campaign's saved audience/segment before its single send action.
The segment ID is returned as `revisionId` for the caller's persisted draft.
This is an adapter reference, not a Mailchimp revision or idempotency token.
The caller must persist the draft and own the send claim; ambiguous failures need
operator review, never automatic resubmission. Drafts and segments can remain
after failures and are intentionally available for that review.

The documented [campaign settings API](https://mailchimp.com/developer/marketing/api/campaigns/create)
offers `from_name` and `reply_to`, with no independent `from_email` property.
The adapter therefore requires `MAILCHIMP_FROM_EMAIL` to match
`COFFER_REPLY_ADDRESS` and disables `use_conversation`, preserving Coffer's
configured reply destination. Independent From and Reply-To settings have not
been established with a live account and are not implemented.

Message content keeps the donor's merged plain text and includes Mailchimp's
unsubscribe, preferences, mailing address, permission reminder, and conditional
referral merge tags in the footer. Footer tags follow Mailchimp's official
[footer guidance](https://mailchimp.com/help/customize-your-footer-content/).
Provider account verification, sender/domain verification, audience footer
configuration, plan eligibility, and actual sends remain unverified.

Results are read only when the campaign reports `sent`. Recipient report status
`sent` becomes `sent`; `hard` or `soft` becomes `bounced`. Neither acceptance of
the send action nor a `sent` report is presented as proof of delivery.

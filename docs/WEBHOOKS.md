# Webhooks

Open Settings → Webhooks as an owner or admin. Approve the HTTPS destination,
event selection and ongoing retries explicitly. Copy the installation-generated
signing key into the receiver when it is shown; ordinary reads never reveal it.

Verify `coffer-signature` against the exact request body before processing it.
`src/coffer/webhooks/receiver.mjs` exports `verifyWebhook(secret, signature, body)`
using HMAC-SHA256 and a five-minute timestamp window. A retry or reviewed replay
has a fresh signature timestamp but keeps the original event ID and occurrence
time. The receiver must atomically persist that event ID together with its
business effect in its own durable database. A previously committed ID means
acknowledge without applying the effect again. A signature never proves exactly
once processing or authorization to market to a donor.

A delivery has at most six total automatic submissions, including its first.
Failures wait increasing delays. A current owner or admin can inspect every
retained attempt and explicitly approve a separate replay with lineage to the
original delivery. Redirects are not followed and receiver response bodies are
not retained. The ordinary HTTP journeys fake the network edge. The separate manually
invoked live sandbox has asserted real receiver delivery and actual Stripe
charge and refund ingestion. Its final private-network assertion still fails
with a generic Cloudflare DNS error; production public-network enforcement
and full live hosted-delivery proof remain unproved.

Open Manage signing keys on the endpoint to rotate in place. Zero overlap is
initially selected. An explicitly chosen overlap of up to 1440 minutes signs
with both the current and previous keys; either receiver key verifies the
request. Retire the previous key early when the receiver has switched. An
active overlap must be retired before another rotation.

Pause stops future events and automatic retries. Resuming requires a separate
current native approval and does not requeue held history. After replacing the
installation session secret, unreadable signing keys hold deliveries without
using attempts. Review fresh-key recovery, copy the new key, install it at the
receiver, then explicitly resume. Recovery cannot retrieve the old secret and
stays paused until that separate approval.

For retained terminal history, Replay to replacement requires another current
approved active endpoint subscribed to the same event. Explicitly review its
destination and duplicate risk. The new delivery retains the original event ID
and parent; the original outcome and attempts stay intact. Pending and sending
deliveries cannot migrate. These continuity defaults await ct approval.

The conservative retention default has no automatic expiry: every retained
delivery and attempt is available through Older deliveries and Newest deliveries.
Associated history and identifiers are removed when the donor is erased.
Webhook keys, endpoint approvals and delivery state are excluded from archives,
so restoring an archive cannot resume disclosure.

Ct approved the explicit retention default with riders on 26 October 2026 at pin 3bff3d085ae0e39f8a59b6c6c5593ec705b42b66. API-002 remains partial. History access beyond the first page is asserted; complete expected delivery and attempt reconciliation, replay lineage across that complete set and cursor exhaustion remain unproved. Archive exclusion and associated donor erasure are unchanged.

The subsequent `tests/webhook-history-journey.mjs` reconciliation now proves the complete retained delivery and attempt set, nested replay lineage and terminal cursor exhaustion. Production public-network enforcement, full live hosted-delivery proof and approval of the newly adopted continuity defaults remain Gaps in CONTRACT.md. The manual `tests/webhooks-sandbox-journey.mjs` run passed real HTTPS signing, retry, replay, durable deduplication and actual Stripe charge and refund assertions, then failed the explicit private-address refusal assertion. A generic DNS failure is not counted as that proof.

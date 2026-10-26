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
not retained. The receiving network edge and Stripe are faked in the committed
journeys; these journeys do not prove production public-network enforcement or
live hosted delivery.

To replace a signing key, pause the old endpoint, then connect and approve a new
subscription. It receives a newly generated key and future matching events.
Existing history stays with the old subscription and cannot migrate or replay
through the replacement. In-place rotation, key overlap and automatic recovery
from installation session-secret replacement are unavailable.

The conservative retention default has no automatic expiry: every retained
delivery and attempt is available through Older deliveries and Newest deliveries.
Associated history and identifiers are removed when the donor is erased.
Webhook keys, endpoint approvals and delivery state are excluded from archives,
so restoring an archive cannot resume disclosure. Ct approval of the newly
explicit retention default remains pending.

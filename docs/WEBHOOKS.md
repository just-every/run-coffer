# Native webhooks

Open Settings, then Webhooks. An owner or admin selects event types and explicitly approves the destination and continuing automatic deliveries. Copy the signing secret from the connection result into the receiver; Coffer never shows it again. Pause an endpoint to stop queued work. Create a new explicitly approved endpoint when replacing its key or address.

The receiver must use public HTTPS on port 443, without URL credentials, a query string or fragment. Redirects are failures. Responses and their bodies never become product data; only the status code and outcome are logged. An already submitted request can finish after pause.

Each POST contains JSON with `id`, `type`, `occurredAt` and `data.id`. No donor names, contact details, gift amounts or notes are disclosed. Types are `gift.created`, `gift.reversed`, `donor.created`, `donor.updated`, `plan.failed`, `plan.canceled`, `task.assigned` and `form.submitted`. The exact current source semantics are stated in API-002 in [the contract](../CONTRACT.md).

The `coffer-signature` header has `t=<unix seconds>,v1=<hex digest>`. Compute HMAC-SHA256 with the signing secret over the timestamp string, a literal dot and the unchanged request body bytes. Compare the digest in constant time and reject signatures outside the receiver's freshness window. `coffer-event-id` equals the body's `id`; deduplicate by that ID. `coffer-delivery-id` identifies an automatic delivery sequence or explicit replay. Verify the signature before processing either header.

A successful HTTP status from 200 through 299 completes delivery. Other outcomes retry after increasing delays, at most six attempts. The per-minute scheduler sends at most 25 due deliveries per tick. Network interruptions can produce duplicate delivery. The delivery log retains attempts and their outcomes; after the automatic sequence finishes, an owner or admin may explicitly approve a replay that keeps the event ID and links to the original delivery.

Approver revocation or changed account authority holds delivery until a new endpoint is explicitly approved. Archives omit signing keys, endpoint approvals and delivery state; restored installations configure their own subscriptions. Donor erasure removes associated webhook identifiers and delivery history. The policy defaults remain subject to ct approval; API-002 stays partial until that ruling.

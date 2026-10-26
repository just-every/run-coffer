# Public REST API

Open Settings → Public API keys as an owner or admin. Choose a label, an explicit
scope and an optional expiry date. Read only is the initial choice. Copy the key
when shown; only its hash is retained. Revoking a key or changing its creator's
account version, role or active state stops it immediately. The default expiry
is 30 days and the maximum is 90 days. Public keys are separate from agent keys,
and no public key can create another credential.

Use the Bearer authorization scheme under `/api/coffer/v1`. The authenticated
`/api/coffer/v1/openapi.json` route serves the OpenAPI 3.1 document with schemas,
resource paths, request bodies and response envelopes. Native signed-in sessions
can also use these routes under their existing role and same-origin rules.

Gift reads use the native contribution ledger, including processor refund
adjustments and property gifts; property values remain separate from monetary
contribution amounts.

The implemented scope default is conservative and awaits ct approval:

- Read only reads current constituents, gifts, pledges, plans, interactions,
  tasks, opportunities, funds, campaigns and soft credits. Constituent reads
  include current consent, status and solicitation restrictions.
- Gift entry reads constituents, gifts, pledges, funds and campaigns and records
  gifts against current donors. It cannot change constituent facts or settings.
- Full adds only the documented local record operations: constituent creation,
  versioned updates and status, non-email consent, solicitation restrictions,
  gift and soft-credit acknowledgment, pledges, interactions, tasks,
  opportunities, funds and inactive campaign drafts. Current native role,
  version, donor custody and solicitation guards still apply.

There is no public provider-send, credential administration, export, merge,
erasure, campaign-publication or plan-mutation operation. Gift entry refuses
while published gift rules would require additional effects. Constituent entry
refuses while address processing requires a provider call. Email consent uses
the native synchronization door. API-created pledges have an explicit held state
for automatic reminder and follow-up email; releasing it remains unimplemented.
Previously approved webhook subscriptions still receive identifier-only native
events under their current endpoint approval and signing guards.

Every documented data write requires `Idempotency-Key`. Its binding to the
principal, method, route and canonical JSON, the native writes and its
identifier-only result commit in one database transaction. The same request
returns the original identifier; a changed request with that key returns 409.
Receipts have no automatic expiry so a delayed gift retry cannot duplicate money.
Associated receipts are removed during donor erasure. No request or response body
is stored in a receipt. Key creation is a native-session credential action whose
secret is shown once, outside the replayable data-write door.

The shared durable limit is 120 requests per principal per minute. Exceeding it
returns 429 and Retry-After. Collections use bounded identifier-cursor pages.
Keys, counters and idempotency receipts stay installation-specific and are
excluded from archives. Native product records and pledge mail holds are portable.

Acknowledgment status reads include the status, version, date, method and link.
The existing receipt authority remains intact: owner, admin and member may mark
acknowledged or reset; only owner or admin may mark do not acknowledge with a
reason. Agent credentials cannot use these writes. Gift and soft-credit statuses
are independent, stale versions refuse, and reason or note text never enters
the acknowledgment audit.

API-001 remains partial pending ct approval of the scope and credential-custody
defaults and the named provider-operation gaps in CONTRACT.md.

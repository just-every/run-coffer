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

The implemented scope default is conservative and approved with riders by ct:

- Read only reads current constituents, gifts, pledges, plans, interactions,
  tasks, opportunities, funds, campaigns and soft credits. Constituent reads
  include current consent, status and solicitation restrictions.
- Gift entry reads constituents, gifts, pledges, funds and campaigns and records
  gifts against current donors. It cannot change constituent facts or settings.
- Full adds only the documented local record operations: constituent creation,
  versioned updates and status, synchronized consent, solicitation restrictions,
  gift and soft-credit acknowledgment, pledges, interactions, tasks,
  opportunities, funds and inactive campaign drafts. Current native role,
  version, donor custody and solicitation guards still apply.

There is no public provider-send, credential administration, export, merge,
erasure, campaign-publication or plan-mutation operation. Gift entry uses the native durable once-only published rules.
Constituent entry uses enabled native address verification; a provider failure
leaves the donor unchanged. Email consent uses native sender synchronization,
preserving provider opt-outs and holding sending when synchronization is pending.
API-created pledges hold automatic reminder and follow-up email until a current
owner or admin reviews the pledge, schedule and reminder wording on the donor
page and explicitly releases the hold. Release sends nothing. API campaign drafts
appear in Giving for native current-snapshot review and publication. Plan
changes use their existing native authorization and confirmation doors.
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

Ct approved the scope and credential-custody defaults with riders on 26 October 2026 at pin 3bff3d085ae0e39f8a59b6c6c5593ec705b42b66. At that dated ruling, API-001 was partial for the API-origin provider-door gaps then named in CONTRACT.md; the subsequent workflows below close those gaps. Idempotency receipts are scoped to the recorded principal and installation; replacement credentials or archive restoration do not carry an asserted replay-continuity guarantee.

The subsequent native workflows close the API-origin Gaps from that dated ruling: approved address processing, synchronized email consent, once-only published gift rules, native pledge email review and release, native draft publication and approved native plan transitions. API-001 is now DONE for its retained target; provider edges in its HTTP acceptance remain faked.

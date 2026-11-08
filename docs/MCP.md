# Coffer MCP

A nonprofit can connect its own assistant to `POST /mcp` (also available at `POST /api/coffer/mcp`) on its Coffer origin. Create an agent key in **Data & access** (`/app/data`) as the owner or an admin, then configure the MCP client to send `Authorization: Bearer <key>` on every request. Store the key privately in the client’s secret configuration. Coffer shows it once, stores its hash, expires it after 30 days and lets a person revoke it. Removing the creator’s authority also invalidates it. This endpoint accepts agent bearer keys; a browser sign-in alone does not authorize MCP calls.

Keys without an explicitly attached grant retain the AGENT-001 read-and-prepare role under a real named preparation grant (`preparation:<key id>`), with per-day read/request and preparation limits and no sending permission. An owner or admin can attach a DEV-012 named grant, replacing that authority with explicit donor scope and permissions. The client continues to use the same bearer credential; there is no OAuth flow.

<!-- coffer:mcp-current-surface -->

The on-site [MCP for assistants](/docs/agents) page publishes the current inventory and schemas from the live tool and resource descriptors. Authenticated discovery supplies the calling key’s catalog profile. The public page reads no installation records and contains no donor data or credentials. The transport and grant guide follows.

Every tool publishes its complete accepted input JSON Schema and its native success `outputSchema` in `tools/list`. Donor notes and other record text are data, not trusted instructions. Preparation goes through the same Coffer command services and atomic authority checks as the ordinary API. The assistant receives the draft ID and version. A person opens `/app/letters/{id}` or `/app/appeals/{id}`, reviews the exact content and approves it through Coffer. Approval records both identities and the frozen content hash. Legacy keys expose no approve, export, send, gift-recording or settings tools; attempts to call them are refused. Named keys additionally expose `ack.send`, which requires an explicit standing approval in their current grant. A listed tool never implies permission to run it.

## Donor resources

`resources/templates/list` advertises one `donor` template: the installation's canonical origin followed by `/api/coffer/donors/{donorId}`. Template discovery is deterministic with `ttlMs: 0` and `cacheScope: "private"`. `resources/list` returns an empty list; discover records with `donors.list`, then follow its links. Both read tools append `resource_link` content for their returned donors while retaining their original JSON text and unchanged `structuredContent`. A context link uses the surviving identifier when the native preparation-key read resolves a merge.

Call `resources/read` with `{ "uri": "<URI from a resource_link>" }` and the usual authenticated request metadata. Its `contents` contains one `application/json` text item whose parsed value exactly equals `donors.context` and the native donor HTTP read for that same key. Preparation keys retain their existing native projection, canonical merge resolution and erasure behavior. Explicit named keys reuse the existing direct-facts projection and require `donors.context` permission; listing permission alone grants no context access. They never follow a merged alias, traverse related donors or recover an erased donor. Resource links grant no authority of their own.

Missing, out-of-scope, erased named records, unavailable context permission and unsupported resource URIs return the same JSON-RPC error (`-32002`, `Resource not found.`), without contents or scope details. URIs must exactly match this installation and template: a different origin, other record paths, query, fragment or noncanonical encoding is unavailable. Coffer never fetches a resource URL. Malformed parameters return `-32602`. Discovery and reads use the current key authority, kill switch, request quota and access audit; revocation applies to the next read. Resources work with both supported protocol versions.

Templates, links and returned content carry `_meta: { "untrusted": true }`. All customer and imported text in the projection is untrusted data and cannot authorize another action or change scope. This slice adds no other record templates, links from mutating tools, record-file access, grant byte budgets, broader staff-role parity or shared Base identity and policy integration. Those BASE-AGENT-003 obligations remain owed; existing document refusals and named-grant exclusions remain in force.

## Wire protocol

The endpoint implements stateless Streamable HTTP with JSON responses. Send one JSON-RPC 2.0 request per POST with `Content-Type: application/json` and `Accept: application/json, text/event-stream`. Responses are `application/json`; this server does not offer SSE streams or assign session IDs. GET, DELETE and other methods return 405 with `Allow: POST`. Bodies are limited to 1 MiB. A supplied Origin must match the Coffer origin. Authentication is checked on every request, including discovery.

The current supported revision is **2026-07-28**. Each request includes `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method` matching the RPC method, and `Mcp-Name` matching the tool name for `tools/call`. Include `params._meta['io.modelcontextprotocol/protocolVersion']` with the same revision and `params._meta['io.modelcontextprotocol/clientCapabilities']` as an object. Client identity metadata is optional. `server/discover` returns supported versions, capabilities and server identity. Modern results include `resultType: "complete"`. No initialization handshake is needed in this revision.

For example, the body of a current donor-list request is:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "donors.list",
    "arguments": { "q": "Rivera", "page": 0 },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

Use `Mcp-Method: tools/call` and `Mcp-Name: donors.list` with that body. Tool successes return the native result as `structuredContent` and matching JSON text in `content`. Native business-rule failures return `isError: true`; malformed requests, missing tools and unsupported methods return JSON-RPC errors. Unsupported revisions return the supported-version list; mismatched required headers are refused.

The endpoint also supports **2025-11-25** for established MCP clients: send `initialize` with `protocolVersion`, `clientInfo` and `capabilities`, then `notifications/initialized`. Send `MCP-Protocol-Version: 2025-11-25` on subsequent requests. Accepted legacy notifications return 202 with no body. `ping`, `tools/list` and `tools/call` work without a stored session. Unknown initialization revisions are negotiated to the supported legacy revision; the client must verify the returned version. Modern requests do not implement legacy `initialize` or `ping`.

The implementation follows the primary [current versioning rules](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), and [legacy lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

## Named grants (DEV-012)

Manage grants as an owner/admin through `GET /api/coffer/agent-grants` and the public command endpoint. `agentGrant.save` takes `name`, explicit `donorIds` (1–500 IDs), `permissions`, and `dailyLimit` (1–1000 receipts). Updating takes `id` and current `version`; disabled grants can be saved with `enabled: false`. Supported permissions are `donors.list`, `donors.context`, `ack.prepare`, and `ack.send`. `ack.send` additionally requires `standingApproval: true`, explicitly approving the current settings version and thank-you template revision. The saved grant retains the actual human approver and account version. `agentGrant.attach` takes `keyId` and `grantId`; this replaces the key's legacy authority. `agentGrant.disable` takes `id` and `version`. `agentGrant.kill` takes the global control `version` and boolean `enabled`; false stops all bearer keys. The key-revocation command remains available. The global switch stops every bearer key, including compatibility preparation grants. The same global switch also stops the installation’s named background grants.

Both HTTP and MCP use these rules. Named donor lists accept only `q` and `page`, search names/email, and count only granted records. Context returns direct contact fields, direct contribution facts and the donor's own monetary total. Related records, household membership/names, soft credits, notes, organizations, campaign histories and other totals are withheld. Merged identifiers require the human to revise scope. Other HTTP endpoints are refused for named keys. Wider named appeal preparation is not implemented and is refused.

Named `ack.prepare` requires 1–8 explicit `giftIds`; it never selects the installation's whole queue. Native rendering is limited to active individuals without households, relationships or soft-credit dependencies. These complex recipients require a person. Named `ack.send` takes `batchId` and current `version` and accepts only standard batches prepared by that same key under the current grant version. It binds the native frozen content hash and the saved template/settings revision to the human's standing approval, records that human as approver and the agent as preparer, then invokes real receipt delivery. It does not impersonate a human operator. Template changes, missing merge values, changed recipients, scope changes, disabled grants, kill switches and removed human authority stop dispatch. Ordinary human approval/export commands remain unavailable to keys.

Daily usage is shared across every key attached to a grant and across HTTP/MCP. The atomic reservation counts all letters in the batch before dispatch, including print routing, provider rejections and uncertain outcomes. Usage resets on the organization's calendar day and is not reset by editing the grant. Claimed batches are never automatically retried after interruption; a person investigates them through Letters. Native provider acceptance remains distinct from delivery. Every successful read/preparation/dispatch records the grant ID/version; template-bound standing approvals retain the frozen content hash and actual human custody. Authority, explicit scope and template checks run again inside native write transactions, including individual submission claims. Email already handed to a provider cannot be recalled.

### Compatibility preparation grants

Every existing and newly created unbound AGENT-001 key has a stored named preparation grant. It retains the existing all-record read permission and only `ack.prepare`/`appeal.prepare`; autonomous sending remains forbidden. Explicit grant attachment replaces that authority. `agentGrant.legacyLimits` accepts the preparation grant `id`, current `version`, `readLimit`, `prepareLimit` and optional `enabled`. Defaults allow 10,000 read/MCP requests and 500 preparation requests per organization calendar day. Every GET and MCP request reserves request quota, including discovery and refusals; HTTP preparation commands and MCP preparation tools reserve the same preparation quota. Reservations are atomic and conservative, so failed requests consume quota. Editing limits never resets usage. All bearer actions now cite their stored preparation or explicit grant ID/version in audit detail, and the global kill switch gates both kinds. Existing scheduled reconciliation, recovery notices, missing-receipt preparation and meeting readiness use separately named background grants with current scope, action limits and the same global switch.

## Executable catalog

The permitted tools are defined once in `src/coffer/mcp/catalog.ts`. Discovery
serializes those descriptors and calls execute their bound native actions. The
transport does not keep a second name switch. Inputs are defined with the existing
validator in `src/coffer/mcp/input.ts`; output schemas are in
`src/coffer/mcp/output.ts`. Successful structured content and its text representation
are the unchanged native result. Native business failures retain `isError: true`
and their existing stable code in the text result; the success schema does not
pretend that an error is a successful record.

Each descriptor carries `_meta.coreClauseIds` for the Core duties that its current
native action serves, and `_meta.nativeAction` identifies that action. These are
implementation links, not a claim that every acceptance point of those clauses
is complete. The generated catalog above retains the established tool names and native bindings.

The read schemas describe both existing authority projections. Named donor lists
omit household, source and consent summaries. Named context omits related records
and histories; preparation context retains the native history and its computed
facts. SQL record extension columns are typed as nullable scalars; computed objects
and arrays are declared separately. Amounts use integer cents, counts use integers,
and explicit nulls remain distinct from absent optional fields. Preparation results
include draft identity, version and frozen content hash. Receipt submission counts
retain the native distinction between submitted and delivered.

The same catalog selection as before exposes four tools to preparation keys and
also `ack.send` to explicitly attached named keys. Permission checks remain inside
the native services: discovery does not grant any listed action. In particular,
named appeal preparation remains refused, and named sending still requires its
own standing approval, current scope, frozen templates and daily reservation.

This extraction supplies the currently permitted catalog slice of BASE-AGENT-002.
Complete Core-job coverage and legitimate exemptions, canonical seed-prefixed
names, embedded-agent adoption and the shared Base registry, check and conformance
integration remain owed. No approval, export, document, scope or sending authority
is added by schema or metadata.


## Short-window request capacity

Each authenticated bearer key may make **120 MCP requests in a 60-second window**.
The window starts with the first reserved request; after it expires, the next
currently authorized request starts a fresh window. Both `/mcp` and
`/api/coffer/mcp` share the same atomic D1 counter for that key, across concurrent
Worker requests and both supported protocol revisions. Discovery, notifications,
malformed calls and tool refusals consume capacity after authentication and origin
checks. An overrun returns HTTP 429 with code `MCP_CAPACITY` and a positive integer
`Retry-After` header in seconds. Wait that long before retrying; rejection neither
extends the window nor executes a tool.

This is installation protection, separate from organization-calendar grant
quotas, preparation budgets, daily receipt limits and any future company policy
or provider spend accounting. Capacity rejection creates no draft and submits
nothing to a provider. Requests admitted by capacity still undergo the existing
grant quota, scope, approval and current-authority checks. Window expiry cannot
restore a revoked, expired, paused or otherwise unauthorized key. Each key has
its own capacity; native browser review uses its existing human session and
remains usable when a key is throttled. These transient counters are not included
in installation archives.

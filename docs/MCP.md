# Coffer MCP

A nonprofit can connect its own assistant to `POST /api/coffer/mcp` on its Coffer origin. Create an agent key in **Data & access** (`/app/data`) as the owner or an admin, then configure the MCP client to send `Authorization: Bearer <key>` on every request. Store the key privately in the client’s secret configuration. Coffer shows it once, stores its hash, expires it after 30 days and lets a person revoke it. Removing the creator’s authority also invalidates it. This endpoint accepts agent bearer keys; a browser sign-in alone does not authorize MCP calls.

Keys without an explicitly attached grant retain the AGENT-001 read-and-prepare role under a real named preparation grant (`preparation:<key id>`), with per-day read/request and preparation limits and no sending permission. An owner or admin can attach a DEV-012 named grant, replacing that authority with explicit donor scope and permissions. The client continues to use the same bearer credential; there is no OAuth flow.

The shared door is `POST /mcp`; `/api/coffer/mcp` is its native-key alias. The canonical audience is always the origin followed by `/mcp`. Signed Business access and the existing hashed native keys use the same registry, decisions, approval controls, pause and audit. The owner must adopt a complete company policy at `/agents` before any work runs; an unanswered policy returns `policy_unset`. No dispositions are supplied by Coffer.

The core registry is:

| Tool | Scope | Class | Native job / clauses |
| --- | --- | --- | --- |
| `coffer.donors.list` | `coffer:donors.list` | standard | Search and page native donors; DONOR-001, BASE-AGENT-002. |
| `coffer.donors.get` | `coffer:donors.context` | sensitive | Read native donor context; DONOR-004, BASE-AGENT-002. Raw context is conservatively personal-sensitive; a named grant retains its smaller projection. |
| `coffer.ack.prepare` | `coffer:ack.prepare` | standard | Freeze explicit eligible gifts for a human; ACK-001, BASE-AGENT-002. Select 1–500 gift IDs; named receipt grants retain their native 1–8 bound. |
| `coffer.appeal.prepare` | `coffer:appeal.prepare` | standard | Save a consent-checked audience and optional wording; APPEAL-001, BASE-AGENT-002. No sending or approval. |
| `coffer.ack.send` | `coffer:ack.send` | external | Dispatch only the same key's own standard batch under its native human standing grant; DEV-012, BASE-AGENT-002. The actual pending recipient count is computed on the server. |
| `coffer.workspace.snapshot` | `coffer:donors.list` | standard | Read an opaque native effect fingerprint; BASE-AGENT-012. |

Every tool publishes its accepted input/output JSON Schemas and clauses in `tools/list`. Names are seed-prefixed; old unprefixed MCP names are no longer accepted. Every mutation requires a stable `idempotency_key`; a changed proposal needs a new key, and replay never resubmits an uncertain provider outcome. Receipt sends also accept `expected_revision` alongside their native batch `version`. Ordinary approval, export, settings and grant-administration verbs remain unavailable to agents. A listed tool does not grant its scope. Business policy cannot manufacture a native standing receipt grant or a person's approval.

The native HTTP agent paths for donor lists/context and preparation/standing receipt commands enter this same dispatcher. Mutating HTTP clients send `Idempotency-Key`. Other native HTTP agent paths refuse. Native sessions, SDK/API keys, provider callbacks, connector credentials and import doors retain their own purposes.

Business subjects resolve through the signed settings owner/team IDs to current native operator IDs. Email never selects another operator. The existing owner remains the owner; a signed Business team admin maps to the native admin and Business editor, while a team member has no Business policy role. Unknown, inactive or excluded native people cannot sponsor a call. Changing the email invalidates an old token rather than moving its binding. Approval execution rechecks native people, scopes, grant versions, policy and consent; native transactions fence those snapshots again.

The declared capabilities are tools, policy, pause, audit and idempotency. Resources, prompts, events and subscriptions are undeclared and return typed refusals; no resource or specialist-prompt coverage is claimed. Imports and installation remain their own doors, and marketing connectors are not replaced. The larger draft fundraising surface and existing scheduled background grants are not claimed as fully adopted. Spend reservations, provider cost, queued continuation and broader fundraising tools remain outside this core adoption.

## Wire protocol

The endpoint implements stateless Streamable HTTP with JSON responses. Send one JSON-RPC 2.0 request per POST with `Content-Type: application/json` and `Accept: application/json, text/event-stream`. Responses are `application/json`; this server does not offer SSE streams or assign session IDs. GET, DELETE and other methods return 405 with `Allow: POST`. Bodies are limited to 1 MiB. A supplied Origin must match the Coffer origin. Canonical discovery is public; authenticated calls recheck current authority. The native-key alias retains credential admission before parsing.

The current supported revision is **2026-07-28**. Each request includes `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method` matching the RPC method, and `Mcp-Name` matching the tool name for `tools/call`. Include `params._meta['io.modelcontextprotocol/protocolVersion']` with the same revision and `params._meta['io.modelcontextprotocol/clientCapabilities']` as an object. Client identity metadata is optional. `server/discover` returns supported versions, capabilities and server identity. Modern results include `resultType: "complete"`. No initialization handshake is needed in this revision.

For example, the body of a current donor-list request is:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "coffer.donors.list",
    "arguments": { "q": "Rivera", "page": 0 },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

Use `Mcp-Method: tools/call` and `Mcp-Name: coffer.donors.list` with that body. Tool successes return the native result as `structuredContent` and matching JSON text in `content`. Native business-rule failures return `isError: true`; malformed requests, missing tools and unsupported methods return JSON-RPC errors. Unsupported revisions return the supported-version list; mismatched required headers are refused.

The endpoint also supports **2025-11-25** for established MCP clients: send `initialize` with `protocolVersion`, `clientInfo` and `capabilities`, then `notifications/initialized`. Send `MCP-Protocol-Version: 2025-11-25` on subsequent requests. Accepted legacy notifications return 202 with no body. `ping`, `tools/list` and `tools/call` work without a stored session. Unknown initialization revisions are negotiated to the supported legacy revision; the client must verify the returned version. Modern clients use discovery; `ping` is a legacy operation.

The implementation follows the primary [current versioning rules](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), and [legacy lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

## Named grants (DEV-012)

Manage grants as an owner/admin through `GET /api/coffer/agent-grants` and the public command endpoint. `agentGrant.save` takes `name`, explicit `donorIds` (1–500 IDs), `permissions`, and `dailyLimit` (1–1000 receipts). Updating takes `id` and current `version`; disabled grants can be saved with `enabled: false`. Supported permissions are `donors.list`, `donors.context`, `ack.prepare`, and `ack.send`. `ack.send` additionally requires `standingApproval: true`, explicitly approving the current settings version and thank-you template revision. The saved grant retains the actual human approver and account version. `agentGrant.attach` takes `keyId` and `grantId`; this replaces the key's legacy authority. `agentGrant.disable` takes `id` and `version`. `agentGrant.kill` takes the global control `version` and boolean `enabled`; false stops all bearer keys. The key-revocation command remains available. The global switch stops every bearer key, including compatibility preparation grants. The same global switch also stops the installation’s named background grants.

Both HTTP and MCP use these rules. Named donor lists accept only `q` and `page`, search names/email, and count only granted records. Context returns direct contact fields, direct contribution facts and the donor's own monetary total. Related records, household membership/names, soft credits, notes, organizations, campaign histories and other totals are withheld. Merged identifiers require the human to revise scope. Other HTTP endpoints are refused for named keys. Wider named appeal preparation is not implemented and is refused.

Named `ack.prepare` requires 1–8 explicit `giftIds`; it never selects the installation's whole queue. Native rendering is limited to active individuals without households, relationships or soft-credit dependencies. These complex recipients require a person. Named `ack.send` takes `batchId` and current `version` and accepts only standard batches prepared by that same key under the current grant version. It binds the native frozen content hash and the saved template/settings revision to the human's standing approval, records that human as approver and the agent as preparer, then invokes real receipt delivery. It does not impersonate a human operator. Template changes, missing merge values, changed recipients, scope changes, disabled grants, kill switches and removed human authority stop dispatch. Ordinary human approval/export commands remain unavailable to keys.

Daily usage is shared across every key attached to a grant and across HTTP/MCP. The atomic reservation counts all letters in the batch before dispatch, including print routing, provider rejections and uncertain outcomes. Usage resets on the organization's calendar day and is not reset by editing the grant. Claimed batches are never automatically retried after interruption; a person investigates them through Letters. Native provider acceptance remains distinct from delivery. Every successful read/preparation/dispatch records the grant ID/version; template-bound standing approvals retain the frozen content hash and actual human custody. Authority, explicit scope and template checks run again inside native write transactions, including individual submission claims. Email already handed to a provider cannot be recalled.

### Compatibility preparation grants

Every existing and newly created unbound AGENT-001 key has a stored named preparation grant. It retains the existing all-record read permission and only `ack.prepare`/`appeal.prepare`; autonomous sending remains forbidden. Explicit grant attachment replaces that authority. `agentGrant.legacyLimits` accepts the preparation grant `id`, current `version`, `readLimit`, `prepareLimit` and optional `enabled`. Defaults allow 10,000 read/MCP requests and 500 preparation requests per organization calendar day. Every successful native donor read reserves read quota; HTTP preparation commands and MCP preparation tools reserve the same preparation quota. Reservations are atomic and conservative, so failed requests consume quota. Editing limits never resets usage. All bearer actions now cite their stored preparation or explicit grant ID/version in audit detail, and the global kill switch gates both kinds. Existing scheduled reconciliation, recovery notices, missing-receipt preparation and meeting readiness use separately named background grants with current scope, action limits and the same global switch.

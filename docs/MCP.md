# Coffer MCP

A nonprofit can connect its own assistant to `POST /api/coffer/mcp` on its Coffer origin. Create an agent key in **Data & access** (`/app/data`) as the owner or an admin, then configure the MCP client to send `Authorization: Bearer <key>` on every request. Store the key privately in the client’s secret configuration. Coffer shows it once, stores its hash, expires it after 30 days and lets a person revoke it. Removing the creator’s authority also invalidates it. This endpoint accepts agent bearer keys; a browser sign-in alone does not authorize MCP calls.

Keys without an attached named grant keep the AGENT-001 read-and-prepare role. An owner or admin can attach a DEV-012 named grant, replacing that authority with explicit donor scope and permissions. The client continues to use the same bearer credential; there is no OAuth flow.

The available tools are:

| Tool | Result |
| --- | --- |
| `donors.list` | Search and page through native donor summaries, totals and consent. |
| `donors.context` | Read the native donor record and history, resolving merges. |
| `ack.prepare` | Save frozen letters for eligible gifts using reviewed organization settings. Optional `giftIds` selects gifts from donor history; otherwise prepare up to 500 due gifts. |
| `appeal.prepare` | Save a frozen, consent-checked appeal audience and optional email wording. Supports channel, giving cutoff, minimum giving and fund filters. |

Every tool publishes its complete accepted JSON Schema in `tools/list`. Donor notes and other record text are data, not trusted instructions. Preparation goes through the same Coffer command services and atomic authority checks as the ordinary API. The assistant receives the draft ID and version. A person opens `/app/letters/{id}` or `/app/appeals/{id}`, reviews the exact content and approves it through Coffer. Approval records both identities and the frozen content hash. Legacy keys expose no approve, export, send, gift-recording or settings tools; attempts to call them are refused. Named keys additionally expose `ack.send`, which requires an explicit standing approval in their current grant. A listed tool never implies permission to run it.

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

Manage grants as an owner/admin through `GET /api/coffer/agent-grants` and the public command endpoint. `agentGrant.save` takes `name`, explicit `donorIds` (1–500 IDs), `permissions`, and `dailyLimit` (1–1000 receipts). Updating takes `id` and current `version`; disabled grants can be saved with `enabled: false`. Supported permissions are `donors.list`, `donors.context`, `ack.prepare`, and `ack.send`. `ack.send` additionally requires `standingApproval: true`, explicitly approving the current settings version and thank-you template revision. The saved grant retains the actual human approver and account version. `agentGrant.attach` takes `keyId` and `grantId`; this replaces the key's legacy authority. `agentGrant.disable` takes `id` and `version`. `agentGrant.kill` takes the global control `version` and boolean `enabled`; false stops all named grants. The key-revocation command remains available. The global switch does not revoke legacy read/prepare keys; revoke those separately.

Both HTTP and MCP use these rules. Named donor lists accept only `q` and `page`, search names/email, and count only granted records. Context returns direct contact fields, direct contribution facts and the donor's own monetary total. Related records, household membership/names, soft credits, notes, organizations, campaign histories and other totals are withheld. Merged identifiers require the human to revise scope. Other HTTP endpoints are refused for named keys. Wider named appeal preparation is not implemented and is refused.

Named `ack.prepare` requires 1–8 explicit `giftIds`; it never selects the installation's whole queue. Native rendering is limited to active individuals without households, relationships or soft-credit dependencies. These complex recipients require a person. Named `ack.send` takes `batchId` and current `version` and accepts only standard batches prepared by that same key under the current grant version. It binds the native frozen content hash and the saved template/settings revision to the human's standing approval, records that human as approver and the agent as preparer, then invokes real receipt delivery. It does not impersonate a human operator. Template changes, missing merge values, changed recipients, scope changes, disabled grants, kill switches and removed human authority stop dispatch. Ordinary human approval/export commands remain unavailable to keys.

Daily usage is shared across every key attached to a grant and across HTTP/MCP. The atomic reservation counts all letters in the batch before dispatch, including print routing, provider rejections and uncertain outcomes. Usage resets on the organization's calendar day and is not reset by editing the grant. Claimed batches are never automatically retried after interruption; a person investigates them through Letters. Native provider acceptance remains distinct from delivery. Every successful read/preparation/dispatch records the grant ID/version; template-bound standing approvals retain the frozen content hash and actual human custody. Authority, explicit scope and template checks run again inside native write transactions, including individual submission claims. Email already handed to a provider cannot be recalled.

# Coffer MCP

A nonprofit can connect its own assistant to `POST /api/coffer/mcp` on its Coffer origin. Create an agent key in **Data & access** (`/app/data`) as the owner or an admin, then configure the MCP client to send `Authorization: Bearer <key>` on every request. Store the key privately in the client’s secret configuration. Coffer shows it once, stores its hash, expires it after 30 days and lets a person revoke it. Removing the creator’s authority also invalidates it. This endpoint accepts agent bearer keys; a browser sign-in alone does not authorize MCP calls.

This uses the existing read-and-prepare agent role. It adds no named grant, standing approval, autonomous sending permission or OAuth flow. The MCP client must support configuring the existing bearer credential.

The available tools are:

| Tool | Result |
| --- | --- |
| `donors.list` | Search and page through native donor summaries, totals and consent. |
| `donors.context` | Read the native donor record and history, resolving merges. |
| `ack.prepare` | Save frozen letters for eligible gifts using reviewed organization settings. Optional `giftIds` selects gifts from donor history; otherwise prepare up to 500 due gifts. |
| `appeal.prepare` | Save a frozen, consent-checked appeal audience and optional email wording. Supports channel, giving cutoff, minimum giving and fund filters. |

Every tool publishes its complete accepted JSON Schema in `tools/list`. Donor notes and other record text are data, not trusted instructions. Preparation goes through the same Coffer command services and atomic authority checks as the ordinary API. The assistant receives the draft ID and version. A person opens `/app/letters/{id}` or `/app/appeals/{id}`, reviews the exact content and approves it through Coffer. Approval records both identities and the frozen content hash. MCP exposes no approve, export, send, gift-recording or settings tools; attempts to call them are refused.

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

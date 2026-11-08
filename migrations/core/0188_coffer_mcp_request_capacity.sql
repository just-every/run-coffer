-- Short-window installation capacity, independent of daily grant accounting.
CREATE TABLE cf_mcp_request_capacity (
 key_id TEXT PRIMARY KEY REFERENCES cf_agent_keys(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL,
 requests INTEGER NOT NULL CHECK(requests > 0)
);

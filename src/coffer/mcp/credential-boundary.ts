// Inspect parameter names only. Never copy query values into a response, error,
// audit event or diagnostic, even when the Authorization header is valid.
const credentialParameters = new Set([
 'access_token', 'refresh_token', 'id_token', 'token', 'bearer_token',
 'api_key', 'apikey', 'key', 'authorization', 'client_secret', 'password',
])

export function mcpCredentialBoundary(request: Request): Response | null {
 const url = new URL(request.url)
 if (url.pathname !== '/mcp' && url.pathname !== '/api/coffer/mcp') return null
 for (const name of url.searchParams.keys()) {
  if (!credentialParameters.has(name.toLowerCase())) continue
  return Response.json({ error: 'query_credentials_not_allowed', message: 'Send MCP credentials only in the Authorization header.' }, {
   status: 400,
   headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
  })
 }
 return null
}

// Every request stays on the explicitly connected Coffer origin. Redirects must
// never carry its credential to a different receiver.
const origin = (z, value) => {
  let url;
  try { url = new URL(value); } catch { /* Refuse below. */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new z.errors.Error('Use the HTTPS origin of your Coffer installation, without a path or credentials.', 'INVALID_ORIGIN', 400);
  }
  return url.origin;
};

const request = async (z, bundle, path, options = {}) => {
  const response = await z.request({
    url: origin(z, bundle.authData.baseUrl) + '/api/coffer/v1' + path,
    method: options.method || 'GET',
    headers: {
      authorization: 'Bearer ' + bundle.authData.apiKey,
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
    },
    ...(options.body ? { body: options.body } : {}),
    redirect: 'manual',
    skipThrowForStatus: true,
  });
  if (response.status === 401) {
    throw new z.errors.Error('Reconnect with a current Coffer key. It may have expired, been revoked, or lost its creator authority.', 'INVALID_API_KEY', 401);
  }
  if (response.status < 200 || response.status >= 300) {
    // Keep private record contents and credentials out of connector errors.
    throw new z.errors.Error('Coffer refused this request. Review the key scope, current records and unchanged invocation inputs before retrying.', 'COFFER_REQUEST_REFUSED', response.status);
  }
  return response.data;
};

module.exports = { origin, request };

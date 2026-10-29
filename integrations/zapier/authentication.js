const { origin, request } = require('./api');

const test = async (z, bundle) => {
  await request(z, bundle, '/openapi.json');
  return { id: origin(z, bundle.authData.baseUrl) };
};

module.exports = {
  type: 'custom',
  fields: [
    { key: 'baseUrl', label: 'Coffer Installation', type: 'string', required: true,
      helpText: 'The HTTPS origin of your installation, with no path, query or fragment.' },
    { key: 'apiKey', label: 'Existing API Key', type: 'password', required: true,
      helpText: 'Create a full local API key in Coffer using your native owner or admin session. This connection cannot create or manage keys.' },
  ],
  test,
  connectionLabel: '{{bundle.authData.baseUrl}}',
};

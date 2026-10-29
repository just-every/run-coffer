const { request, invocation, invocationField } = require('../api');

// Each entry is a named existing API operation, never a caller-supplied route.
const definitions = [
  ['create_donor', 'Create Constituent', 'Constituent', 'POST', '/donors'],
  ['create_gift', 'Record Gift', 'Gift', 'POST', '/gifts'],
  ['create_pledge', 'Create Held Pledge', 'Pledge', 'POST', '/pledges'],
  ['create_interaction', 'Record Interaction', 'Interaction', 'POST', '/interactions'],
  ['create_opportunity', 'Create Opportunity', 'Opportunity', 'POST', '/opportunities'],
  ['create_fund', 'Define Fund', 'Fund', 'POST', '/funds'],
  ['create_campaign', 'Create Draft Campaign', 'Campaign', 'POST', '/campaigns'],
  ['create_soft_credit', 'Record Soft Credit', 'Soft Credit', 'POST', '/soft-credits'],
  ['update_donor', 'Replace Constituent Contact', 'Constituent', 'PUT', '/donors/{id}'],
  ['update_opportunity', 'Update Opportunity', 'Opportunity', 'PUT', '/opportunities/{id}'],
  ['set_solicitation', 'Set Solicitation Restriction', 'Restriction', 'PUT', '/donors/{id}/solicitation'],
  ['set_status', 'Set Constituent Status', 'Status', 'PUT', '/donors/{id}/status'],
  ['record_consent', 'Record Consent Evidence', 'Consent', 'POST', '/donors/{id}/consents'],
  ['gift_acknowledgment', 'Set Gift Acknowledgment', 'Acknowledgment', 'PUT', '/gifts/{id}/acknowledgment'],
  ['soft_credit_acknowledgment', 'Set Soft Credit Acknowledgment', 'Acknowledgment', 'PUT', '/soft-credits/{id}/acknowledgment'],
  ['assign_task', 'Assign Task', 'Task', 'PUT', '/tasks/{id}/assignment'],
  ['snooze_task', 'Snooze Task', 'Task', 'PUT', '/tasks/{id}/snooze'],
  ['complete_task', 'Complete Task', 'Task', 'PUT', '/tasks/{id}/completion'],
];
const schemaFor = async (z, bundle, method, path) => {
  const doc = await request(z, bundle, '/openapi.json');
  let schema = doc.paths[path][method.toLowerCase()].requestBody.content['application/json'].schema;
  if (schema.$ref) schema = doc.components.schemas[schema.$ref.split('/').pop()];
  return schema;
};
const complex = schema => schema.type === 'array' || schema.type === 'object';
const recordFields = (method, path) => async (z, bundle) => {
  const schema = await schemaFor(z, bundle, method, path);
  return Object.entries(schema.properties).map(([key, property]) => ({
    key, label: key.replace(/([A-Z])/g, ' $1'), required: schema.required.includes(key),
    type: property.type === 'integer' ? 'integer' : property.type === 'boolean' ? 'boolean' : 'string',
    ...(property.enum ? {choices: property.enum} : {}),
    helpText: complex(property) ? 'A JSON value matching the installation OpenAPI schema. No omitted schedule, allocation or permission is inferred.' :
      key === 'version' ? 'The exact current native record version. Refresh after a conflict.' :
      key === 'name' && method === 'PUT' ? 'Full replacement: omitted contact fields are cleared, as documented by the native API.' :
      'Uses the existing native API validation and authority. Dates use YYYY-MM-DD; money uses whole cents.',
  }));
};
module.exports = Object.fromEntries(definitions.map(([key, label, noun, method, path]) => [key, {
  key, noun, display: { label, description: 'Runs the named native local operation with current authority and stable per-key replay. It grants no direct sending or charging authority.' },
  operation: {
    inputFields: [invocationField, ...(path.includes('{id}') ? [{key: 'recordId', label: 'Current Record ID', type: 'string', required: true}] : []), recordFields(method, path)],
    perform: async (z, bundle) => {
      const idempotencyKey = invocation(z, bundle.inputData, key);
      const schema = await schemaFor(z, bundle, method, path), body = {};
      for (const [field, property] of Object.entries(schema.properties)) {
        let value = bundle.inputData[field];
        if (value === undefined || value === '') continue;
        if (complex(property) && typeof value === 'string') {
          try { value = JSON.parse(value); } catch { throw new z.errors.Error('Supply valid JSON for ' + field + '.', 'INVALID_JSON', 400); }
        }
        body[field] = value;
      }
      if (path.includes('{id}') && !bundle.inputData.recordId) throw new z.errors.Error('Choose the exact current record.', 'RECORD_REQUIRED', 400);
      return request(z, bundle, path.replace('{id}', encodeURIComponent(bundle.inputData.recordId)), { method, body, idempotencyKey });
    },
    sample: {id: 'synthetic-coffer-7501'}, outputFields: [{key: 'id', type: 'string'}],
  },
}]));

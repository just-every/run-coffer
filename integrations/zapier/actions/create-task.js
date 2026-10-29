const { request } = require('../api');

const perform = async (z, bundle) => {
  const input = bundle.inputData;
  if (typeof input.invocationId !== 'string' || !/^[\x21-\x7e]{1,180}$/.test(input.invocationId)) {
    throw new z.errors.Error('Map a stable, opaque invocation ID of 1 to 180 visible ASCII characters. Reuse it with the same inputs on every retry.', 'INVOCATION_REQUIRED', 400);
  }
  return request(z, bundle, '/tasks', {
    method: 'POST',
    idempotencyKey: 'zapier:task:' + input.invocationId,
    body: {
      donorId: input.donorId,
      ownerId: input.ownerId,
      dueOn: input.dueOn,
      kind: input.kind,
      title: input.title,
      isAsk: false,
    },
  });
};

module.exports = {
  key: 'create_task',
  noun: 'Task',
  display: {
    label: 'Create Non-Ask Task',
    description: 'Creates an explicitly owned non-ask task in your Coffer installation once for a stable invocation ID.',
  },
  operation: {
    perform,
    inputFields: [
      { key: 'invocationId', label: 'Stable Invocation ID', type: 'string', required: true,
        helpText: 'Map an opaque source event ID, unique to this task step. Reuse the ID and all inputs for retries. Do not generate a timestamp or random ID here. A new key or restored installation has a different replay boundary.' },
      { key: 'donorId', label: 'Constituent ID', type: 'string', required: true,
        helpText: 'An exact current Coffer constituent ID. Merged and erased identities are refused.' },
      { key: 'ownerId', label: 'Task Owner ID', type: 'string', required: true,
        helpText: 'An exact active native team member ID. No owner is inferred.' },
      { key: 'dueOn', label: 'Due Date', type: 'string', required: true,
        helpText: 'A calendar date in YYYY-MM-DD form. No date is inferred.' },
      { key: 'kind', label: 'Task Kind', type: 'string', required: true,
        choices: ['call', 'meeting', 'thank_you', 'follow_up', 'data_fix'] },
      { key: 'title', label: 'Task Title', type: 'string', required: true },
    ],
    sample: { id: 'synthetic-coffer-7101' },
    outputFields: [{ key: 'id', label: 'Task ID', type: 'string' }],
  },
};

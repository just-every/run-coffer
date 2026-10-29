const {request} = require('../api');
const events = ['gift.created','gift.reversed','donor.created','donor.updated','plan.failed','plan.canceled','task.assigned','form.submitted'];
module.exports = Object.fromEntries(events.map(type => {
  const key = type.replace('.', '_');
  return [key, {key, noun: 'Event', display: {label: type.replace('.', ' '), description: 'Receives an authentic fresh identifier-only event at the exact manually approved native endpoint.'},
    operation: {type: 'hook',
      inputFields: [{key: 'subscriptionId', label: 'Native Approved Endpoint ID', type: 'string', required: true,
        helpText: 'In Coffer Settings, explicitly approve this Zap hook URL and event using the same native owner or admin who created the connection key. This app cannot subscribe, resume or replay deliveries.'},
        {key: 'targetUrl', label: 'Zapier Hook URL', type: 'string', required: true,
          helpText: 'Copy the exact Zapier hook URL approved for this endpoint in Coffer Settings.'}],
      perform: async (z, bundle) => {
        const raw = bundle.rawRequest || {}, headers = Object.fromEntries(Object.entries(raw.headers || {}).map(([name, value]) => [name.toLowerCase(), value]));
        if (typeof raw.content !== 'string' || !bundle.inputData.targetUrl) throw new z.errors.Error('An exact signed hook capture is required.', 'CAPTURE_REQUIRED', 400);
        const event = await request(z, bundle, '/webhook-receipts/verify', {method: 'POST', body: {
          subscriptionId: bundle.inputData.subscriptionId, targetUrl: bundle.inputData.targetUrl,
          deliveryId: headers['http-coffer-delivery-id'], signature: headers['http-coffer-signature'], rawBody: raw.content,
        }});
        if (event.type !== type) throw new z.errors.Error('This event is not the selected trigger.', 'EVENT_MISMATCH', 400);
        // Stable event ID is Zapier's deduplication identity across retries and
        // reviewed replays. Downstream writes must map it to invocationId.
        return [event];
      },
      sample: {id: 'synthetic-coffer-7502', type, occurredAt: '2030-06-10T12:00:00.000Z', data: {id: 'synthetic-coffer-7503'}},
      outputFields: [{key: 'id', type: 'string'}, {key: 'type', type: 'string'}, {key: 'occurredAt', type: 'datetime'}, {key: 'data__id', type: 'string'}],
    }}];
}));

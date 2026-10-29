const {request} = require('../api');
module.exports = Object.fromEntries(['donors','gifts','pledges','plans','interactions','tasks','opportunities','funds','campaigns','soft-credits'].map(resource => {
  const key = 'find_' + resource.replace(/-/g, '_');
  return [key, {key, noun: 'Record', display: {label: 'Find ' + resource, description: 'Reads an exact native record using the connected key scope and current authority.'},
    operation: {inputFields: [{key: 'recordId', label: 'Exact Record ID', required: true, type: 'string'}],
      perform: async (z, bundle) => {
        if (!bundle.inputData.recordId) throw new z.errors.Error('Choose the exact record.', 'RECORD_REQUIRED', 400);
        return [(await request(z, bundle, '/' + resource + '/' + encodeURIComponent(bundle.inputData.recordId))).data];
      }, sample: {id: 'synthetic-coffer-7501'}, outputFields: [{key: 'id', type: 'string'}]}}];
}));

const authentication = require('./authentication');
const createTask = require('./actions/create-task');

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication,
  creates: { [createTask.key]: createTask, ...require('./actions/local-records') },
  searches: require('./searches/records'),
  triggers: require('./triggers/events'),
};

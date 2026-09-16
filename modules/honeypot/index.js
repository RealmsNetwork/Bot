const security = require('../security');

async function initialize(client, config, moduleConfig, advanced) {
  return security.initialize(client, config, config.security || moduleConfig || {}, advanced);
}

module.exports = {
  initialize,
  commands: security.commands,
  contextMenus: security.contextMenus,
  listeners: security.listeners
};

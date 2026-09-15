const fs = require('node:fs');
const path = require('node:path');

async function loadModules(client, config) {
  const root = path.join(__dirname, '..', 'modules');
  if (!fs.existsSync(root)) return;
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name).sort();
  for (const name of dirs) {
    if (config[name]?.enabled !== true) continue;
    const file = path.join(root, name, 'index.js');
    if (!fs.existsSync(file)) continue;
    try {
      const mod = require(file);
      if (typeof mod.initialize === 'function') await mod.initialize(client, config);
      if (Array.isArray(mod.commands)) {
        for (const command of mod.commands) {
          if (!command?.data?.name || typeof command.execute !== 'function') continue;
          client.commands.set(command.data.name, command);
        }
      }
      console.log(`[Module] Loaded ${name}`);
    } catch (error) {
      console.error(`[Module] Failed to load ${name}:`, error);
    }
  }
}

module.exports = { loadModules };

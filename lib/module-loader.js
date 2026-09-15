const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { buildCommands, loadCustomModule } = require('./custom-dsl');

const root = path.join(__dirname, '..');
const moduleRoot = path.join(root, 'modules');
const customRoot = path.join(root, 'custom-modules');

function readYaml(file, fallback = {}) {
  try { return yaml.load(fs.readFileSync(file, 'utf8')) || fallback; }
  catch (e) { console.error(`[Config] Failed ${file}:`, e.message); return fallback; }
}

function merge(base, extra) {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(extra || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = merge(out[key], value);
    else if (!(key in out)) out[key] = value;
  }
  return out;
}

function ensureModuleConfig(dir, inherited = {}) {
  const example = path.join(dir, 'config.example.yml');
  const config = path.join(dir, 'config.yml');
  if (!fs.existsSync(config)) {
    const defaults = fs.existsSync(example) ? readYaml(example) : { enabled: false };
    const generated = merge(inherited, defaults);
    fs.writeFileSync(config, yaml.dump(generated, { noRefs: true, lineWidth: -1 }), 'utf8');
  }
  return fs.existsSync(config) ? readYaml(config) : {};
}

function collectCommands(file) {
  try {
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    return Array.isArray(mod?.commands) ? mod.commands.filter(x => x?.data?.name && typeof x.execute === 'function') : [];
  } catch (e) { console.error(`[Commands] Failed loading ${file}:`, e.message); return []; }
}

function addCommands(client, commands) {
  for (const command of Array.isArray(commands) ? commands : []) {
    if (!command?.data?.name || typeof command.execute !== 'function') continue;
    client.commands.set(command.data.name, command);
  }
}

async function loadOne(client, name, dir, rootConfig, custom = false) {
  const moduleConfig = ensureModuleConfig(dir, rootConfig[name] || {});
  if (moduleConfig.enabled !== true) return false;
  try {
    const dsl = custom ? loadCustomModule(dir) : null;
    if (dsl) {
      addCommands(client, buildCommands(dsl, name));
      client.modules.set(name, { name, config: moduleConfig, definition: dsl, type: 'yaml' });
      console.log(`[Module] Loaded ${name} (YAML)`);
      return true;
    }
    const file = path.join(dir, 'index.js');
    if (!fs.existsSync(file)) return false;
    const mod = require(file);
    const config = { ...rootConfig, [name]: moduleConfig };
    if (typeof mod.initialize === 'function') await mod.initialize(client, config, moduleConfig);
    addCommands(client, mod.commands);
    if (Array.isArray(mod.listeners)) for (const listener of mod.listeners) if (listener?.event && typeof listener.handle === 'function') client.on(listener.event, (...args) => listener.handle(...args, client));
    client.modules.set(name, { name, config: moduleConfig, definition: mod, type: 'javascript' });
    console.log(`[Module] Loaded ${name}`);
    return true;
  } catch (error) { console.error(`[Module] Failed to load ${name}:`, error); return false; }
}

function moduleDirectories(base) {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => [x.name, path.join(base, x.name)]).sort((a,b) => a[0].localeCompare(b[0]));
}

async function loadCustomModules(client) {
  if (client.config.customModules?.enabled === false) return;
  for (const [name, dir] of moduleDirectories(customRoot)) await loadOne(client, name, dir, client.config, true);
}

async function loadModules(client, config) {
  for (const [name, dir] of moduleDirectories(moduleRoot)) await loadOne(client, name, dir, config, false);
  await loadCustomModules(client);
}

async function refreshCommands(client, config, silent = false) {
  const next = new Map();
  for (const [name, dir] of [...moduleDirectories(moduleRoot), ...moduleDirectories(customRoot)]) {
    const local = ensureModuleConfig(dir, config[name] || {});
    if (local.enabled !== true) continue;
    const dsl = loadCustomModule(dir);
    if (dsl) for (const command of buildCommands(dsl, name)) next.set(command.data.name, command);
    const file = path.join(dir, 'index.js');
    if (fs.existsSync(file)) for (const command of collectCommands(file)) next.set(command.data.name, command);
  }
  client.commands.clear();
  for (const [name, command] of next) client.commands.set(name, command);
  if (!silent) console.log(`[Commands] Refreshed ${client.commands.size} local commands`);
  return client.commands;
}

module.exports = { loadModules, loadCustomModules, refreshCommands, readYaml };

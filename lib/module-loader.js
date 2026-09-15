const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { buildCommands, buildListeners, loadCustomModule } = require('./custom-dsl');

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
  const file = path.join(dir, 'config.yml');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, yaml.dump(merge({ enabled: false }, inherited), { noRefs: true, lineWidth: -1 }), 'utf8');
    console.log(`[Config] Created ${file}`);
  }
  return readYaml(file, { enabled: false });
}

function collectCommands(file) {
  try {
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    return Array.isArray(mod?.commands) ? mod.commands.filter(x => x?.data?.name && typeof x.execute === 'function') : [];
  } catch (e) {
    console.error(`[Commands] Failed loading ${file}:`, e.message);
    return [];
  }
}

function addCommands(client, commands) {
  for (const command of Array.isArray(commands) ? commands : []) {
    if (command?.data?.name && typeof command.execute === 'function') client.commands.set(command.data.name, command);
  }
}

async function loadOne(client, name, dir, rootConfig, custom = false) {
  const dsl = custom ? loadCustomModule(dir) : null;
  const moduleConfig = ensureModuleConfig(dir, rootConfig[name] || {});
  if (custom && dsl?.enabled === true && moduleConfig.enabled !== true) moduleConfig.enabled = true;
  if (moduleConfig.enabled !== true) return false;

  try {
    if (dsl) {
      addCommands(client, buildCommands(dsl));
      for (const listener of buildListeners(dsl)) client.on(listener.event, (...args) => listener.handle(...args));
      client.modules.set(name, { name, config: moduleConfig, definition: dsl, type: 'yaml', dir });
      console.log(`[Module] Loaded ${name} (YAML)`);
      return true;
    }

    const file = fs.existsSync(path.join(dir, 'module.js')) ? path.join(dir, 'module.js') : path.join(dir, 'index.js');
    if (!fs.existsSync(file)) return false;
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    const config = { ...rootConfig, [name]: moduleConfig };
    if (typeof mod.initialize === 'function') await mod.initialize(client, config, moduleConfig);
    addCommands(client, mod.commands);
    if (Array.isArray(mod.listeners)) for (const listener of mod.listeners) if (listener?.event && typeof listener.handle === 'function') client.on(listener.event, (...args) => listener.handle(...args, client));
    client.modules.set(name, { name, config: moduleConfig, definition: mod, type: 'javascript', dir, file });
    console.log(`[Module] Loaded ${name} (JS)`);
    return true;
  } catch (error) {
    console.error(`[Module] Failed to load ${name}:`, error);
    return false;
  }
}

function moduleDirectories(base) {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => [x.name, path.join(base, x.name)]).sort((a, b) => a[0].localeCompare(b[0]));
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
  const dirs = [...moduleDirectories(moduleRoot), ...moduleDirectories(customRoot)];
  for (const [name, dir] of dirs) {
    const dsl = loadCustomModule(dir);
    const local = ensureModuleConfig(dir, config[name] || {});
    if (dsl?.enabled === true && local.enabled !== true) local.enabled = true;
    if (local.enabled !== true) continue;
    if (dsl) for (const command of buildCommands(dsl)) next.set(command.data.name, command);
    const file = fs.existsSync(path.join(dir, 'module.js')) ? path.join(dir, 'module.js') : path.join(dir, 'index.js');
    if (fs.existsSync(file)) for (const command of collectCommands(file)) next.set(command.data.name, command);
  }
  client.commands.clear();
  for (const [name, command] of next) client.commands.set(name, command);
  if (!silent) console.log(`[Commands] Refreshed ${client.commands.size} local commands`);
  return client.commands;
}

module.exports = { loadModules, loadCustomModules, refreshCommands, readYaml, ensureModuleConfig, moduleDirectories };

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const moduleRoot = path.join(root, 'modules');
const customRoot = path.join(root, 'custom-modules');

function readYaml(file, fallback = {}) {
  try { return yaml.load(fs.readFileSync(file, 'utf8')) || fallback; }
  catch (e) { console.error(`[Config] Failed ${file}:`, e.message); return fallback; }
}

function ensureModuleConfig(dir) {
  const example = path.join(dir, 'config.example.yml');
  const config = path.join(dir, 'config.yml');
  if (!fs.existsSync(config) && fs.existsSync(example)) fs.copyFileSync(example, config);
  return fs.existsSync(config) ? readYaml(config) : {};
}

function addCommands(client, mod) {
  if (!Array.isArray(mod?.commands)) return;
  for (const command of mod.commands) {
    if (!command?.data?.name || typeof command.execute !== 'function') continue;
    client.commands.set(command.data.name, command);
  }
}

async function loadOne(client, name, dir, rootConfig) {
  const moduleConfig = ensureModuleConfig(dir);
  if (moduleConfig.enabled === false) return false;
  const file = path.join(dir, 'index.js');
  if (!fs.existsSync(file)) return false;
  try {
    const mod = require(file);
    const config = { ...rootConfig, [name]: { ...(rootConfig[name] || {}), ...moduleConfig } };
    if (typeof mod.initialize === 'function') await mod.initialize(client, config, moduleConfig);
    addCommands(client, mod);
    if (Array.isArray(mod.listeners)) {
      for (const listener of mod.listeners) {
        if (listener?.event && typeof listener.handle === 'function') client.on(listener.event, (...args) => listener.handle(...args, client));
      }
    }
    client.modules.set(name, { name, config: moduleConfig, definition: mod });
    console.log(`[Module] Loaded ${name}`);
    return true;
  } catch (error) {
    console.error(`[Module] Failed to load ${name}:`, error);
    return false;
  }
}

async function loadCustomModules(client) {
  if (!fs.existsSync(customRoot)) return;
  for (const entry of fs.readdirSync(customRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    await loadOne(client, entry.name, path.join(customRoot, entry.name), client.config);
  }
}

async function loadModules(client, config) {
  if (!fs.existsSync(moduleRoot)) return;
  for (const entry of fs.readdirSync(moduleRoot, { withFileTypes: true }).filter(x => x.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
    const name = entry.name;
    const dir = path.join(moduleRoot, name);
    const rootEnabled = config[name]?.enabled;
    const local = ensureModuleConfig(dir);
    if (rootEnabled !== true && local.enabled !== true) continue;
    await loadOne(client, name, dir, config);
  }
  await loadCustomModules(client);
}

module.exports = { loadModules, readYaml };

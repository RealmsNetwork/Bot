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

function addCommands(client, mod) {
  for (const command of Array.isArray(mod?.commands) ? mod.commands : []) {
    if (!command?.data?.name || typeof command.execute !== 'function') continue;
    client.commands.set(command.data.name, command);
  }
}

async function loadOne(client, name, dir, rootConfig) {
  const moduleConfig = ensureModuleConfig(dir);
  if (rootConfig[name]?.enabled !== true && moduleConfig.enabled !== true) return false;
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

function moduleDirectories() {
  const dirs = [];
  for (const base of [moduleRoot, customRoot]) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) if (entry.isDirectory()) dirs.push([entry.name, path.join(base, entry.name)]);
  }
  return dirs.sort((a,b) => a[0].localeCompare(b[0]));
}

async function loadCustomModules(client) {
  for (const [name, dir] of moduleDirectories().filter(x => x[1].startsWith(customRoot))) await loadOne(client, name, dir, client.config);
}

async function loadModules(client, config) {
  for (const [name, dir] of moduleDirectories().filter(x => x[1].startsWith(moduleRoot))) await loadOne(client, name, dir, config);
  await loadCustomModules(client);
}

async function refreshCommands(client, config, silent = false) {
  const files = moduleDirectories().map(([, dir]) => path.join(dir, 'index.js')).filter(fs.existsSync);
  const next = new Map();
  for (const file of files) {
    const commands = collectCommands(file);
    for (const command of commands) next.set(command.data.name, command);
  }
  client.commands.clear();
  for (const [name, command] of next) client.commands.set(name, command);
  if (!silent) console.log(`[Commands] Refreshed ${client.commands.size} local commands`);
  return client.commands;
}

module.exports = { loadModules, loadCustomModules, refreshCommands, readYaml };

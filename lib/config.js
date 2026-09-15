const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const configFile = path.join(root, 'config.yml');
const exampleFile = path.join(root, 'config.example.yml');
const moduleRoot = path.join(root, 'modules');

function deepMerge(base, extra) {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(extra || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = deepMerge(out[key], value);
    else if (!(key in out)) out[key] = value;
  }
  return out;
}
function backup(file) { if (!fs.existsSync(file)) return; const backup = `${file}.backup.${Date.now()}`; fs.copyFileSync(file, backup); console.log(`[Config] Backup created: ${path.basename(backup)}`); }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp`; fs.writeFileSync(tmp, data, 'utf8'); fs.renameSync(tmp, file); }

const legacyAliases = { aichat: 'ai', honeypot: 'security', commandDeployment: 'commands' };

function migrate(config) {
  const oldVersion = Number(config.version || 1); const next = { ...config };
  if (next.commandDeployment && !next.commands) next.commands = next.commandDeployment;
  if (next.aichat && !next.ai) next.ai = { ...next.aichat };
  if (next.honeypot && !next.security) next.security = { ...next.honeypot };
  if (!next.permissions) next.permissions = {};
  next.version = 3;
  return { config: next, changed: oldVersion !== 3, oldVersion };
}

function migrateModuleConfigs(config) {
  if (!fs.existsSync(moduleRoot)) return;
  for (const [oldName, newName] of Object.entries({ ...legacyAliases, commandDeployment: 'commands' })) {
    const data = config[oldName]; if (!data || typeof data !== 'object') continue;
    const target = newName === 'commands' ? null : newName;
    if (!target) continue;
    const dir = path.join(moduleRoot, target); const file = path.join(dir, 'config.yml');
    if (!fs.existsSync(dir) || fs.existsSync(file)) continue;
    write(file, yaml.dump(data, { noRefs: true, lineWidth: -1 }));
    console.log(`[Migration] Created ${target}/config.yml from legacy ${oldName}`);
  }
  for (const entry of fs.readdirSync(moduleRoot, { withFileTypes: true }).filter(x => x.isDirectory())) {
    const name = entry.name; const file = path.join(moduleRoot, name, 'config.yml');
    if (fs.existsSync(file)) continue;
    if (config[name] && typeof config[name] === 'object' && Object.keys(config[name]).length) write(file, yaml.dump(config[name], { noRefs: true, lineWidth: -1 }));
  }
}

function loadConfig() {
  if (!fs.existsSync(configFile)) {
    if (!fs.existsSync(exampleFile)) throw new Error('config.example.yml is missing');
    fs.copyFileSync(exampleFile, configFile); console.log('[Config] Created config.yml from config.example.yml');
  }
  let current; try { current = yaml.load(fs.readFileSync(configFile, 'utf8')) || {}; } catch (e) { backup(configFile); current = {}; console.error('[Config] Invalid config:', e.message); }
  const example = yaml.load(fs.readFileSync(exampleFile, 'utf8')) || {};
  const migration = migrate(current); const merged = deepMerge(migration.config, example); merged.version = 3;
  migrateModuleConfigs(migration.config);
  if (migration.changed) { backup(configFile); write(configFile, yaml.dump(merged, { noRefs: true, lineWidth: -1 })); console.log(`[Config] Migrated V${migration.oldVersion} -> V3`); }
  return merged;
}

module.exports = { loadConfig, migrate, deepMerge, migrateModuleConfigs };

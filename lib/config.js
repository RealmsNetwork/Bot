const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const configFile = path.join(root, 'config.yml');
const exampleFile = path.join(root, 'config.example.yml');

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return base;
  for (const [key, value] of Object.entries(extra)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) base[key] = deepMerge(base[key] || {}, value);
    else if (!(key in base)) base[key] = value;
  }
  return base;
}

function backup(file) {
  if (!fs.existsSync(file)) return;
  const backup = `${file}.backup.${Date.now()}`;
  fs.copyFileSync(file, backup);
  console.log(`[Config] Backup created: ${path.basename(backup)}`);
}

function write(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function migrate(config) {
  const old = Number(config.version || 1);
  const next = { ...config };
  if (old < 2 && next.commandDeployment && !next.commands) next.commands = next.commandDeployment;
  if (old < 3 && next.aichat && !next.ai) next.ai = { ...next.aichat };
  if (old < 3 && next.honeypot && !next.security) next.security = { ...next.honeypot };
  if (old < 3 && next.permissions == null) next.permissions = {};
  next.version = 3;
  return { config: next, changed: old !== 3 };
}

function loadConfig() {
  if (!fs.existsSync(configFile)) {
    if (!fs.existsSync(exampleFile)) throw new Error('config.example.yml is missing');
    fs.copyFileSync(exampleFile, configFile);
    console.log('[Config] Created config.yml from config.example.yml');
  }
  let current;
  try { current = yaml.load(fs.readFileSync(configFile, 'utf8')) || {}; }
  catch (e) { backup(configFile); current = {}; console.error('[Config] Invalid config:', e.message); }
  const example = yaml.load(fs.readFileSync(exampleFile, 'utf8')) || {};
  const migration = migrate(current);
  const merged = deepMerge(migration.config, example);
  merged.version = example.version || 3;
  if (migration.changed) backup(configFile);
  write(configFile, yaml.dump(merged, { noRefs: true, lineWidth: -1 }));
  if (migration.changed) console.log(`[Config] Migrated V${Number(current.version || 1)} -> V${merged.version}`);
  return merged;
}

module.exports = { loadConfig, migrate, deepMerge };

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const configFile = path.join(root, 'config.yml');
const exampleFile = path.join(root, 'config.example.yml');

function merge(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  for (const [key, value] of Object.entries(extra)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) base[key] = merge(base[key] || {}, value);
    else if (!(key in base)) base[key] = value;
  }
  return base;
}

function loadConfig() {
  if (!fs.existsSync(configFile)) {
    if (!fs.existsSync(exampleFile)) throw new Error('config.example.yml is missing');
    fs.copyFileSync(exampleFile, configFile);
    console.log('[Config] Created config.yml from config.example.yml');
  }
  const example = yaml.load(fs.readFileSync(exampleFile, 'utf8')) || {};
  const current = yaml.load(fs.readFileSync(configFile, 'utf8')) || {};
  const merged = merge(current, example);
  if (merged.version !== example.version) merged.version = example.version;
  fs.writeFileSync(configFile, yaml.dump(merged, { noRefs: true, lineWidth: -1 }), 'utf8');
  return merged;
}

module.exports = { loadConfig };

const fs = require('node:fs');
const path = require('node:path');

function parseEnvFile(content = '') {
  const map = new Map();
  const lines = String(content).split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    map.set(key, value);
  }
  return map;
}

function syncEnvSchema(options = {}) {
  const root = options.root || process.cwd();
  const envExamplePath = options.envExample || path.join(root, '.env.example');
  const envPath = options.envFile || path.join(root, '.env');

  if (!fs.existsSync(envExamplePath)) {
    return { added: [], removed: [], updated: false };
  }

  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('[ENV] Checking .env schema...');
    console.log('[ENV] Updated successfully');
    return { added: [], removed: [], updated: true };
  }

  const exampleContent = fs.readFileSync(envExamplePath, 'utf8');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const exampleVariables = parseEnvFile(exampleContent);
  const envVariables = parseEnvFile(envContent);

  const added = [];
  const removed = [];
  const finalEntries = [];
  const seen = new Set();

  for (const [key] of exampleVariables.entries()) {
    if (!envVariables.has(key)) {
      added.push(key);
      finalEntries.push(`${key}=`);
      seen.add(key);
      continue;
    }

    const rawValue = envVariables.get(key);
    finalEntries.push(`${key}=${rawValue ?? ''}`);
    seen.add(key);
  }

  for (const [key] of envVariables.entries()) {
    if (!exampleVariables.has(key)) {
      removed.push(key);
    }
  }

  const finalContent = `${finalEntries.join('\n')}\n`;

  if (added.length || removed.length) {
    fs.writeFileSync(envPath, finalContent, 'utf8');
  }

  console.log('[ENV] Checking .env schema...');
  if (added.length) {
    console.log('[ENV] Added:');
    for (const key of added) console.log(key);
  }
  if (removed.length) {
    console.log('[ENV] Removed:');
    for (const key of removed) console.log(key);
  }
  console.log('[ENV] Updated successfully');

  return { added, removed, updated: added.length > 0 || removed.length > 0 };
}

module.exports = { parseEnvFile, syncEnvSchema };

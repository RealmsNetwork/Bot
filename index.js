const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ quiet: true });

const root = __dirname;
const exampleConfig = path.join(root, 'config.example.yml');
const configFile = path.join(root, 'config.yml');
if (!fs.existsSync(configFile) && fs.existsSync(exampleConfig)) fs.copyFileSync(exampleConfig, configFile);

const yaml = require('js-yaml');
const config = yaml.load(fs.readFileSync(configFile, 'utf8')) || {};
const packages = new Set(['discord.js@14.27.0', 'dotenv@17.2.2', 'js-yaml@4.1.0']);
if (config.aichat?.enabled) packages.add('@google/generative-ai@0.1.3');
if (config.database?.enabled) {
  if (config.database.primary === 'mysql') packages.add('mysql2@3.24.4');
  if (config.database.primary === 'postgres') packages.add('pg@8.23.0');
  if (config.database.primary === 'mongodb') packages.add('mongodb@7.6.0');
  if (config.database.primary === 'redis') packages.add('redis@6.2.1');
}
if (config.music?.enabled) packages.add('@discordjs/voice');

function packageName(spec) {
  if (!spec.startsWith('@')) return spec.split('@')[0];
  const slash = spec.indexOf('/');
  const at = spec.indexOf('@', slash);
  return at === -1 ? spec : spec.slice(0, at);
}
function ensurePackage(spec) {
  try { require.resolve(packageName(spec)); return true; } catch {}
  console.log(`[Bootstrap] Installing ${spec}`);
  const npm = process.env.npm_execpath || 'npm';
  const result = spawnSync(npm, ['install', '--no-audit', '--no-fund', '--save-exact', spec], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status === 0;
}
for (const pkg of packages) if (!ensurePackage(pkg)) console.warn(`[Bootstrap] Could not install ${pkg}; related features may stay unavailable.`);

if (!process.env.DISCORD_TOKEN) {
  console.error('[Bootstrap] DISCORD_TOKEN is missing from .env');
  process.exit(1);
}

const { ShardingManager } = require('discord.js');
if (config.sharding?.enabled === true) {
  const manager = new ShardingManager(path.join(root, 'main.js'), {
    token: process.env.DISCORD_TOKEN,
    totalShards: config.sharding.totalShards || 'auto',
    shardList: config.sharding.shardList || 'auto',
    respawn: config.sharding.respawn !== false,
    mode: 'process'
  });
  manager.on('shardCreate', shard => console.log(`[Shard] Spawned #${shard.id}`));
  manager.spawn().catch(e => { console.error('[Shard] Spawn failed:', e); process.exit(1); });
} else {
  require('./main').start().catch(e => { console.error('[Bootstrap] Start failed:', e); process.exit(1); });
}

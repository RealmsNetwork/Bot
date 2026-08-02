require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_PATH = path.join(__dirname, 'config.yml');
let CONFIG;
try {
  const file = fs.readFileSync(CONFIG_PATH, 'utf8');
  CONFIG = yaml.load(file);
  console.log('[Config] Loaded successfully');
} catch (e) {
  console.error('[Config] Failed to load config.yml:', e.message);
  process.exit(1);
}

CONFIG.token = process.env.DISCORD_TOKEN;
if (!CONFIG.token) {
  console.error('[Config] DISCORD_TOKEN not set in .env or environment variables');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User],
});

// ------------------------------------------------------------------
// DYNAMIC MODULE LOADER
// ------------------------------------------------------------------
function loadModules() {
  const modulesPath = path.join(__dirname, 'modules');
  if (!fs.existsSync(modulesPath)) {
    console.log('[Modules] No modules folder found.');
    return;
  }

  const moduleFolders = fs.readdirSync(modulesPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const moduleName of moduleFolders) {
    const moduleConfig = CONFIG[moduleName];
    // If module has no config or is explicitly disabled, skip it.
    if (!moduleConfig || moduleConfig.enabled === false) {
      console.log(`[Modules] Skipping "${moduleName}" (disabled or no config)`);
      continue;
    }

    const modulePath = path.join(modulesPath, moduleName, 'index.js');
    if (!fs.existsSync(modulePath)) {
      console.warn(`[Modules] Module "${moduleName}" has no index.js, skipping.`);
      continue;
    }

    try {
      const moduleExports = require(modulePath);
      if (typeof moduleExports.initialize === 'function') {
        moduleExports.initialize(client, CONFIG);
        console.log(`[Modules] Loaded "${moduleName}"`);
      } else {
        console.warn(`[Modules] Module "${moduleName}" does not export an initialize function.`);
      }
    } catch (err) {
      console.error(`[Modules] Error loading "${moduleName}":`, err);
    }
  }
}

// ------------------------------------------------------------------
// Load all modules
// ------------------------------------------------------------------
loadModules();

module.exports = { CONFIG, client };

if (require.main === module) {
  client.login(CONFIG.token)
    .then(() => console.log('[Bot] Online'))
    .catch(err => console.error('[Bot] Login failed:', err));
}

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

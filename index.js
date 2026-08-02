//Module Loader.
require('dotenv').config(); // loads .env if present; falls back to system env

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

// Token is taken from environment variables (.env or system).
// It is intentionally not stored in config.yml for security.
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

const { initializeHoneypot } = require('./modules/honeypot/index');
initializeHoneypot(client, CONFIG);

module.exports = { CONFIG, client };

if (require.main === module) {
  client.login(CONFIG.token)
    .then(() => console.log('[Bot] Online'))
    .catch(err => console.error('[Bot] Login failed:', err));
}

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

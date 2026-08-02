require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_PATH = path.join(__dirname, 'config.yml');
const EXAMPLE_PATH = path.join(__dirname, 'config.example.yml');

function mergeDefaults(defaults, current) {
    if (Array.isArray(defaults)) return current ?? defaults;
    if (typeof defaults !== 'object' || defaults === null) {
        return current !== undefined ? current : defaults;
    }

    const result = {};

    for (const key of Object.keys(defaults)) {
        result[key] = mergeDefaults(defaults[key], current?.[key]);
    }

    if (current && typeof current === 'object') {
        for (const key of Object.keys(current)) {
            if (!(key in result)) result[key] = current[key];
        }
    }

    return result;
}

function loadConfig() {
    if (!fs.existsSync(EXAMPLE_PATH)) {
        console.error('[Config] Missing config.example.yml');
        process.exit(1);
    }

    const example = yaml.load(fs.readFileSync(EXAMPLE_PATH, 'utf8'));
    let config = {};

    if (fs.existsSync(CONFIG_PATH)) {
        config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
    }

    const oldVersion = config.version || 1;
    const newVersion = example.version || 1;

    const updated = mergeDefaults(example, config);

    if (oldVersion < newVersion) {
        updated.version = newVersion;

        fs.writeFileSync(
            CONFIG_PATH,
            yaml.dump(updated, { noRefs: true, lineWidth: -1 }),
            'utf8'
        );

        console.log(`[Config] Updated config.yml ${oldVersion} -> ${newVersion}`);
    }

    return updated;
}

let CONFIG;

try {
    CONFIG = loadConfig();
    console.log('[Config] Loaded successfully');
} catch (err) {
    console.error('[Config] Failed:', err.message);
    process.exit(1);
}

CONFIG.token = process.env.DISCORD_TOKEN;

if (!CONFIG.token) {
    console.error('[Config] DISCORD_TOKEN missing from environment');
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
        GatewayIntentBits.DirectMessages
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.GuildMember,
        Partials.User
    ]
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

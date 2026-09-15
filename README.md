# RealmsNetwork Bot v2

A lightweight, config-first Discord bot built around dynamically loaded feature packs.

## Layout

- `index.js` is the tiny bootstrapper. It creates the config when needed, installs only the optional drivers required by enabled features, and starts either a single process or Discord `ShardingManager`.
- `main.js` owns the Discord client, database facade, module loader, command router, and shutdown handling.
- `lib/` contains shared infrastructure.
- `modules/<name>/index.js` is a self-contained feature pack. A module loads only when its matching YAML `enabled` flag is `true`.

## Storage

`database.enabled` is `false` by default. Set `primary` to `mysql`, `postgres`, `mongodb`, or `redis` to use the matching driver. With the database disabled, the bot uses a tiny JSON key/value store in `data/kv.json`.

The bootstrapper installs an optional driver only when that backend is enabled, keeping the default install small.

## Commands

Slash commands are loaded from enabled modules. Run `npm run deploy` after changing command definitions, or set `commandDeployment.autoDeploy: true` for automatic deployment on ready.

## Included feature packs

Utility, extended utility, moderation, community, server, economy, leveling, giveaways, tickets, roles, fun, developer, logging, welcome, automod, automation, autorole, reminders, verification, starboard, notifications, AI chat, honeypot, and shard statistics.

Additional module names can be added without changing the core loader.

## Requirements

Node.js 18.18+ is required by the current discord.js release line. Keep secrets in `.env`; never commit the real token or database credentials.

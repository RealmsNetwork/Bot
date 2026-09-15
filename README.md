# RealmsNetwork Bot

RealmsNetwork Bot is a production/development Discord platform built around a small core and opt-in modules. The goal is a serious hoster/dev experience: predictable configuration, safe defaults, persistence, sharding, hot command refresh, custom modules, diagnostics and an optional web panel.

## Architecture

- `index.js` is bootstrap only: dependency preparation, configuration bootstrap and shard orchestration.
- `main.js` owns the Discord runtime, command registry, prefix framework, permissions, metrics and shutdown.
- `lib/` contains framework services for configuration, storage, module loading, permissions and the scripting DSL.
- `modules/<name>/` contains first-party modules. Each module owns `config.yml`.
- `custom-modules/<name>/` contains trusted YAML/JavaScript modules.

## Module configuration

Every module uses `config.yml` and supports:

```yaml
enabled: false
advanced: false
```

When `advanced: true`, the loader creates that module's `advanced.yml` on first load. The generated file contains lifecycle, command overrides, prefix integration, permissions, UI, logging, event filters, limits, storage, scheduler, webhooks and arbitrary override sections. Existing `advanced.yml` files are never overwritten.

This gives simple users a small config while giving advanced hosts a complete per-module control surface.

## Commands and branding

Application commands auto-refresh and auto-deploy by default. Per-module advanced settings can override command cooldowns, permission groups and enable/disable individual commands.

The root config supports custom bot/server branding, embed colors, error messages, footer text and optional classic prefix commands. Prefix handling is disabled by default and custom JavaScript modules can register prefix handlers through the framework.

## Storage

Supported persistence modes:

- SQLite with WAL via `better-sqlite3` for single-instance/local production deployments.
- PostgreSQL, MySQL, MongoDB and Redis for shared/remote deployments.
- Local JSON fallback when persistence is disabled or a configured backend is unavailable and fallback is allowed.

SQLite is the default local backend. Remote database drivers are installed only when their backend is selected.

## Sharding

Sharding is optional. Explicit shard counts work with local SQLite. Automatic Discord-recommended shard detection is deliberately restricted to remote database deployments so multiple shard processes do not accidentally share a local SQLite file as their coordination store. discord.js supports `totalShards: 'auto'`; this project only enables that behavior through the guarded remote-database setting. citeturn2search0turn2search2

## Optional admin panel

Set `adminPanel.enabled: true` and provide `DASHBOARD_TOKEN` to enable the built-in status UI. The default bind address is `127.0.0.1`, so production hosts can put Nginx/Caddy in front of it. The panel exposes authenticated status and health endpoints and is read-only by default.

For a serious public deployment, keep the panel behind HTTPS and a reverse proxy instead of exposing the raw bot process directly. Discord bot credentials remain environment variables rather than dashboard/config values. citeturn3search0turn3search2

## Custom modules and scripting

YAML modules provide a Skript-like declarative system for commands/events, arguments, conditions, variables, database values, HTTP JSON, embeds, role/channel actions, moderation actions, waits, reactions, DMs and nested actions. Inline JavaScript is opt-in and disabled by default.

JavaScript modules are first-class and can use the full discord.js API plus shared database/framework services. Module dependencies can be declared in their configuration and are installed automatically by the bootstrapper.

## AI

The AI router supports Ollama, LM Studio, OpenAI-compatible endpoints, OpenAI, Groq, Mistral, DeepSeek, xAI, Together, OpenRouter, Perplexity, Cohere, Hugging Face, Anthropic and Gemini through HTTP adapters. Optional provider SDKs are not required for the base runtime.

## Built-in feature areas

Moderation, mass actions, warnings, timeouts, purge and channel controls; automod and security traps; audit logging; welcome/autoroles; tickets; roles; giveaways; leveling; economy; reminders; starboard; community tools; forms; tags; AFK; autoresponders; feeds; highlights; utility/server/developer tools; AI; Countryballs; automation; and shard tools.

All feature modules are opt-in. The platform/help pack is also opt-in in V4.

## Development vs production

Development can use SQLite, guild-scoped command deployment, prefix commands, verbose diagnostics and rapid command refresh. Production can use SQLite for a single process or a remote shared database for sharded deployments, with the optional authenticated dashboard behind a reverse proxy.

Keep real tokens, API keys and database credentials in `.env` and never commit them.

## Quality control

`npm run check` is the canonical local QC command. CI runs the same QC suite plus core import and package metadata smoke tests on every push and pull request. The QC suite checks JavaScript syntax, YAML validity, V4 defaults, module config structure, stale module example files and SQLite support.

## Migration

The runtime migrates older root configurations to V4. `commandDeployment` maps to `commands`, `aichat` maps to `ai`, `honeypot` maps to the security module, and legacy module settings are preserved while local module configs are created. See `MIGRATIONS.md`.

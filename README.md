# RealmsNetwork Bot v0.1

RealmsNetwork Bot v0.1 is the first public release of a production/development Discord platform built around a small core and opt-in modules. The goal is a serious hoster/dev experience: predictable configuration, safe defaults, persistence, sharding, automatic command refresh, custom modules, diagnostics, voice tools and an optional admin panel.

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

When `advanced: true`, the loader creates that module's `advanced.yml` on first load. The generated file is intentionally comprehensive: lifecycle, command registration and overrides, prefix integration, permissions, UI/components, responses, embeds, event filters, rate limits, cooldowns, schedulers, storage/cache, HTTP, webhooks, logging, analytics, health, performance limits, security controls, localization, branding, sharding behavior and lifecycle hooks.

Existing `advanced.yml` files are never overwritten. Modules can also ship `defaults.yml`; missing settings are merged into `config.yml` automatically without overwriting existing values. Simple users can stay in `config.yml`; advanced hosts get a full per-module control surface.

## Commands, prefixes and branding

Application commands auto-refresh and auto-deploy by default. Advanced module settings can override command cooldowns, permission groups, visibility and individual command enablement.

The root configuration supports custom bot/server branding, embed colors, footer text, error/success messages and classic prefixes. Prefix handling is disabled by default. JavaScript modules can register prefix handlers through the framework.

Core/platform responses use the same branding system instead of hard-coded RealmsNetwork UI text.

## Storage

Supported persistence modes:

- SQLite with WAL via `better-sqlite3` for local/single-process production and development.
- PostgreSQL, MySQL, MongoDB and Redis for shared/remote deployments.
- Local JSON fallback when persistence is disabled or an unavailable backend is explicitly allowed to fall back.

SQLite is the default local backend. Optional remote drivers and module dependencies are installed only when the selected feature/backend is enabled.

## Sharding

Sharding is optional. Explicit shard counts work with SQLite. Automatic Discord-recommended shard detection is deliberately restricted to remote database deployments so multiple shard processes do not accidentally coordinate through a local SQLite file.

## Optional admin panel

The dashboard is optional and disabled by default. It binds to `127.0.0.1` by default and requires `DASHBOARD_TOKEN`.

Read-only mode is the safe default. When explicitly changed to writable mode, the authenticated panel can reload commands and enable/disable first-party modules. Put it behind HTTPS and a reverse proxy for public administration.

## Voice suite

The unified `voice` module includes:

- Music playback and queueing
- URL/search playback
- Queue, skip, stop, now-playing and volume controls
- Text-to-speech using the configurable Edge TTS voice service
- Temporary voice channels
- Owner-only temporary VC control panel
- Lock/unlock and hide/unhide
- Owner transfer/claim
- Member selection for kick/mute/deafen
- Configurable room names, limits, bitrate, category, cleanup and permissions

The voice stack is optional and does not load its dependencies until the module is enabled.

## Custom modules and scripting

YAML modules provide a Skript-like declarative system for commands/events, arguments, conditions, variables, database values, HTTP JSON, embeds, role/channel actions, moderation actions, waits, reactions, DMs and nested actions. Inline JavaScript is opt-in and disabled by default.

JavaScript modules are first-class and can use the full discord.js API plus shared database/framework services. Module dependencies can be declared in their configuration and are installed automatically when that module is enabled.

## AI

The AI router supports Ollama, LM Studio, OpenAI-compatible endpoints, OpenAI, Groq, Mistral, DeepSeek, xAI, Together, OpenRouter, Perplexity, Cohere, Hugging Face, Anthropic and Gemini through HTTP adapters. Optional provider SDKs are not required for the base runtime.

## Security and strict checks

Commands pass through centralized guild, actor, bot-permission, channel-permission, NSFW and cooldown checks before execution. Moderation actions enforce Discord hierarchy and target-state checks, including already-banned/already-unbanned detection. The moderation module includes persistent temporary bans with automatic expiry. Role management enforces both bot and actor hierarchy. Ticket claim/close actions require configured support staff. Automated security and AutoMod punishments re-check target hierarchy and state before acting.

## Built-in feature areas

Moderation, mass actions, warnings, timeouts, purge and channel controls; automod and security traps; audit logging; welcome/autoroles; tickets; roles; giveaways; leveling; economy; reminders; starboard; community tools; forms; tags; AFK; autoresponders; feeds; highlights; utility/server/developer tools; AI; Countryballs; automation; voice/music/TTS/temp VC; sharding and diagnostics.

All feature modules are opt-in, including the platform/help pack.

## Development vs production

Development can use SQLite, guild-scoped command deployment, prefix commands, verbose diagnostics and rapid command refresh. Production can use SQLite for a single process or a remote shared database for sharded deployments, with the optional authenticated dashboard behind a reverse proxy.

Keep real tokens, API keys and database credentials in `.env` and never commit them.

## Quality control

`npm run check` is the canonical local QC command. CI runs the same QC suite plus core import and package metadata smoke tests on every push and pull request. The QC suite checks JavaScript syntax, YAML validity, V5 defaults, module config structure, stale module example files and SQLite support.

## Migration

The runtime migrates older root configurations to V5. `commandDeployment` maps to `commands`, `aichat` maps to `ai`, `honeypot` maps to the security module, and legacy module settings are preserved while local module configs are created. See `MIGRATIONS.md`.

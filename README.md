# RealmsNetwork Bot

A self-hostable, config-first Discord platform built to cover moderation, automation, community, utility, economy, AI, security, games and server-management workloads without forcing every optional feature into the base runtime.

## Layout

- `index.js` is bootstrap only.
- `main.js` owns the Discord runtime, command registry, permissions, persistence and shutdown.
- `lib/` contains reusable framework services.
- `modules/<name>/` contains first-party modules. Edit `config.yml` directly.
- `custom-modules/<name>/` contains your own YAML or JavaScript modules.

## Host/editor experience

The root configuration is deliberately small. Built-in modules own their behavior in `modules/<name>/config.yml`; missing configs are generated as `config.yml` with disabled-safe defaults. You do not need to rename `config.example.yml` files for individual modules.

Commands automatically refresh and deploy by default. Changing a command definition, option or enabled module is detected by the runtime, so normal hosts do not need to manually run a command refresh step.

## Custom modules

YAML modules provide a Skript-like system for commands and events. You can use arguments, conditions, variables, database values, HTTP JSON requests, embeds, role actions, moderation actions, waits, reactions, DMs and nested actions.

JavaScript modules are first-class too. Put `module.js` or `index.js` in a custom module directory plus `config.yml`. JS modules can use the full discord.js API and shared bot services.

## AI

The AI router supports Ollama, LM Studio, OpenAI-compatible endpoints, OpenAI, Groq, Mistral, DeepSeek, xAI, Together, OpenRouter, Perplexity, Cohere, Hugging Face, Anthropic and Gemini. HTTP adapters are preferred so optional provider SDKs do not bloat the base installation.

## Storage

Optional providers: MySQL, PostgreSQL, MongoDB and Redis. With persistence disabled, the bot falls back to a small local JSON store. Optional database drivers are installed only when required.

## Countryballs

The Countryballs system uses a configurable live country data source instead of a hardcoded fake collection. The bundled adapter targets REST Countries, which exposes normalized country names, ISO codes, flags, capitals, currencies, languages, population, regions and other fields. Results are cached so normal gameplay does not spam the API.

## Platform coverage

Moderation, mass banning, warnings, timeouts, purge and channel controls; automod and security traps; audit/action logging; welcome/autoroles; tickets; reaction/self roles; giveaways; leveling; economy; reminders; starboard; community tools; forms; tags; AFK; autoresponders; feeds; highlights; voice linking; music; notifications; utility/server/developer tools; AI; Countryballs; automation; shard tools; and compatibility aliases for legacy modules.

## Migration

The runtime supports legacy root configuration names and migration. `commandDeployment` maps to `commands`, `aichat` maps to `ai`, `honeypot` maps to the security module, and old module settings are preserved as the per-module configuration is generated. See `MIGRATIONS.md`.

## Quality control

`npm run check` validates JavaScript syntax and YAML. GitHub Actions performs installation, syntax checks and configuration validation on pushes and pull requests.

Keep real tokens, API keys and database credentials in `.env` and never commit them.

# RealmsNetwork Bot V3

RealmsNetwork Bot is a config-first, modular Discord bot platform built to cover moderation, automation, community, utility, economy, AI, security, games, and server-management workloads without making the core process depend on every optional feature.

## Runtime

- `index.js` is bootstrap only. It creates missing local configuration, discovers optional package requirements, installs only what enabled modules need, and starts either one process or Discord sharding.
- `main.js` owns the client, persistence facade, command router, permissions, module lifecycle, automatic command synchronization, and shutdown.
- `lib/` contains reusable infrastructure.
- `modules/<name>/` contains first-party modules.
- `custom-modules/<name>/module.yml` can define a module without writing JavaScript.

## Configuration

The root `config.yml` contains global runtime settings. Each module gets its own `config.yml` automatically from `config.example.yml` when the bot starts. Module configuration is ignored until that module is enabled.

Command synchronization is automatic by default. The bot detects changes to command definitions and re-syncs the configured application command scope without requiring a manual refresh variable or command.

## Permissions

Permissions are layered. A command can use native Discord permissions, role groups, users, roles, channels, allow-lists, deny-lists, and owner bypass. Server owners can keep a global emergency bypass while individual commands remain independently configurable.

Discord also supports application command permission overwrites by role/member/channel from the server Integration settings.

## Persistence

`database.enabled` is `false` by default. Available adapters are `none`, `mysql`, `postgres`, `mongodb`, and `redis`. Provider drivers are installed lazily. Local JSON storage is used as the zero-dependency fallback.

## AI

The canonical `ai` module supports direct HTTP integrations for OpenAI, Groq, Mistral, Anthropic, Gemini, Ollama, and arbitrary OpenAI-compatible endpoints. This also covers many hosted and local runtimes without forcing every SDK into the base installation. Providers can be chained with fallbacks.

## No-code modules

Create a folder under `custom-modules/`, add `module.yml`, and enable it. Example syntax:

```yaml
name: hello-world
enabled: true
commands:
  - name: hello
    description: Say hello
    run:
      - reply: "Hello {user.mention}!"

  - name: announce
    description: Send an announcement
    permission: ManageMessages
    options:
      - name: message
        type: string
        description: Announcement text
        required: true
    run:
      - send: "📢 {args}"

events:
  messageCreate:
    contains: "hello bot"
    run:
      - send: "Hello {user.mention}!"
```

The DSL supports commands, options, permissions, replies, sends, DMs, reactions, role changes, timeouts, waits, logging, and message/event triggers. JavaScript modules are still available for anything that needs full programmatic control.

## Included platform areas

Moderation, mass banning, warnings, timeouts, purge and channel controls; automod; logging; welcomes and autoroles; tickets; reaction/self roles; giveaways; leveling; economy; reminders; starboard; community tools; automation; AI; security traps; shard tools; utility packs; engagement/AFK/tags; Countryballs collection gameplay; and compatibility aliases for the previous `aichat` and `honeypot` module names.

## Migration

V1/V2 root settings are migrated automatically. `commandDeployment` maps to `commands`, `aichat` maps to `ai`, and `honeypot` maps to `security`. Module settings are preserved when their new per-module config is first generated. See `MIGRATIONS.md`.

## Quality control

Run `npm run check` to syntax-check JavaScript and parse every YAML file. GitHub Actions performs the same validation on pushes and pull requests.

Never commit real tokens, API keys, or database credentials.

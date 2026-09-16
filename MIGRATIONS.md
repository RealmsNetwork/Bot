# RealmsNetwork Bot V2/V3 migrations

## Automatic migrations
The runtime upgrades the root configuration when needed and keeps a backup before changing it.

### V1 -> V2/V3
- `aichat` is a compatibility alias for the new `ai` module.
- `honeypot` is a compatibility alias for the new security system.
- `commandDeployment.autoDeploy` becomes `commands.autoDeploy`.
- Root feature settings become `modules/<name>/config.yml`.
- Missing module configs are created automatically as `config.yml` without a module-level `enabled` flag.

## Module enable migration
Module enable state is controlled exclusively by the matching section in the root `config.yml`.

For example:

```yaml
# config.yml
moderation:
  enabled: true
```

The matching module config contains only module settings:

```yaml
# modules/moderation/config.yml
logChannelId: "123"
deleteMessage: true
```

On startup, the migrator scans every built-in `modules/*/config.yml`. If a legacy top-level `enabled` value exists, it moves that value to the matching root module section when the root does not already define one, then removes the module-level flag. Nested feature settings such as `messageSpam.enabled` are not changed.

## Runtime state
Database-backed state keeps using the shared database facade. The local fallback is stored under `data/`, which is ignored by git.

## Custom modules
Custom YAML modules live under `custom-modules/<name>/module.yml`.
Custom JavaScript modules can use `custom-modules/<name>/module.js` or `index.js` plus a local `config.yml`.

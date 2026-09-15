# RealmsNetwork Bot V2/V3 migrations

## Automatic migrations
The runtime upgrades the root configuration when needed and keeps a backup before changing it.

### V1 -> V2/V3
- `aichat` is a compatibility alias for the new `ai` module.
- `honeypot` is a compatibility alias for the new security system.
- `commandDeployment.autoDeploy` becomes `commands.autoDeploy`.
- Root feature settings become `modules/<name>/config.yml`.
- Missing module configs are created automatically as `config.yml` with `enabled: false`.

## Module config migration
Built-in module settings are no longer stored in the root file. Move the values from the old root section into the matching module's `config.yml`.

Example:

```yaml
# old root config
moderation:
  enabled: true
  logChannelId: "123"
```

becomes:

```yaml
# modules/moderation/config.yml
enabled: true
logChannelId: "123"
```

## Runtime state
Database-backed state keeps using the shared database facade. The local fallback is stored under `data/`, which is ignored by git.

## Custom modules
Custom YAML modules live under `custom-modules/<name>/module.yml`.
Custom JavaScript modules can use `custom-modules/<name>/module.js` or `index.js` plus a local `config.yml`.

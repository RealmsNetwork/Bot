# RealmsNetwork Bot V3 migration

The bot now migrates old root configuration automatically.

| Legacy | V3 |
| --- | --- |
| `commandDeployment` | `commands` |
| `aichat` | `ai` |
| `honeypot` | `security` |
| root module settings | `modules/<module>/config.yml` |

Before a versioned migration, the loader writes a timestamped `config.yml.backup.<timestamp>` copy.

Each installed module receives its own `config.yml` automatically from `config.example.yml`. Existing legacy settings are preserved when the file is first created.

The migration does not copy secrets from source control. API keys stay in `.env` or the provider's configured secret environment variable.

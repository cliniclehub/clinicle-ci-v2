# DevOps

Non-application tooling for the monorepo: deploy, local infrastructure, migrations, scripts, and documentation.

| Path | Purpose |
|------|---------|
| [`deploy/`](deploy/) | GHCR + Render deploy config (`deploy.env`, FE build-arg files) |
| [`config-backups/`](config-backups/README.md) | Gitignored Render env snapshots (`be_env_files/`, `fe_env_files/`) |
| [`db-migrations/`](db-migrations/) | Numbered SQL migrations (`001_…`) + `archive/` |
| [`devops/docs/`](docs/) | Runbooks, `system_docs/` (BRD/SDD/ST), `rules/` (AI_RULES), `archive/` |
| [`scripts/`](scripts/) | `migrate-db`, `git-promote`, SAST, backup helpers |
| [`cloud-flare/`](cloud-flare/) | Workers and R2/CORS tooling |
| [`docker-compose.yaml`](docker-compose.yaml) | Local Postgres (`make start-db`) |

Application source lives in `be/`, `fe/`, `test_*`, and `fe_mobile/`.

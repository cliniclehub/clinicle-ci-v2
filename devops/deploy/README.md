# Deployment configuration

The Clinicle Intelligence deploy pipeline builds two images:

- `ghcr.io/<owner>/ci_app_be:<tag>` for FastAPI;
- `ghcr.io/<owner>/ci_app_fe:<environment>-<tag>` for Next.js.

Package names come from `GHCR_PACKAGE_BE` / `GHCR_PACKAGE_FE` in `deploy.env` (change these when forking for another product, e.g. `cms_app_be` / `cms_app_fe`).

The backend image is environment-neutral; runtime variables and secrets are supplied by the hosting platform. Public `NEXT_PUBLIC_*` frontend values are embedded at build time, so build a frontend image for each environment.

## Setup

```bash
cp devops/deploy/deploy.env.example devops/deploy/deploy.env
cp devops/deploy/env-dev.env.example devops/deploy/env-dev.env
cp devops/deploy/env-tst.env.example devops/deploy/env-tst.env
cp devops/deploy/env-prod.env.example devops/deploy/env-prod.env
```

Edit each `env-*.env` with the real public FE/API URLs for that environment before `make build-dev` / `build-test` / `build-prd` / `build-all`. Those values are baked into the Next.js image as `NEXT_PUBLIC_*` build args.

Do not place secrets in frontend build-argument files. `deploy.env` and all live `env-*.env` files are gitignored.

Configure `GHCR_OWNER`, package names, and optional Render service IDs. Authenticate with GHCR, then use the root Makefile:

```bash
make ghcr-login
make build-images ENV=dev IMAGE_TAG=<git-sha>
make push-images ENV=dev IMAGE_TAG=<git-sha>
make render-deploy ENV=dev IMAGE_TAG=<git-sha>
```

Render (or another container host) should reference the rolling `ci_app_be:dev` and `ci_app_fe:dev` tags (or whatever you set in `GHCR_PACKAGE_*`), with corresponding `tst` and `prod` tags. The SHA tags remain available for audit and rollback.

## Local container validation

```bash
make build-local
make deploy-local
make deploy-local-down
```

This uses `docker-compose.deploy.yaml` and local tags `<GHCR_PACKAGE_BE>:local` and `<GHCR_PACKAGE_FE>:local` (defaults: `ci_app_be:local`, `ci_app_fe:local`).

## Database migrations

Deployment does not apply database migrations automatically. Review numbered SQL under `devops/db-migrations/`, back up the target, and run the explicit migration command:

```bash
make migrate-db-status TARGET=int
make migrate-dev
make migrate-test
make migrate-prd
```

Remote database coordinates and passwords must be provided through ignored `deploy.env` values or the environment. No client infrastructure coordinates are included in source control.

## Production checklist

- unique signing secrets and least-privilege database/provider credentials;
- explicit allowed origins, public URLs, tenant DNS targets, and custom domains;
- email delivery intentionally enabled only after provider validation;
- object storage buckets, CORS, worker URLs, and access policies verified;
- health checks, structured log collection, alerts, backups, and restore drill complete;
- SAST/container scan, unit/system tests, migration rehearsal, and rollback tested.

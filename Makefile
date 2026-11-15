# =============================================================================
# Platform monorepo — single Makefile (run everything from the repo root)
# =============================================================================

MONO_ROOT  := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
FE_DIR     := $(MONO_ROOT)/fe
MOBILE_DIR := $(MONO_ROOT)/fe_mobile
BE_DIR     := $(MONO_ROOT)/be
DEVOPS_DIR := $(MONO_ROOT)/devops
TEST_UNIT_BE    := $(MONO_ROOT)/test_unit_be
TEST_UNIT_FE    := $(MONO_ROOT)/test_unit_fe
TEST_ST_UI   := $(MONO_ROOT)/test_st_ui
TEST_ST_API := $(MONO_ROOT)/test_st_api

DEPLOY_DIR       := $(DEVOPS_DIR)/deploy
DEPLOY_ENV_FILE  := $(DEPLOY_DIR)/deploy.env
SCRIPTS_DIR      := $(DEVOPS_DIR)/scripts

PYTHON          := python3.12
BE_VENV         := $(BE_DIR)/.venv
BE_VENV_BIN     := $(BE_VENV)/bin
DOCKER_COMPOSE  ?= docker compose

GREEN  := \033[0;32m
YELLOW := \033[1;33m
RED    := \033[0;31m
NC     := \033[0m

# Deploy / GHCR (overridden by devops/deploy/deploy.env when present)
ifneq (,$(wildcard $(DEPLOY_ENV_FILE)))
include $(DEPLOY_ENV_FILE)
endif

GHCR_OWNER       ?= abadarneh
GHCR_PACKAGE_BE  ?= ci_app_be
GHCR_PACKAGE_FE  ?= ci_app_fe
GIT_DEPLOY_BRANCH ?= dev
REGISTRY         := ghcr.io/$(GHCR_OWNER)
IMAGE_TAG        ?= local
DEPLOY_ENV       ?= dev
ENV              ?= dev
DOCKER_PLATFORM  ?= linux/amd64
# Set DOCKER_NO_CACHE=1 to force a full image rebuild (busts stale npm ci layers).
DOCKER_NO_CACHE  ?=
DOCKER_NO_CACHE_FLAG := $(if $(filter 1,$(DOCKER_NO_CACHE)),--no-cache,)
BUILD_ARG_FILE   ?=
FE_BUILD_ARG_FILE := $(DEPLOY_DIR)/env-$(ENV).env
APP_RELEASE_VERSION := $(shell tr -d ' \n\r' < VERSION 2>/dev/null || echo 0.0.0-dev)
APP_BUILD_ID       = $(DEPLOY_ENV)-$(IMAGE_TAG)

export GHCR_OWNER GHCR_PACKAGE_BE GHCR_PACKAGE_FE GIT_DEPLOY_BRANCH IMAGE_TAG GHCR_USERNAME
# GITHUB_TOKEN is used by ghcr-login only (not exported — passed via Make $(GITHUB_TOKEN))

# Database / Docker Compose
COMPOSE_FILE     := docker-compose.yaml
DEPLOY_COMPOSE   := docker-compose.deploy.yaml
DB_BACKUP_PATH   := $(DEVOPS_DIR)/db-backups
DB_IMAGE_NAME    := postgres
DB_VERSION       := 16
DC               := cd $(DEVOPS_DIR) && $(DOCKER_COMPOSE) -f $(COMPOSE_FILE)

LOCAL_DB_HOST    := localhost
POSTGRES_PORT    ?= 5432
LOCAL_DB_PORT    := $(POSTGRES_PORT)
LOCAL_DB_USER    := ci_user
LOCAL_DB_NAME    := ci_db
LOCAL_TEST_DB_NAME := ci_db_unit_test
LOCAL_DB_PASSWORD := ci_user
# Optional: skip the local-DB picker on backup-db / restore-db / migrate-db, e.g.
#   make restore-db LOCAL_DB_TARGET=ci_db BACKUP_FILE=backup_local_ci_db_….dump
LOCAL_DB_TARGET  ?=
# When Compose service `db` is not running, point at another Postgres container
# (auto-detected from LOCAL_DB_PORT when unset). Example: LOCAL_DB_CONTAINER=lms_db
LOCAL_DB_CONTAINER ?=
# App models use Postgres schema from DB_SCHEMA (local default: ci). Local
# "copies" are separate databases (ci_db, ci_db_prd_copy, …).
LOCAL_APP_SCHEMA := ci
# Resolve docker container + admin role for local backup/restore/shell.
RESOLVE_LOCAL_DB := LOCAL_DB_PORT=$(LOCAL_DB_PORT) LOCAL_DB_CONTAINER='$(LOCAL_DB_CONTAINER)' LOCAL_DB_USER='$(LOCAL_DB_USER)' LOCAL_DB_NAME='$(LOCAL_DB_NAME)' $(SCRIPTS_DIR)/resolve-local-db-container.sh

CRON_DISPATCH_INTERVAL ?= 180

# Optional remote database coordinates. Configure these in deploy.env; no
# client-specific infrastructure belongs in this application repo.
RENDER_DB_USER   ?= app_user
RENDER_DB_PORT   ?= 5432
RENDER_INT_HOST  ?=
RENDER_INT_DB    ?= app_db_int
RENDER_TST_HOST  ?=
RENDER_TST_DB    ?= app_db_tst
RENDER_PRD_HOST  ?=
RENDER_PRD_DB    ?= app_db_prd

# Local BE/FE listen ports. Prefer PORT= in be/config/.env.local and fe/.env.local.
# Override for one shot: make run-be BE_PORT=8001  /  make run-fe FE_PORT=3001
BE_ENV_LOCAL := $(BE_DIR)/config/.env.local
FE_ENV_LOCAL := $(FE_DIR)/.env.local
_read_env_port = $(shell sed -n 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*//p' $(1) 2>/dev/null | head -1 | tr -d '[:space:]"'"'"'')
BE_PORT ?= $(or $(call _read_env_port,$(BE_ENV_LOCAL)),8000)
FE_PORT ?= $(or $(call _read_env_port,$(FE_ENV_LOCAL)),3000)

.DEFAULT_GOAL := help

.PHONY: help setup setup-fe setup-be setup-mobile mobile-codegen mobile-analyze mobile-test \
	run-fe start-fe run-be run-fe-turbo run-dev run-cron \
	build-fe lint lint-fe lint-be clean clean-fe clean-be \
	test-unit-be-setup test-unit-be-db test-unit-be-no-db test-unit-be-db-cov test-unit-be-no-db-cov \
	test-unit-fe-setup test-unit-fe test-unit-fe-cov test-unit-fe-cov-broad \
	test-st-api-setup test-st-api test-st-api-inventory \
	test-st-ui-setup test-st-ui-run test-st-ui test-st-ui-smoke test-st-ui-headed test-st-ui-headed-slow test-st-ui-interactive test-st-ui-codegen test-st-ui-report \
	test-all \
	migrate-db migrate-db-status \
	migrate migrate-dev migrate-test migrate-prd migrate-all _migrate-run \
	load-db-image start-db stop-db db-shell db-shell-test setup-test-db reset-test-db backup-db restore-db \
	run-caddy stop-caddy restart-caddy status-caddy \
	ghcr-login docker-build-be docker-build-fe docker-push-be docker-push-fe \
	sast sast-pr sast-images setup-sast build-images push-images build-docker build-be build-fe-docker push \
	resolve-tag render-deploy build-env build-all \
	deploy-env deploy-all deploy-all-envs ship-all ship-all-envs \
	deploy-dev deploy-test deploy-prd \
	build-dev build-test build-prd \
	ship-dev ship-test ship-prd \
	_build-pipeline _deploy-pipeline \
	deploy-local deploy-local-down build-local \
	git-promote-dev git-promote-tst git-promote-prd git-promote-all

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
help:
	@echo "$(GREEN)Platform monorepo$(NC) — all commands from this Makefile"
	@echo ""
	@echo "$(YELLOW)Setup:$(NC)"
	@echo "  - setup               — install frontend + backend dependencies"
	@echo "  - setup-fe            — npm install in fe/"
	@echo "  - setup-be            — Python venv + pip install in be/"
	@echo "  - setup-mobile        — install Flutter dependencies in fe_mobile/"
	@echo "  - mobile-codegen      — generate Flutter model and serialization code"
	@echo "  - mobile-analyze      — analyze the Flutter application"
	@echo "  - mobile-test         — run Flutter tests"
	@echo ""
	@echo "$(YELLOW)Dev:$(NC)"
	@echo "  - run-be              — uvicorn API with reload (localhost:$(BE_PORT); set PORT in be/config/.env.local)"
	@echo "  - run-fe              — Next.js dev server (localhost:$(FE_PORT); set PORT in fe/.env.local)"
	@echo "  - run-fe-turbo        — Next.js dev server with Turbopack"
	@echo "  - start-fe            — Next.js production server (run make build-fe first)"
	@echo "  - run-dev             — open run-be + run-fe in new Terminal windows (macOS)"
	@echo "  - run-cron            — prod-like cron dispatcher every 3 min (reads DB schedules)"
	@echo ""
	@echo "$(YELLOW)Build:$(NC)"
	@echo "  - build-fe            — Next.js production build (writes fe/.next)"
	@echo "  - lint                — lint frontend and backend"
	@echo "  - clean               — remove build caches and artifacts"
	@echo ""
	@echo "$(YELLOW)Backend unit tests (test_unit_be/):$(NC)"
	@echo "  - test-unit-be-setup           — install backend pytest tooling (be/.venv)"
	@echo "  - test-unit-be-no-db      — unit tests (mocked; no Postgres)"
	@echo "  - test-unit-be-db         — unit + integration (Postgres $(LOCAL_TEST_DB_NAME))"
	@echo "  - test-unit-be-no-db-cov  — unit coverage (no DB; fail under BE_COV_FAIL_UNDER, default 80%)"
	@echo "  - test-unit-be-db-cov     — unit+integration coverage (Postgres; same fail-under gate)"
	@echo ""
	@echo "$(YELLOW)Frontend unit tests (test_unit_fe/):$(NC)"
	@echo "  - test-unit-fe-setup           — install frontend Vitest tooling (fe/ node_modules)"
	@echo "  - test-unit-fe            — frontend unit tests"
	@echo "  - test-unit-fe-cov        — FE coverage gate surface: fe/lib/utils only (target 80%, stretch 85–90%)"
	@echo "  - test-unit-fe-cov-broad  — optional diluted report (utils + all components)"
	@echo ""
	@echo "$(YELLOW)API tests (test_st_api/ — live HTTP):$(NC)"
	@echo "  - test-st-api-setup          — install API pytest tooling"
	@echo "  - test-st-api             — live HTTP API tests (MODULE=chapters; backend must be running)"
	@echo "  - test-st-api-inventory   — static check: every backend route is mentioned in test_st_api (not full behavioral coverage)"
	@echo ""
	@echo "$(YELLOW)UI system tests (test_st_ui/ — Playwright):$(NC)"
	@echo "  - test-st-ui-setup          — install Playwright + Chromium"
	@echo "  - test-st-ui-run            — Playwright UI suite (PROJECT=… SPEC=… HEADED=1 SLOW=1)"
	@echo "  - test-st-ui-interactive    — Playwright interactive UI mode"
	@echo "  - test-st-ui-codegen        — Playwright recorder/codegen"
	@echo "  - test-st-ui-report         — open last Playwright HTML report"
	@echo ""
	@echo "$(YELLOW)DB:$(NC)"
	@echo "  - start-db            — start local Postgres (Docker Compose)"
	@echo "  - setup-test-db       — create/seed $(LOCAL_TEST_DB_NAME) database"
	@echo "  - db-shell            — psql into local $(LOCAL_DB_NAME) (auto-detects container)"
	@echo "  - db-shell-test       — psql into local $(LOCAL_TEST_DB_NAME)"
	@echo "  - backup-db           — interactive backup (local DB or Render)"
	@echo "  - restore-db          — interactive restore; local asks which database"
	@echo "                          override container: LOCAL_DB_CONTAINER=lms_db"
	@echo "  - migrate-db          — apply NNN_*.sql (TARGET=…; prompts [y/N] when TARGET set)"
	@echo "  - migrate-db-status   — show applied vs unapplied SQL for a TARGET"
	@echo "  - migrate-dev         — prompt [y/N], then migrate integration (dev)"
	@echo "  - migrate-test        — prompt [y/N], then migrate test (tst)"
	@echo "  - migrate-prd         — prompt [y/N], then migrate production (prod)"
	@echo "  - migrate-all         — prompt [y/N] per env: dev → test → prod"
	@echo "  - migrate             — alias for migrate-all"
	@echo ""
	@echo "$(YELLOW)Proxy:$(NC)"
	@echo "  - run-caddy           — start local HTTPS proxy (*.clinicle-ci.local + *.clinicle-cms.local)"
	@echo "  - stop-caddy          — stop Caddy"
	@echo "  - restart-caddy       — stop then start Caddy (use after changing PORT)"
	@echo "  - status-caddy        — show whether Caddy is running"
	@echo ""
	@echo "$(YELLOW)Docker:$(NC)"
	@echo "  - ghcr-login          — docker login to GitHub Container Registry"
	@echo "  - docker-build-be     — build backend image (IMAGE_TAG=...)"
	@echo "  - docker-build-fe     — build frontend image (ENV=..., BUILD_ARG_FILE=...)"
	@echo "  - push-images         — push BE + FE images to GHCR"
	@echo ""
	@echo "$(YELLOW)Deploy:$(NC)"
	@echo "  - sast                — Semgrep on fe/ + be/ (code phase)"
	@echo "  - sast-images         — Trivy HIGH/CRITICAL on local BE/FE images (post-build gate)"
	@echo "  - build-images        — build backend + frontend Docker images (no push)"
	@echo "  - build-dev/test/prd   — SAST + tests + Docker build + push to GHCR (no Render)"
	@echo "  - deploy-dev/test/prd  — trigger Render deploy hooks only (images already on GHCR)"
	@echo "  - ship-dev/test/prd    — build-* then deploy-* (old all-in-one)"
	@echo "  - build-all           — build+push images for dev → tst → prd (5s pause)"
	@echo "  - deploy-all          — Render hooks for dev → tst → prd (5s pause)"
	@echo "  - ship-all            — build-all then deploy-all"
	@echo "  - deploy-local        — build local images + run be/fe stack in Docker"
	@echo ""
	@echo "$(YELLOW)Promote:$(NC)"
	@echo "  - git-promote-dev     — PR + merge: GIT_SOURCE_BRANCH → dev (soft docs reminder)"
	@echo "  - git-promote-tst     — PR + merge: dev → tst"
	@echo "  - git-promote-prd     — PR + merge: tst → main (3s pause)"
	@echo "  - git-promote-all     — dev → tst → main in sequence (5s pause)"
	@echo ""
	@echo "$(YELLOW)Notes:$(NC)"
	@echo "  - DB passwords: devops/deploy/deploy.env (Render), or export RENDER_DB_PASSWORD"
	@echo "  - TEST_SKIP=1 skips test-unit-be-db-cov and test-unit-fe on build-*"
	@echo "  - Deploy does not run DB migrations — use make migrate-dev / migrate-test / migrate-prd"
	@echo "  - Low-downtime release: build-* → migrate-* → deploy-* (Render hooks only)"
	@echo "  - Typical release: git-promote-* → build-* → migrate-* → deploy-*"
	@echo "  - Deploy BE gate: test-unit-be-db-cov (unit gate surface ≥ BE_COV_FAIL_UNDER%, default 80%; see test_unit_be/.coveragerc)"
	@echo "  - BE_COV_FAIL_UNDER=0 disables the backend coverage fail gate"
	@echo "  - TEST_INTEGRATION=0 runs test-unit-be-db / *-db-cov without integration tests"
	@echo ""
	@echo "$(YELLOW)Examples:$(NC)"
	@echo "  - make test-unit-be-setup && make test-unit-be-no-db"
	@echo "  - make test-unit-fe-setup && make test-unit-fe"
	@echo "  - make test-st-api-setup && make run-be && make test-st-api MODULE=auth"
	@echo "  - make test-st-ui-setup && make test-st-ui-run PROJECT=smoke"
	@echo "  - make setup && make start-db && make run-be"
	@echo "  - make ghcr-login && make docker-build-be IMAGE_TAG=first && make docker-push-be IMAGE_TAG=first"
	@echo "  - make git-promote-dev && make build-dev && make migrate-dev && make deploy-dev"
	@echo "  - make git-promote-all && make migrate-all && make ship-all"

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
setup: setup-fe setup-be

setup-fe:
	@echo "Setting up frontend..."
	@if [ ! -f "$(FE_DIR)/node_modules/.bin/next" ]; then \
		cd $(FE_DIR) && npm install; \
	else \
		echo "Frontend dependencies already installed."; \
	fi

setup-be:
	@echo "Setting up backend..."
	@if [ ! -d "$(BE_VENV)" ]; then \
		cd $(BE_DIR) && $(PYTHON) -m venv .venv; \
	fi
	@cd $(BE_DIR) && . .venv/bin/activate && pip install -q -r requirements.txt

setup-mobile:
	@echo "Setting up mobile frontend..."
	@cd $(MOBILE_DIR) && flutter pub get

mobile-codegen: setup-mobile
	@cd $(MOBILE_DIR) && dart run build_runner build

mobile-analyze: setup-mobile
	@cd $(MOBILE_DIR) && flutter analyze

mobile-test: setup-mobile
	@cd $(MOBILE_DIR) && flutter test

# ---------------------------------------------------------------------------
# Development
# ---------------------------------------------------------------------------
run-fe: setup-fe
	@echo "Starting frontend on http://localhost:$(FE_PORT)"
	@cd $(FE_DIR) && PORT=$(FE_PORT) NODE_TLS_REJECT_UNAUTHORIZED=0 NODE_OPTIONS='--max-old-space-size=6144' npm run dev

run-fe-turbo: setup-fe
	@echo "Starting frontend (Turbopack) on http://localhost:$(FE_PORT)"
	@cd $(FE_DIR) && PORT=$(FE_PORT) NODE_TLS_REJECT_UNAUTHORIZED=0 NODE_OPTIONS='--max-old-space-size=6144' npm run dev:turbo

start-fe: setup-fe
	@if [ ! -d "$(FE_DIR)/.next" ]; then \
		echo "$(RED)No production build found. Run: make build-fe$(NC)"; \
		exit 1; \
	fi
	@echo "Starting frontend (production) on http://localhost:$(FE_PORT)"
	@cd $(FE_DIR) && PORT=$(FE_PORT) NODE_TLS_REJECT_UNAUTHORIZED=0 NODE_OPTIONS='--max-old-space-size=6144' npm run start

run-be: setup-be
	@echo "Starting backend on http://localhost:$(BE_PORT)"
	@cd $(BE_DIR) && . .venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port $(BE_PORT)

run-dev:
	@echo "$(YELLOW)Opening backend and frontend in new Terminal windows...$(NC)"
	@echo "$(YELLOW)Tip: use Cursor terminals with 'make run-be' and 'make run-fe' instead.$(NC)"
	@osascript -e 'tell application "Terminal" to do script "cd $(MONO_ROOT) && make run-be BE_PORT=$(BE_PORT)"'
	@osascript -e 'tell application "Terminal" to do script "cd $(MONO_ROOT) && make run-fe FE_PORT=$(FE_PORT)"'
	@echo "$(GREEN)Started. BE: http://localhost:$(BE_PORT)  FE: http://localhost:$(FE_PORT)$(NC)"

run-cron: setup-be
	@echo "$(GREEN)Cron dispatcher — every $$(($(CRON_DISPATCH_INTERVAL)/60)) minutes (Ctrl+C to stop)$(NC)"
	@echo "$(YELLOW)To mimic Render locally, set ENABLE_INLINE_SCHEDULERS=false for make run-be; dispatch reads DB job schedules.$(NC)"
	@cd $(BE_DIR) && . .venv/bin/activate && \
	while true; do \
	  echo ""; \
	  echo "$(GREEN)=== Cron dispatch $$(date -u '+%Y-%m-%d %H:%M:%S UTC') ===$(NC)"; \
	  CRON_TRIGGER=scheduled $(PYTHON) -m app.cron dispatch || \
	    echo "$(RED)Cron dispatch failed; will retry in $$(($(CRON_DISPATCH_INTERVAL)/60)) minutes$(NC)"; \
	  echo "$(YELLOW)Next dispatch in $$(($(CRON_DISPATCH_INTERVAL)/60)) minutes...$(NC)"; \
	  sleep $(CRON_DISPATCH_INTERVAL); \
	done

# ---------------------------------------------------------------------------
# Build, lint, clean
# ---------------------------------------------------------------------------
build-fe:
	@echo "$(GREEN)Building frontend (Next.js production)...$(NC)"
	@cd $(FE_DIR) && npm run build
	@echo "$(GREEN)Frontend build complete. Run: make start-fe$(NC)"

lint: lint-fe lint-be

lint-fe:
	@cd $(FE_DIR) && npm run lint

lint-be:
	@$(BE_VENV_BIN)/flake8 $(BE_DIR)/app/
	@$(BE_VENV_BIN)/black $(BE_DIR)/app/
	@$(BE_VENV_BIN)/isort $(BE_DIR)/app/

clean: clean-fe clean-be
	@echo "$(GREEN)Clean complete.$(NC) Removed build/cache artifacts only (not node_modules, .venv, or database)."

clean-fe:
	@echo "$(YELLOW)Cleaning frontend ($(FE_DIR)):$(NC) .next, out, dist, node_modules/.cache, .turbo, logs"
	@cd $(FE_DIR) && rm -rf .next out dist node_modules/.cache .turbo logs

clean-be:
	@echo "$(YELLOW)Cleaning backend ($(BE_DIR)):$(NC) __pycache__, .pytest_cache, htmlcov, .coverage, dist, build, logs, *.egg-info"
	@cd $(BE_DIR) && rm -rf __pycache__ .pytest_cache htmlcov .coverage dist build logs *.egg-info
	@find $(BE_DIR) -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------
# Apply devops/db-migrations/NNN_*.sql (or FILE=...) to one or more DBs.
# Examples:
#   make migrate-db                              # interactive target + file picker
#   make migrate-db TARGET=all
#   make migrate-db TARGET=prod FILE=devops/db-migrations/001_example.sql
#   make migrate-db TARGET=render DRY_RUN=1
#   make migrate-db TARGET=int RECORD_ONLY=1 FILE=devops/db-migrations/002_example.sql
TARGET ?=
FILE ?=
DRY_RUN ?=
RECORD_ONLY ?=
MIGRATE_YES ?=

migrate-db:
	@bash -c ' \
		yes_args=""; \
		if [ "$(MIGRATE_YES)" = "1" ]; then \
			yes_args="--yes"; \
		elif [ -n "$(TARGET)" ]; then \
			read -r -p "Apply DB migrations to $(TARGET)? [y/N]: " migrate_choice; \
			if [[ ! "$$migrate_choice" =~ ^[yY]$$ ]]; then \
				echo "$(YELLOW)Migration skipped$(NC)"; exit 0; \
			fi; \
			yes_args="--yes"; \
		fi; \
		exec env \
			APP_SCHEMA="$(LOCAL_APP_SCHEMA)" \
			LOCAL_DB_USER="$(LOCAL_DB_USER)" \
			LOCAL_DB_NAME="$(LOCAL_DB_NAME)" \
			LOCAL_DB_TARGET="$(LOCAL_DB_TARGET)" \
			LOCAL_DB_CONTAINER="$(LOCAL_DB_CONTAINER)" \
			LOCAL_DB_PORT="$(LOCAL_DB_PORT)" \
			"$(SCRIPTS_DIR)/migrate-db.sh" \
			$(if $(TARGET),--target $(TARGET),) \
			$(if $(FILE),--file $(FILE),) \
			$(if $(filter 1,$(DRY_RUN)),--dry-run,) \
			$(if $(filter 1,$(RECORD_ONLY)),--record-only,) \
			$$yes_args \
	'

migrate-db-status:
	@env \
		APP_SCHEMA="$(LOCAL_APP_SCHEMA)" \
		LOCAL_DB_USER="$(LOCAL_DB_USER)" \
		LOCAL_DB_NAME="$(LOCAL_DB_NAME)" \
		LOCAL_DB_TARGET="$(LOCAL_DB_TARGET)" \
		LOCAL_DB_CONTAINER="$(LOCAL_DB_CONTAINER)" \
		LOCAL_DB_PORT="$(LOCAL_DB_PORT)" \
		$(SCRIPTS_DIR)/migrate-db.sh --status \
		$(if $(TARGET),--target $(TARGET),) \
		$(if $(FILE),--file $(FILE),)

# Internal: run migrations for one Render env (caller must confirm or pass MIGRATE_YES=1).
_migrate-run:
	@echo "$(YELLOW)Applying DB migrations to $(MIGRATE_TARGET)…$(NC)"
	@env \
		APP_SCHEMA="$(LOCAL_APP_SCHEMA)" \
		LOCAL_DB_USER="$(LOCAL_DB_USER)" \
		LOCAL_DB_NAME="$(LOCAL_DB_NAME)" \
		LOCAL_DB_TARGET="$(LOCAL_DB_TARGET)" \
		LOCAL_DB_CONTAINER="$(LOCAL_DB_CONTAINER)" \
		LOCAL_DB_PORT="$(LOCAL_DB_PORT)" \
		$(SCRIPTS_DIR)/migrate-db.sh --target $(MIGRATE_TARGET) \
		$(if $(FILE),--file $(FILE),) \
		--yes \
		$(if $(filter 1,$(DRY_RUN)),--dry-run,) \
		$(if $(filter 1,$(RECORD_ONLY)),--record-only,)

migrate-dev:
	@bash -c ' \
		read -r -p "Apply DB migrations to dev (integration)? [y/N]: " migrate_choice; \
		if [[ "$$migrate_choice" =~ ^[yY]$$ ]]; then \
			$(MAKE) _migrate-run MIGRATE_TARGET=dev; \
		else \
			echo "$(YELLOW)Skipped dev (integration) migrations$(NC)"; \
		fi \
	'

migrate-test:
	@bash -c ' \
		read -r -p "Apply DB migrations to test? [y/N]: " migrate_choice; \
		if [[ "$$migrate_choice" =~ ^[yY]$$ ]]; then \
			$(MAKE) _migrate-run MIGRATE_TARGET=tst; \
		else \
			echo "$(YELLOW)Skipped test migrations$(NC)"; \
		fi \
	'

migrate-prd:
	@echo "$(RED)Production DB migration$(NC)"
	@bash -c ' \
		read -r -p "Apply DB migrations to production? [y/N]: " migrate_choice; \
		if [[ "$$migrate_choice" =~ ^[yY]$$ ]]; then \
			$(MAKE) _migrate-run MIGRATE_TARGET=prod; \
		else \
			echo "$(YELLOW)Skipped production migrations$(NC)"; \
		fi \
	'

migrate-all:
	@echo "$(YELLOW)DB migrations — confirm each environment$(NC)"
	@bash -c ' \
		read -r -p "Apply migrations to dev (integration)? [y/N]: " migrate_choice; \
		if [[ "$$migrate_choice" =~ ^[yY]$$ ]]; then $(MAKE) _migrate-run MIGRATE_TARGET=dev; fi \
	'
	@bash -c ' \
		read -r -p "Apply migrations to test? [y/N]: " migrate_choice; \
		if [[ "$$migrate_choice" =~ ^[yY]$$ ]]; then $(MAKE) _migrate-run MIGRATE_TARGET=tst; fi \
	'
	@bash -c ' \
		read -r -p "Apply migrations to production? [y/N]: " migrate_choice; \
		if [[ "$$migrate_choice" =~ ^[yY]$$ ]]; then $(MAKE) _migrate-run MIGRATE_TARGET=prod; fi \
	'

migrate: migrate-all

# ---------------------------------------------------------------------------
# Backend unit tests (test_unit_be/)
# Postgres $(LOCAL_TEST_DB_NAME) for *-db targets: make setup-test-db. Override: TEST_DATABASE_URL=...
# ---------------------------------------------------------------------------
TEST_DATABASE_URL ?= postgresql://$(LOCAL_DB_USER):$(LOCAL_DB_PASSWORD)@localhost:$(LOCAL_DB_PORT)/$(LOCAL_TEST_DB_NAME)
# Backend coverage gate for deploy / *-cov targets (≥ this % of the unit gate
# surface in test_unit_be/.coveragerc). Set 0 to disable.
BE_COV_FAIL_UNDER ?= 80
BE_COV_FAIL_ARGS = $(if $(filter 0,$(BE_COV_FAIL_UNDER)),,--cov-fail-under=$(BE_COV_FAIL_UNDER))

# Shared warning when pytest-cov exits below BE_COV_FAIL_UNDER.
define be_cov_fail_warning
	echo ""; \
	echo "$(RED)WARNING: Backend coverage/tests gate failed.$(NC)"; \
	echo "$(RED)Need unit-gate coverage ≥ $(BE_COV_FAIL_UNDER)% (see test_unit_be/.coveragerc) and all tests passing. Build/deploy stopped.$(NC)"; \
	echo "$(YELLOW)Bypass:$(NC) BE_COV_FAIL_UNDER=0  $(YELLOW)Report:$(NC) test_unit_be/htmlcov/index.html"; \
	exit 1
endef

test-unit-be-setup: setup-be
	@command -v $(PYTHON) >/dev/null 2>&1 || { \
		echo "$(RED)Need $(PYTHON) (Python 3.12). Install via pyenv, Homebrew, or python.org$(NC)"; exit 1; }
	@echo "$(GREEN)Backend unit test tooling ready (be/.venv).$(NC)"

test-unit-be-no-db: test-unit-be-setup
	@echo "Running backend unit tests (no DB)..."
	@cd $(TEST_UNIT_BE) && $(BE_VENV_BIN)/python -m pytest -m "not integration"

test-unit-be-db: test-unit-be-setup reset-test-db
	@echo "Running backend unit + integration tests (Postgres: $(TEST_DATABASE_URL))..."
	@pg_isready -h localhost -p 5432 >/dev/null 2>&1 || ( \
		echo "$(RED)Postgres not reachable. Run: make start-db$(NC)"; exit 1)
	@cd $(TEST_UNIT_BE) && . $(BE_VENV)/bin/activate && \
		TEST_DATABASE_URL="$(TEST_DATABASE_URL)" $(BE_VENV_BIN)/python -m pytest \
		$(if $(filter 0,$(TEST_INTEGRATION)),-m "not integration",)

test-unit-be-no-db-cov: test-unit-be-setup
	@echo "Running backend unit coverage (no DB; fail under $(BE_COV_FAIL_UNDER)%)..."
	@cd $(TEST_UNIT_BE) && . $(BE_VENV)/bin/activate && \
		$(BE_VENV_BIN)/python -m pytest -m "not integration" --cov=../be/app \
		--cov-config=.coveragerc \
		--cov-report=term --cov-report=html:htmlcov -q \
		$(BE_COV_FAIL_ARGS) \
		|| { $(be_cov_fail_warning); }
	@echo "$(GREEN)HTML coverage:$(NC) test_unit_be/htmlcov/index.html"

test-unit-be-db-cov: test-unit-be-setup reset-test-db
	@echo "Running backend unit+integration coverage (fail under $(BE_COV_FAIL_UNDER)%)..."
	@pg_isready -h localhost -p 5432 >/dev/null 2>&1 || ( \
		echo "$(RED)Postgres not reachable. Run: make start-db$(NC)"; exit 1)
	@cd $(TEST_UNIT_BE) && . $(BE_VENV)/bin/activate && \
		TEST_DATABASE_URL="$(TEST_DATABASE_URL)" $(BE_VENV_BIN)/python -m pytest --cov=../be/app \
		--cov-config=.coveragerc \
		--cov-report=term-missing --cov-report=html \
		$(BE_COV_FAIL_ARGS) \
		$(if $(filter 0,$(TEST_INTEGRATION)),-m "not integration",) \
		|| { $(be_cov_fail_warning); }
	@echo "$(GREEN)HTML coverage:$(NC) test_unit_be/htmlcov/index.html"

# ---------------------------------------------------------------------------
# Frontend unit tests (test_unit_fe/ + fe Vitest)
# ---------------------------------------------------------------------------
test-unit-fe-setup: setup-fe
	@command -v node >/dev/null 2>&1 || { \
		echo "$(RED)Need Node.js 18+. Install via nvm, Homebrew, or nodejs.org$(NC)"; exit 1; }
	@command -v npm >/dev/null 2>&1 || { \
		echo "$(RED)Need npm (bundled with Node.js)$(NC)"; exit 1; }
	@echo "$(GREEN)Frontend unit test tooling ready (fe/node_modules).$(NC)"

test-unit-fe: test-unit-fe-setup
	@echo "Running frontend unit tests..."
	@cd $(FE_DIR) && npm run test

test-unit-fe-cov: test-unit-fe-setup
	@echo "Running frontend unit tests with coverage (fe/lib/utils gate)..."
	@cd $(FE_DIR) && npm run test:cov
	@echo "$(GREEN)HTML coverage:$(NC) test_unit_fe/coverage/index.html"

# Diluted report — do not use as the leadership % gate
test-unit-fe-cov-broad: test-unit-fe-setup
	@echo "Running frontend coverage including components (diluted; not the gate)..."
	@cd $(FE_DIR) && npm run test:cov:broad
	@echo "$(GREEN)HTML coverage:$(NC) test_unit_fe/coverage/index.html"

# ---------------------------------------------------------------------------
# API tests (test_st_api/ — live HTTP; backend must be running)
# ---------------------------------------------------------------------------
test-st-api-setup: setup-be
	@command -v $(PYTHON) >/dev/null 2>&1 || { \
		echo "$(RED)Need $(PYTHON) (Python 3.12). Install via pyenv, Homebrew, or python.org$(NC)"; exit 1; }
	@echo "API tests use pytest from $(BE_VENV)."
	@echo "$(GREEN)API test tooling ready.$(NC)"

test-st-api: test-st-api-setup
	@$(BE_VENV_BIN)/python $(TEST_ST_API)/scripts/route_coverage.py --check
	@cd $(TEST_ST_API) && \
		$(if $(API_BASE_URL),API_BASE_URL="$(API_BASE_URL)",) \
		$(if $(ORG_DOMAIN),ORG_DOMAIN="$(ORG_DOMAIN)",) \
		$(if $(filter 1 true yes,$(STRICT)),API_TEST_STRICT=1,) \
		. $(BE_VENV_BIN)/activate && \
		$(BE_VENV_BIN)/python -m pytest $(if $(MODULE),tests/$(MODULE),tests) $(PYTEST_ARGS)

# Static inventory only: fails if a route path is never referenced in test_st_api,
# or a module lacks COVERAGE.md. Does not prove the route is fully tested.
test-st-api-inventory: test-st-api-setup
	@$(BE_VENV_BIN)/python $(TEST_ST_API)/scripts/route_coverage.py --check --unreferenced

# ---------------------------------------------------------------------------
# UI system tests (test_st_ui/ — Playwright)
# Set URL in test_st_ui/.env or: make test-st-ui-run PLAYWRIGHT_BASE_URL=https://acme.localhost
# ---------------------------------------------------------------------------
test-st-ui-setup:
	@command -v node >/dev/null 2>&1 || { \
		echo "$(RED)Need Node.js 18+. Install via nvm, Homebrew, or nodejs.org$(NC)"; exit 1; }
	@command -v npm >/dev/null 2>&1 || { \
		echo "$(RED)Need npm (bundled with Node.js)$(NC)"; exit 1; }
	@echo "Setting up Playwright UI system tests (test_st_ui/)..."
	@cd $(TEST_ST_UI) && npm install
	@cd $(TEST_ST_UI) && env -u PLAYWRIGHT_BROWSERS_PATH npx playwright install chromium
	@chmod +x $(TEST_ST_UI)/scripts/resolve-base-url.sh $(TEST_ST_UI)/scripts/run-e2e.sh
	@echo "$(GREEN)UI system test tooling ready.$(NC)"

# PROJECT — Playwright project (user, org-admin, smoke, …)
# SPEC   — spec file; PAGE is deprecated alias
# GREP   — optional title filter; HEADED=1, SLOW=1, or DEBUG=1
test-st-ui-run: test-st-ui-setup
	@cd $(TEST_ST_UI) && \
		$(if $(PLAYWRIGHT_BASE_URL),PLAYWRIGHT_BASE_URL="$(PLAYWRIGHT_BASE_URL)",) \
		$(if $(PLAYWRIGHT_SLOW_MO),PLAYWRIGHT_SLOW_MO="$(PLAYWRIGHT_SLOW_MO)",) \
		PROJECT="$(PROJECT)" SPEC="$(SPEC)" PAGE="$(PAGE)" GREP="$(GREP)" HEADED="$(HEADED)" SLOW="$(SLOW)" DEBUG="$(DEBUG)" \
		./scripts/run-e2e.sh

test-st-ui: test-st-ui-run

test-st-ui-smoke:
	@$(MAKE) test-st-ui-run PROJECT=smoke

test-st-ui-headed:
	@$(MAKE) test-st-ui-run HEADED=1

# Default 500ms slowMo only for headed-slow; do not export for normal runs
# (slowMo forces single-worker / debug mode in playwright.config.ts).
test-st-ui-headed-slow:
	@$(MAKE) test-st-ui-run SLOW=1 PLAYWRIGHT_SLOW_MO="$(or $(PLAYWRIGHT_SLOW_MO),500)"

test-st-ui-interactive: test-st-ui-setup
	@echo "$(YELLOW)Playwright UI against $$($(TEST_ST_UI)/scripts/resolve-base-url.sh)$(NC)"
	@cd $(TEST_ST_UI) && env -u PLAYWRIGHT_BROWSERS_PATH \
		$(if $(PLAYWRIGHT_BASE_URL),PLAYWRIGHT_BASE_URL="$(PLAYWRIGHT_BASE_URL)",) \
		npm run test:ui

test-st-ui-codegen: test-st-ui-setup
	@echo "$(YELLOW)Playwright codegen against $$($(TEST_ST_UI)/scripts/resolve-base-url.sh)$(NC)"
	@cd $(TEST_ST_UI) && env -u PLAYWRIGHT_BROWSERS_PATH \
		$(if $(PLAYWRIGHT_BASE_URL),PLAYWRIGHT_BASE_URL="$(PLAYWRIGHT_BASE_URL)",) \
		npx playwright codegen "$$($(TEST_ST_UI)/scripts/resolve-base-url.sh)"

test-st-ui-report:
	@cd $(TEST_ST_UI) && npm run report

test-all: test-unit-be-db test-unit-fe test-st-ui-run

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
load-db-image:
	@echo "$(YELLOW)Loading PostgreSQL database image...$(NC)"
	@if docker images | grep -q "$(DB_IMAGE_NAME):$(DB_VERSION)"; then \
		echo "$(GREEN)Database image $(DB_IMAGE_NAME):$(DB_VERSION) already exists$(NC)"; \
	else \
		echo "$(YELLOW)Pulling database image $(DB_IMAGE_NAME):$(DB_VERSION)...$(NC)"; \
		docker pull $(DB_IMAGE_NAME):$(DB_VERSION); \
		echo "$(GREEN)Database image loaded successfully!$(NC)"; \
	fi

start-db:
	@echo "$(YELLOW)Starting database service...$(NC)"
	@if ! $(DC) up -d db; then \
		echo "$(RED)Failed to start Compose service 'db'.$(NC)"; \
		echo "$(YELLOW)If port $(LOCAL_DB_PORT) is already taken by another Postgres container,$(NC)"; \
		echo "$(YELLOW)backup/restore will auto-detect it, or set LOCAL_DB_CONTAINER=<name>.$(NC)"; \
		exit 1; \
	fi
	@echo "$(YELLOW)Waiting for database to be ready...$(NC)"
	@until $(DC) exec -T db pg_isready -U $(LOCAL_DB_USER) -d $(LOCAL_DB_NAME) > /dev/null 2>&1; do \
		echo "$(YELLOW)Database starting...$(NC)"; sleep 2; \
	done
	@echo "$(GREEN)Database service started and ready!$(NC)"

stop-db:
	@echo "$(YELLOW)Stopping database service...$(NC)"
	$(DC) stop db
	@echo "$(GREEN)Database service stopped!$(NC)"

db-shell:
	@eval "$$($(RESOLVE_LOCAL_DB))" || { \
		echo "$(RED)No local Postgres container found. Run: make start-db$(NC)"; \
		echo "$(YELLOW)Or set LOCAL_DB_CONTAINER=<running-postgres-container>$(NC)"; \
		exit 1; \
	}; \
	echo "$(YELLOW)Using container $$LOCAL_DB_DOCKER_CONTAINER (via $$LOCAL_DB_VIA)$(NC)"; \
	docker exec -it "$$LOCAL_DB_DOCKER_CONTAINER" psql -U "$(LOCAL_DB_USER)" -d "$(if $(LOCAL_DB_TARGET),$(LOCAL_DB_TARGET),$(LOCAL_DB_NAME))"

db-shell-test:
	@eval "$$($(RESOLVE_LOCAL_DB))" || { \
		echo "$(RED)No local Postgres container found. Run: make start-db$(NC)"; exit 1; \
	}; \
	docker exec -it "$$LOCAL_DB_DOCKER_CONTAINER" psql -U "$(LOCAL_DB_USER)" -d "$(LOCAL_TEST_DB_NAME)"

setup-test-db:
	@eval "$$($(RESOLVE_LOCAL_DB))" || { \
		echo "$(YELLOW)No local Postgres container found — trying make start-db...$(NC)"; \
		$(MAKE) start-db; \
		eval "$$($(RESOLVE_LOCAL_DB))" || { \
			echo "$(RED)No local Postgres container found. Run: make start-db$(NC)"; \
			echo "$(YELLOW)Or set LOCAL_DB_CONTAINER=<running-postgres-container>$(NC)"; \
			exit 1; \
		}; \
	}; \
	echo "$(YELLOW)Using container $$LOCAL_DB_DOCKER_CONTAINER (via $$LOCAL_DB_VIA)$(NC)"; \
	DB_CONTAINER="$$LOCAL_DB_DOCKER_CONTAINER" \
	DB_ADMIN_USER="$$LOCAL_DB_ADMIN_USER" \
	DB_ADMIN_DB="$$LOCAL_DB_ADMIN_DB" \
	DB_USER="$(LOCAL_DB_USER)" \
	DB_PASSWORD="$(LOCAL_DB_PASSWORD)" \
	SOURCE_DB="$(LOCAL_DB_NAME)" \
	TEST_DB="$(LOCAL_TEST_DB_NAME)" \
	FORCE=0 \
	POSTGRES_PORT="$(LOCAL_DB_PORT)" \
	$(SCRIPTS_DIR)/setup-test-db.sh

reset-test-db:
	@eval "$$($(RESOLVE_LOCAL_DB))" || { \
		echo "$(YELLOW)No local Postgres container found — trying make start-db...$(NC)"; \
		$(MAKE) start-db; \
		eval "$$($(RESOLVE_LOCAL_DB))" || { \
			echo "$(RED)No local Postgres container found. Run: make start-db$(NC)"; \
			echo "$(YELLOW)Or set LOCAL_DB_CONTAINER=<running-postgres-container>$(NC)"; \
			exit 1; \
		}; \
	}; \
	echo "$(YELLOW)Using container $$LOCAL_DB_DOCKER_CONTAINER (via $$LOCAL_DB_VIA)$(NC)"; \
	DB_CONTAINER="$$LOCAL_DB_DOCKER_CONTAINER" \
	DB_ADMIN_USER="$$LOCAL_DB_ADMIN_USER" \
	DB_ADMIN_DB="$$LOCAL_DB_ADMIN_DB" \
	DB_USER="$(LOCAL_DB_USER)" \
	DB_PASSWORD="$(LOCAL_DB_PASSWORD)" \
	SOURCE_DB="$(LOCAL_DB_NAME)" \
	TEST_DB="$(LOCAL_TEST_DB_NAME)" \
	FORCE=1 \
	POSTGRES_PORT="$(LOCAL_DB_PORT)" \
	$(SCRIPTS_DIR)/setup-test-db.sh

backup-db:
	@echo "$(YELLOW)Select source database to backup:$(NC)"
	@echo "  1. Local (Docker)"
	@echo "  2. Integration (Render)"
	@echo "  3. Test (Render)"
	@echo "  4. Production (Render)"
	@echo ""
	@printf "$(YELLOW)Enter database selection (1-4):$(NC) "; \
	read db_choice; \
	echo ""; \
	if [[ "$$db_choice" = "1" ]]; then \
		db_host="$(LOCAL_DB_HOST)"; db_port="$(LOCAL_DB_PORT)"; db_user="$(LOCAL_DB_USER)"; \
		db_env="local"; use_docker=true; \
		eval "$$($(RESOLVE_LOCAL_DB))" || { \
			echo "$(RED)No local Postgres container found.$(NC)"; \
			echo "$(YELLOW)Start Compose Postgres with: make start-db$(NC)"; \
			echo "$(YELLOW)Or set LOCAL_DB_CONTAINER=<running-postgres-container>$(NC)"; \
			exit 1; \
		}; \
		db_container="$$LOCAL_DB_DOCKER_CONTAINER"; \
		db_admin_user="$$LOCAL_DB_ADMIN_USER"; \
		db_admin_db="$$LOCAL_DB_ADMIN_DB"; \
		echo "$(GREEN)Using container $$db_container (via $$LOCAL_DB_VIA) as $$db_admin_user$(NC)"; \
		if [ -n "$(LOCAL_DB_TARGET)" ]; then \
			db_name="$(LOCAL_DB_TARGET)"; \
			echo "$(YELLOW)Using local database override: $$db_name$(NC)"; \
		else \
			echo "$(YELLOW)Select local database to back up (each has its own '$(LOCAL_APP_SCHEMA)' schema):$(NC)"; \
			local_dbs=$$(docker exec "$$db_container" psql -U "$$db_admin_user" -d "$$db_admin_db" -tAc "SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn AND datname NOT IN ('postgres') ORDER BY CASE datname WHEN 'ci_db' THEN 0 WHEN 'app_db' THEN 1 WHEN 'ci_db_prd_copy' THEN 2 WHEN 'app_db_prd_copy' THEN 3 WHEN 'ci_db_unit_test' THEN 4 WHEN 'app_db_unit_test' THEN 5 ELSE 6 END, datname;"); \
			if [ -z "$$local_dbs" ]; then echo "$(RED)No local databases found inside $$db_container.$(NC)"; exit 1; fi; \
			file_num=0; \
			for name in $$local_dbs; do \
				file_num=$$((file_num + 1)); \
				hint=""; \
				case "$$name" in \
					ci_db|app_db) hint=" — development" ;; \
					ci_db_prd_copy|app_db_prd_copy) hint=" — production copy" ;; \
					ci_db_unit_test|app_db_unit_test) hint=" — pytest" ;; \
				esac; \
				echo "  $$file_num. $$name$$hint"; \
			done; \
			local_count=$$file_num; echo ""; \
			printf "$(YELLOW)Enter local database number (1-$$local_count):$(NC) "; read local_selection; \
			if [ "$$local_selection" -ge 1 ] && [ "$$local_selection" -le "$$local_count" ] 2>/dev/null; then \
				db_name=$$(echo "$$local_dbs" | sed -n "$$local_selection p"); \
			else echo "$(RED)Invalid selection. Please run the command again.$(NC)"; exit 1; fi; \
		fi; \
	elif [[ "$$db_choice" = "2" ]]; then \
		db_host="$(RENDER_INT_HOST)"; db_port="$(RENDER_DB_PORT)"; db_user="$(RENDER_DB_USER)"; \
		db_name="$(RENDER_INT_DB)"; db_env="integration"; use_docker=false; \
	elif [[ "$$db_choice" = "3" ]]; then \
		db_host="$(RENDER_TST_HOST)"; db_port="$(RENDER_DB_PORT)"; db_user="$(RENDER_DB_USER)"; \
		db_name="$(RENDER_TST_DB)"; db_env="test"; use_docker=false; \
	elif [[ "$$db_choice" = "4" ]]; then \
		db_host="$(RENDER_PRD_HOST)"; db_port="$(RENDER_DB_PORT)"; db_user="$(RENDER_DB_USER)"; \
		db_name="$(RENDER_PRD_DB)"; db_env="production"; use_docker=false; \
	else \
		echo "$(RED)Invalid database selection. Please run the command again.$(NC)"; exit 1; \
	fi; \
	echo "$(YELLOW)Selected: $$db_env database ($$db_name)$(NC)"; \
	echo ""; \
	echo "$(YELLOW)Select backup format:$(NC)"; \
	echo "  1. SQL format (.sql) - Human readable, smaller size"; \
	echo "  2. Dump format (.dump) - Binary format, faster restore"; \
	echo ""; \
	printf "$(YELLOW)Enter format selection (1 or 2):$(NC) "; read format_choice; echo ""; \
	if [[ "$$format_choice" = "1" ]]; then format="sql"; format_flag=""; ext="sql"; \
	elif [[ "$$format_choice" = "2" ]]; then format="dump"; format_flag="-Fc"; ext="dump"; \
	else echo "$(RED)Invalid format selection. Please run the command again.$(NC)"; exit 1; fi; \
	timestamp=$$(date +%Y-%m-%d_%H-%M-%S_%Z); \
	backup_file="backup_$${db_env}_$${db_name}_$${timestamp}.$${ext}"; \
	echo "$(YELLOW)Creating $$format backup from $$db_env database ($$db_name)...$(NC)"; \
	echo "$(YELLOW)Backup file: $$backup_file$(NC)"; \
	echo "$(YELLOW)Backup in progress (this may take a few minutes)...$(NC)"; \
	mkdir -p "$(DB_BACKUP_PATH)"; \
	if [[ "$$use_docker" = "true" ]]; then \
		dump_user="$$db_admin_user"; \
		if docker exec "$$db_container" psql -U "$(LOCAL_DB_USER)" -d "$$db_name" -c 'SELECT 1' >/dev/null 2>&1; then \
			dump_user="$(LOCAL_DB_USER)"; \
		fi; \
		if [[ "$$format" = "sql" ]]; then \
			(docker exec "$$db_container" pg_dump -U "$$dump_user" -d "$$db_name" > $(DB_BACKUP_PATH)/$$backup_file) & backup_pid=$$!; \
		else \
			(docker exec "$$db_container" pg_dump -U "$$dump_user" -d "$$db_name" $$format_flag > $(DB_BACKUP_PATH)/$$backup_file) & backup_pid=$$!; \
		fi; \
		dot_count=0; \
		while kill -0 $$backup_pid 2>/dev/null; do \
			printf "$(YELLOW).$(NC)"; dot_count=$$((dot_count + 1)); \
			if [ $$dot_count -eq 10 ]; then printf "\n$(YELLOW)Still backing up...$(NC)"; dot_count=0; fi; \
			sleep 1; \
		done; \
		wait $$backup_pid; backup_status=$$?; echo ""; \
	else \
		if [ -z "$$RENDER_DB_PASSWORD" ]; then \
			case "$$db_env" in \
				integration) db_pw="$(RENDER_DEV_DB_PASSWORD)" ;; \
				test) db_pw="$(RENDER_TST_DB_PASSWORD)" ;; \
				production) db_pw="$(RENDER_PROD_DB_PASSWORD)" ;; \
			esac; \
			if [ -n "$$db_pw" ]; then \
				echo "$(GREEN)Using database password from $(DEPLOY_ENV_FILE)$(NC)"; \
				export PGPASSWORD="$$db_pw"; \
			else \
				echo "$(YELLOW)Enter database password for $$db_env:$(NC)"; \
				read -rs db_password; echo ""; export PGPASSWORD="$$db_password"; \
			fi; \
		else \
			echo "$(GREEN)Using database password from RENDER_DB_PASSWORD environment variable$(NC)"; \
			export PGPASSWORD="$$RENDER_DB_PASSWORD"; \
		fi; \
		export PGSSLMODE=require; \
		if [[ "$$format" = "sql" ]]; then \
			(pg_dump -h $$db_host -p $$db_port -U $$db_user -d $$db_name > $(DB_BACKUP_PATH)/$$backup_file) & backup_pid=$$!; \
		else \
			(pg_dump -h $$db_host -p $$db_port -U $$db_user -d $$db_name $$format_flag > $(DB_BACKUP_PATH)/$$backup_file) & backup_pid=$$!; \
		fi; \
		dot_count=0; \
		while kill -0 $$backup_pid 2>/dev/null; do \
			printf "$(YELLOW).$(NC)"; dot_count=$$((dot_count + 1)); \
			if [ $$dot_count -eq 10 ]; then printf "\n$(YELLOW)Still backing up...$(NC)"; dot_count=0; fi; \
			sleep 1; \
		done; \
		wait $$backup_pid; backup_status=$$?; echo ""; \
		unset PGSSLMODE PGPASSWORD; \
	fi; \
	if [ $$backup_status -ne 0 ]; then echo "$(RED)Backup process failed!$(NC)"; exit 1; fi; \
	if [ -f "$(DB_BACKUP_PATH)/$$backup_file" ]; then \
		file_size=$$(du -h $(DB_BACKUP_PATH)/$$backup_file | cut -f1); \
		echo "$(GREEN)$$format backup created successfully!$(NC)"; \
		echo "$(GREEN)File: $(DB_BACKUP_PATH)/$$backup_file$(NC)"; \
		echo "$(GREEN)Size: $$file_size$(NC)"; \
	else echo "$(RED)Backup failed! Please check the error messages above.$(NC)"; exit 1; fi

restore-db:
	@echo "$(YELLOW)Select target database to restore to:$(NC)"
	@echo "  1. Local (Docker)"
	@echo "  2. Integration (Render)"
	@echo "  3. Test (Render)"
	@echo "  4. Production (Render)"
	@echo ""
	@printf "$(YELLOW)Enter database selection (1-4):$(NC) "; \
	read db_choice; echo ""; \
	if [[ "$$db_choice" = "1" ]]; then \
		db_host="$(LOCAL_DB_HOST)"; db_port="$(LOCAL_DB_PORT)"; db_user="$(LOCAL_DB_USER)"; \
		db_env="local"; use_docker=true; \
		eval "$$($(RESOLVE_LOCAL_DB))" || { \
			echo "$(RED)No local Postgres container found.$(NC)"; \
			echo "$(YELLOW)Start Compose Postgres with: make start-db$(NC)"; \
			echo "$(YELLOW)Or set LOCAL_DB_CONTAINER=<running-postgres-container>$(NC)"; \
			exit 1; \
		}; \
		db_container="$$LOCAL_DB_DOCKER_CONTAINER"; \
		db_admin_user="$$LOCAL_DB_ADMIN_USER"; \
		db_admin_db="$$LOCAL_DB_ADMIN_DB"; \
		db_via="$$LOCAL_DB_VIA"; \
		echo "$(GREEN)Using container $$db_container (via $$db_via) as $$db_admin_user$(NC)"; \
		if [ -n "$(LOCAL_DB_TARGET)" ]; then \
			db_name="$(LOCAL_DB_TARGET)"; \
			echo "$(YELLOW)Using local database override: $$db_name$(NC)"; \
			exists=$$(docker exec "$$db_container" psql -U "$$db_admin_user" -d "$$db_admin_db" -tAc "SELECT 1 FROM pg_database WHERE datname = '$$db_name'"); \
			if [ "$$exists" != "1" ]; then \
				echo "$(YELLOW)Database '$$db_name' does not exist yet. Creating it...$(NC)"; \
				docker exec "$$db_container" psql -U "$$db_admin_user" -d "$$db_admin_db" -c "CREATE DATABASE \"$$db_name\" OWNER $(LOCAL_DB_USER);"; \
			fi; \
		else \
			echo "$(YELLOW)Select local database to restore into:$(NC)"; \
			echo "$(YELLOW)(App uses schema '$(LOCAL_APP_SCHEMA)'; keep development and production copies as separate databases.)$(NC)"; \
			local_dbs=$$(docker exec "$$db_container" psql -U "$$db_admin_user" -d "$$db_admin_db" -tAc "SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn AND datname NOT IN ('postgres') ORDER BY CASE datname WHEN 'ci_db' THEN 0 WHEN 'app_db' THEN 1 WHEN 'ci_db_prd_copy' THEN 2 WHEN 'app_db_prd_copy' THEN 3 WHEN 'ci_db_unit_test' THEN 4 WHEN 'app_db_unit_test' THEN 5 ELSE 6 END, datname;"); \
			if [ -z "$$local_dbs" ]; then echo "$(RED)No local databases found inside $$db_container.$(NC)"; exit 1; fi; \
			file_num=0; \
			for name in $$local_dbs; do \
				file_num=$$((file_num + 1)); \
				hint=""; \
				case "$$name" in \
					ci_db|app_db) hint=" — development (day-to-day work)" ;; \
					ci_db_prd_copy|app_db_prd_copy) hint=" — production copy (migration / prod-data testing)" ;; \
					ci_db_unit_test|app_db_unit_test) hint=" — pytest (schema-only; usually leave alone)" ;; \
				esac; \
				echo "  $$file_num. $$name$$hint"; \
			done; \
			create_option=$$((file_num + 1)); \
			echo "  $$create_option. Create a new local database…"; \
			local_count=$$file_num; echo ""; \
			printf "$(YELLOW)Enter selection (1-$$create_option):$(NC) "; read local_selection; \
			if [ "$$local_selection" = "$$create_option" ]; then \
				printf "$(YELLOW)New database name (letters, numbers, underscore; e.g. ci_db_prd_copy):$(NC) "; read new_db_name; \
				new_db_name=$$(echo "$$new_db_name" | tr -d '[:space:]'); \
				if ! echo "$$new_db_name" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$$'; then \
					echo "$(RED)Invalid database name '$$new_db_name'.$(NC)"; exit 1; \
				fi; \
				exists=$$(docker exec "$$db_container" psql -U "$$db_admin_user" -d "$$db_admin_db" -tAc "SELECT 1 FROM pg_database WHERE datname = '$$new_db_name'"); \
				if [ "$$exists" = "1" ]; then \
					echo "$(YELLOW)Database '$$new_db_name' already exists; restoring into it.$(NC)"; \
				else \
					echo "$(YELLOW)Creating database '$$new_db_name'...$(NC)"; \
					docker exec "$$db_container" psql -U "$$db_admin_user" -d "$$db_admin_db" -c "CREATE DATABASE \"$$new_db_name\" OWNER $(LOCAL_DB_USER);"; \
				fi; \
				db_name="$$new_db_name"; \
			elif [ "$$local_selection" -ge 1 ] && [ "$$local_selection" -le "$$local_count" ] 2>/dev/null; then \
				db_name=$$(echo "$$local_dbs" | sed -n "$$local_selection p"); \
			else echo "$(RED)Invalid selection. Please run the command again.$(NC)"; exit 1; fi; \
		fi; \
		if [ "$$db_name" = "$(LOCAL_TEST_DB_NAME)" ]; then \
			echo "$(RED)WARNING: You selected the pytest database ($(LOCAL_TEST_DB_NAME)).$(NC)"; \
			printf "$(YELLOW)Type 'yes' to confirm restoring into it:$(NC) "; read test_confirm; \
			if [[ "$$test_confirm" != "yes" ]]; then echo "$(RED)Restore cancelled.$(NC)"; exit 1; fi; \
		fi; \
	elif [[ "$$db_choice" = "2" ]]; then \
		db_host="$(RENDER_INT_HOST)"; db_port="$(RENDER_DB_PORT)"; db_user="$(RENDER_DB_USER)"; \
		db_name="$(RENDER_INT_DB)"; db_env="integration"; use_docker=false; \
	elif [[ "$$db_choice" = "3" ]]; then \
		db_host="$(RENDER_TST_HOST)"; db_port="$(RENDER_DB_PORT)"; db_user="$(RENDER_DB_USER)"; \
		db_name="$(RENDER_TST_DB)"; db_env="test"; use_docker=false; \
	elif [[ "$$db_choice" = "4" ]]; then \
		db_host="$(RENDER_PRD_HOST)"; db_port="$(RENDER_DB_PORT)"; db_user="$(RENDER_DB_USER)"; \
		db_name="$(RENDER_PRD_DB)"; db_env="production"; use_docker=false; \
		echo "$(RED)WARNING: You are about to restore to PRODUCTION database!$(NC)"; \
		printf "$(YELLOW)Type 'yes' to confirm:$(NC) "; read confirm; \
		if [[ "$$confirm" != "yes" ]]; then echo "$(RED)Restore cancelled.$(NC)"; exit 1; fi; \
	else echo "$(RED)Invalid database selection. Please run the command again.$(NC)"; exit 1; fi; \
	echo "$(YELLOW)Selected: $$db_env database ($$db_name)$(NC)"; echo ""; \
	if [ -n "$(BACKUP_FILE)" ]; then \
		if [ -f "$(DB_BACKUP_PATH)/$(BACKUP_FILE)" ]; then selected_file="$(BACKUP_FILE)"; \
		else echo "$(RED)Backup file $(BACKUP_FILE) not found in $(DB_BACKUP_PATH)$(NC)"; exit 1; fi; \
	else \
		echo "$(YELLOW)Available backup files (newest first):$(NC)"; \
		backup_list=$$(ls -t $(DB_BACKUP_PATH)/*.dump $(DB_BACKUP_PATH)/*.sql 2>/dev/null | head -20); \
		if [ -z "$$backup_list" ]; then echo "$(RED)No backup files found in $(DB_BACKUP_PATH)$(NC)"; exit 1; fi; \
		file_num=0; \
		for file in $$backup_list; do file_num=$$((file_num + 1)); \
			if [ "$$(uname)" = "Darwin" ]; then \
				file_mtime=$$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$$file"); \
			else file_mtime=$$(stat -c "%y" "$$file" | cut -d. -f1); fi; \
			echo "  $$file_num. $$(basename "$$file")  [$${file_mtime}]"; \
		done; \
		backup_count=$$file_num; echo ""; \
		printf "$(YELLOW)Enter the number of the backup file to restore (1-$$backup_count):$(NC) "; read selection; \
		if [ "$$selection" -ge 1 ] && [ "$$selection" -le "$$backup_count" ] 2>/dev/null; then \
			selected_file=$$(echo "$$backup_list" | sed -n "$$selection p" | xargs basename); \
		else echo "$(RED)Invalid selection. Please run the command again.$(NC)"; exit 1; fi; \
	fi; \
	echo "$(YELLOW)Selected file: $$selected_file$(NC)"; \
	echo "$(YELLOW)Target database: $$db_env ($$db_name)$(NC)"; echo ""; \
	echo "$(RED)WARNING: This restore will drop and recreate schema '$(LOCAL_APP_SCHEMA)' on $$db_env ($$db_name).$(NC)"; \
	echo "$(YELLOW)Other local databases are left untouched.$(NC)"; \
	echo "$(YELLOW)A pre-restore backup can protect the current target database before it is overwritten.$(NC)"; \
	printf "$(YELLOW)Create pre-restore backup of current target database first? [Y/n]:$(NC) "; read safety_backup_choice; \
	case "$$safety_backup_choice" in n|N|no|NO|No|nO) create_safety_backup=false ;; *) create_safety_backup=true ;; esac; \
	if [[ "$$create_safety_backup" = "true" ]]; then \
		echo "$(GREEN)Pre-restore backup will be created before restore.$(NC)"; \
	else \
		echo "$(RED)Pre-restore backup skipped at your request.$(NC)"; \
	fi; \
	printf "$(YELLOW)Type 'restore' to confirm and continue:$(NC) "; read restore_confirm; \
	if [[ "$$restore_confirm" != "restore" ]]; then echo "$(RED)Restore cancelled.$(NC)"; exit 1; fi; \
	echo ""; \
	if [[ "$$use_docker" = "true" ]]; then \
		$(DC) stop backend 2>/dev/null || true; \
		restore_user="$$db_admin_user"; \
		if docker exec "$$db_container" psql -U "$(LOCAL_DB_USER)" -d "$$db_name" -c 'SELECT 1' >/dev/null 2>&1; then \
			restore_user="$(LOCAL_DB_USER)"; \
		fi; \
		if [[ "$$create_safety_backup" = "true" ]]; then \
			safety_timestamp=$$(date +%Y-%m-%d_%H-%M-%S_%Z); \
			safety_backup_file="backup_$${db_env}_$${db_name}_pre_restore_$${safety_timestamp}.dump"; \
			echo "$(YELLOW)Creating pre-restore backup: $$safety_backup_file$(NC)"; \
			mkdir -p "$(DB_BACKUP_PATH)"; \
			docker exec "$$db_container" pg_dump -U "$$restore_user" -d "$$db_name" -Fc > $(DB_BACKUP_PATH)/$$safety_backup_file; \
			safety_backup_status=$$?; \
			if [ $$safety_backup_status -ne 0 ]; then \
				$(DC) start backend 2>/dev/null || true; \
				echo "$(RED)Pre-restore backup failed. Restore cancelled.$(NC)"; exit 1; \
			fi; \
			echo "$(GREEN)Pre-restore backup created: $(DB_BACKUP_PATH)/$$safety_backup_file$(NC)"; \
		fi; \
		echo "$(YELLOW)Dropping and recreating schema '$(LOCAL_APP_SCHEMA)' on $$db_name...$(NC)"; \
		docker exec "$$db_container" psql -U "$$restore_user" -d "$$db_name" -c "DROP SCHEMA IF EXISTS $(LOCAL_APP_SCHEMA) CASCADE; CREATE SCHEMA $(LOCAL_APP_SCHEMA) AUTHORIZATION $(LOCAL_DB_USER);"; \
		echo "$(YELLOW)Restoring database...$(NC)"; \
		if [[ "$$db_via" = "compose" ]]; then \
			if [[ "$$selected_file" == *.sql ]]; then \
				docker exec "$$db_container" psql -U "$$restore_user" -d "$$db_name" -f /backups/$$selected_file; \
			else \
				docker exec "$$db_container" pg_restore -U "$$restore_user" -d "$$db_name" --no-owner --no-privileges -v /backups/$$selected_file; \
			fi; \
		else \
			if [[ "$$selected_file" == *.sql ]]; then \
				docker exec -i "$$db_container" psql -U "$$restore_user" -d "$$db_name" < $(DB_BACKUP_PATH)/$$selected_file; \
			else \
				docker exec -i "$$db_container" pg_restore -U "$$restore_user" -d "$$db_name" --no-owner --no-privileges -v < $(DB_BACKUP_PATH)/$$selected_file; \
			fi; \
		fi; \
		restore_status=$$?; \
		$(DC) start backend 2>/dev/null || true; \
	else \
		if [ -z "$$RENDER_DB_PASSWORD" ]; then \
			case "$$db_env" in \
				integration) db_pw="$(RENDER_DEV_DB_PASSWORD)" ;; \
				test) db_pw="$(RENDER_TST_DB_PASSWORD)" ;; \
				production) db_pw="$(RENDER_PROD_DB_PASSWORD)" ;; \
			esac; \
			if [ -n "$$db_pw" ]; then export PGPASSWORD="$$db_pw"; \
			else \
				echo "$(YELLOW)Enter database password for $$db_env:$(NC)"; read -rs db_password; echo ""; \
				export PGPASSWORD="$$db_password"; \
			fi; \
		else export PGPASSWORD="$$RENDER_DB_PASSWORD"; fi; \
		export PGSSLMODE=require; \
		if [[ "$$create_safety_backup" = "true" ]]; then \
			safety_timestamp=$$(date +%Y-%m-%d_%H-%M-%S_%Z); \
			safety_backup_file="backup_$${db_env}_$${db_name}_pre_restore_$${safety_timestamp}.dump"; \
			echo "$(YELLOW)Creating pre-restore backup: $$safety_backup_file$(NC)"; \
			mkdir -p "$(DB_BACKUP_PATH)"; \
			pg_dump -h $$db_host -p $$db_port -U $$db_user -d $$db_name -Fc > $(DB_BACKUP_PATH)/$$safety_backup_file; \
			safety_backup_status=$$?; \
			if [ $$safety_backup_status -ne 0 ]; then \
				unset PGPASSWORD PGSSLMODE; \
				echo "$(RED)Pre-restore backup failed. Restore cancelled.$(NC)"; exit 1; \
			fi; \
			echo "$(GREEN)Pre-restore backup created: $(DB_BACKUP_PATH)/$$safety_backup_file$(NC)"; \
		fi; \
		echo "$(YELLOW)Dropping and recreating schema '$(LOCAL_APP_SCHEMA)' on $$db_name...$(NC)"; \
		psql -h $$db_host -p $$db_port -U $$db_user -d $$db_name -c "DROP SCHEMA IF EXISTS $(LOCAL_APP_SCHEMA) CASCADE; CREATE SCHEMA $(LOCAL_APP_SCHEMA) AUTHORIZATION $$db_user;"; \
		echo "$(YELLOW)Restoring database...$(NC)"; \
		if [[ "$$selected_file" == *.sql ]]; then \
			psql -h $$db_host -p $$db_port -U $$db_user -d $$db_name < $(DB_BACKUP_PATH)/$$selected_file; \
		else \
			pg_restore -h $$db_host -p $$db_port -U $$db_user -d $$db_name --no-owner --no-privileges -v $(DB_BACKUP_PATH)/$$selected_file; \
		fi; \
		restore_status=$$?; unset PGPASSWORD PGSSLMODE; \
	fi; \
	if [ $$restore_status -eq 0 ]; then echo "$(GREEN)Database restored successfully!$(NC)"; \
	elif [ $$restore_status -eq 1 ] && [[ "$$selected_file" == *.dump ]]; then \
		echo "$(YELLOW)Database restored with non-fatal warnings (see messages above).$(NC)"; \
	else echo "$(RED)Database restore failed! Please check the error messages above.$(NC)"; exit 1; fi; \
	if [[ "$$use_docker" = "true" ]]; then \
		echo ""; \
		echo "$(GREEN)Point the backend at this local database by setting in be/config/.env.local:$(NC)"; \
		echo "  DATABASE_URL=postgresql://$(LOCAL_DB_USER):$(LOCAL_DB_PASSWORD)@$(LOCAL_DB_HOST):$(LOCAL_DB_PORT)/$$db_name"; \
		echo "  DB_SCHEMA=$(LOCAL_APP_SCHEMA)"; \
		echo "$(YELLOW)Then restart the backend (make run-be).$(NC)"; \
	fi

# ---------------------------------------------------------------------------
# Caddy (local HTTPS proxy)
# ---------------------------------------------------------------------------
run-caddy:
	@echo "$(YELLOW)Starting Caddy HTTPS proxy (CI FE:3003/BE:8003, CMS FE:3004/BE:8004)...$(NC)"
	@if pgrep caddy > /dev/null; then \
		echo "$(GREEN)Caddy is already running$(NC)"; \
		echo "$(YELLOW)Restart with make restart-caddy after changing Caddyfile or ports$(NC)"; \
		$(MAKE) status-caddy; \
	else \
		cd $(DEVOPS_DIR) && caddy start --config Caddyfile; \
		sleep 2; \
		if pgrep caddy > /dev/null; then echo "$(GREEN)Caddy started successfully!$(NC)"; \
		else echo "$(RED)Failed to start Caddy$(NC)"; exit 1; fi; \
	fi

stop-caddy:
	@echo "$(YELLOW)Stopping Caddy HTTPS proxy...$(NC)"
	@if pgrep caddy > /dev/null; then caddy stop; else echo "$(GREEN)Caddy is not running$(NC)"; fi

restart-caddy: stop-caddy
	@sleep 1
	@$(MAKE) run-caddy

status-caddy:
	@echo "$(YELLOW)Caddy Status:$(NC)"
	@if pgrep caddy > /dev/null; then \
		echo "$(GREEN)Caddy is running$(NC) (CI → :3003/:8003, CMS → :3004/:8004)"; \
	else echo "$(RED)Caddy is not running$(NC)"; fi

# ---------------------------------------------------------------------------
# Docker build & push (GHCR)
# ---------------------------------------------------------------------------
docker-build-be:
	@echo "Building $(REGISTRY)/$(GHCR_PACKAGE_BE):$(IMAGE_TAG)..."
	@cd $(BE_DIR) && docker buildx build \
		--platform $(DOCKER_PLATFORM) \
		$(DOCKER_NO_CACHE_FLAG) \
		--provenance=false \
		--sbom=false \
		-f Dockerfile \
		--build-arg APP_RELEASE_VERSION=$(APP_RELEASE_VERSION) \
		--build-arg APP_GIT_SHA=$(IMAGE_TAG) \
		-t $(REGISTRY)/$(GHCR_PACKAGE_BE):$(IMAGE_TAG) \
		-t $(GHCR_PACKAGE_BE):$(IMAGE_TAG) \
		--label org.opencontainers.image.revision=$(IMAGE_TAG) \
		--label org.opencontainers.image.version=$(APP_RELEASE_VERSION) \
		--load .

docker-build-fe:
	@if [ -n "$(BUILD_ARG_FILE)" ] && [ ! -f "$(BUILD_ARG_FILE)" ]; then \
		echo "BUILD_ARG_FILE not found: $(BUILD_ARG_FILE)"; exit 1; \
	fi
	@echo "Building $(REGISTRY)/$(GHCR_PACKAGE_FE):$(DEPLOY_ENV)-$(IMAGE_TAG)..."
	@cd $(FE_DIR) && \
	set -- ; \
	if [ -n "$(BUILD_ARG_FILE)" ]; then \
		while IFS= read -r line || [ -n "$$line" ]; do \
			case "$$line" in \#*|"") continue;; esac; \
			set -- "$$@" --build-arg "$$line"; \
		done < "$(BUILD_ARG_FILE)"; \
	fi; \
	set -- "$$@" \
		--build-arg "NEXT_PUBLIC_APP_RELEASE=$(APP_RELEASE_VERSION)" \
		--build-arg "NEXT_PUBLIC_APP_BUILD=$(APP_BUILD_ID)" \
		--build-arg "NEXT_PUBLIC_APP_ENV=$(DEPLOY_ENV)"; \
	docker buildx build \
		--platform $(DOCKER_PLATFORM) \
		$(DOCKER_NO_CACHE_FLAG) \
		--provenance=false \
		--sbom=false \
		-f Dockerfile \
		"$$@" \
		-t $(REGISTRY)/$(GHCR_PACKAGE_FE):$(DEPLOY_ENV)-$(IMAGE_TAG) \
		-t $(GHCR_PACKAGE_FE):$(DEPLOY_ENV)-$(IMAGE_TAG) \
		--label org.opencontainers.image.revision=$(IMAGE_TAG) \
		--label org.opencontainers.image.version=$(APP_RELEASE_VERSION) \
		--load .

docker-push-be:
	@$(SCRIPTS_DIR)/docker-push-ghcr.sh $(REGISTRY)/$(GHCR_PACKAGE_BE):$(IMAGE_TAG)
	@docker tag $(REGISTRY)/$(GHCR_PACKAGE_BE):$(IMAGE_TAG) $(REGISTRY)/$(GHCR_PACKAGE_BE):$(DEPLOY_ENV)
	@$(SCRIPTS_DIR)/docker-push-ghcr.sh $(REGISTRY)/$(GHCR_PACKAGE_BE):$(DEPLOY_ENV)

docker-push-fe:
	@$(SCRIPTS_DIR)/docker-push-ghcr.sh $(REGISTRY)/$(GHCR_PACKAGE_FE):$(DEPLOY_ENV)-$(IMAGE_TAG)
	@docker tag $(REGISTRY)/$(GHCR_PACKAGE_FE):$(DEPLOY_ENV)-$(IMAGE_TAG) $(REGISTRY)/$(GHCR_PACKAGE_FE):$(DEPLOY_ENV)
	@$(SCRIPTS_DIR)/docker-push-ghcr.sh $(REGISTRY)/$(GHCR_PACKAGE_FE):$(DEPLOY_ENV)

ghcr-login:
	@if [ -n "$(GITHUB_TOKEN)" ]; then \
		echo "$(GITHUB_TOKEN)" | docker login ghcr.io -u "$(if $(GHCR_USERNAME),$(GHCR_USERNAME),$(GHCR_OWNER))" --password-stdin; \
	elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then \
		echo "$(YELLOW)Using gh auth token (set GITHUB_TOKEN in deploy.env to use your PAT)$(NC)"; \
		gh auth token | docker login ghcr.io -u "$$(gh api user -q .login)" --password-stdin; \
	else \
		echo "Set GITHUB_TOKEN in devops/deploy/deploy.env or run: gh auth login -s write:packages,read:packages"; exit 1; \
	fi

# ---------------------------------------------------------------------------
# Deploy pipeline: build-* (GHCR) separate from deploy-* (Render hooks)
# ---------------------------------------------------------------------------
resolve-tag:
ifneq ($(origin IMAGE_TAG),command line)
	$(eval IMAGE_TAG := $(shell GIT_DEPLOY_BRANCH=$(GIT_DEPLOY_BRANCH) $(SCRIPTS_DIR)/resolve-image-tag.sh 2>/dev/null || echo local))
endif
	@echo "IMAGE_TAG=$(IMAGE_TAG) (branch $(GIT_DEPLOY_BRANCH)) · release $(APP_RELEASE_VERSION) · build $(DEPLOY_ENV)-$(IMAGE_TAG)"

sast: resolve-tag
	@ENV=$(ENV) IMAGE_TAG=$(IMAGE_TAG) SAST_PHASE=code $(SCRIPTS_DIR)/sast.sh

sast-pr:
	@SAST_PHASE=code $(SCRIPTS_DIR)/sast.sh

# Trivy HIGH/CRITICAL on local images for current ENV + IMAGE_TAG (after build-docker).
sast-images: resolve-tag
	@ENV=$(ENV) IMAGE_TAG=$(IMAGE_TAG) SAST_PHASE=images $(SCRIPTS_DIR)/sast.sh

setup-sast:
	@$(SCRIPTS_DIR)/setup-sast-tools.sh

build-be: resolve-tag
	@echo "$(YELLOW)Building backend $(REGISTRY)/$(GHCR_PACKAGE_BE):$(IMAGE_TAG)$(NC)"
	@$(MAKE) docker-build-be IMAGE_TAG=$(IMAGE_TAG) DOCKER_PLATFORM=$(DOCKER_PLATFORM)

build-fe-docker: resolve-tag
	@if [ ! -f "$(FE_BUILD_ARG_FILE)" ]; then \
		echo "$(RED)Missing $(FE_BUILD_ARG_FILE)$(NC)"; exit 1; \
	fi
	@echo "$(YELLOW)Building frontend $(REGISTRY)/$(GHCR_PACKAGE_FE):$(ENV)-$(IMAGE_TAG)$(NC)"
	@$(MAKE) docker-build-fe \
		IMAGE_TAG=$(IMAGE_TAG) \
		DEPLOY_ENV=$(ENV) \
		BUILD_ARG_FILE=$(abspath $(FE_BUILD_ARG_FILE)) \
		DOCKER_PLATFORM=$(DOCKER_PLATFORM)

build-docker: build-be build-fe-docker
build-images: build-docker

push: ghcr-login resolve-tag
	@$(MAKE) docker-push-be IMAGE_TAG=$(IMAGE_TAG) DEPLOY_ENV=$(ENV)
	@$(MAKE) docker-push-fe IMAGE_TAG=$(IMAGE_TAG) DEPLOY_ENV=$(ENV)
	@echo "$(GREEN)Pushed:$(NC)"
	@echo "  $(REGISTRY)/$(GHCR_PACKAGE_BE):$(IMAGE_TAG)  +  :$(ENV) (Render rolling tag)"
	@echo "  $(REGISTRY)/$(GHCR_PACKAGE_FE):$(ENV)-$(IMAGE_TAG)  +  :$(ENV) (Render rolling tag)"

push-images: push

# Docker build → Trivy (HIGH/CRITICAL) → push (no Render). Images ready on GHCR rolling tags.
build-env: resolve-tag
	@$(MAKE) build-docker ENV=$(ENV) GIT_DEPLOY_BRANCH=$(GIT_DEPLOY_BRANCH) IMAGE_TAG=$(IMAGE_TAG)
ifneq ($(SAST_SKIP_IMAGE),1)
ifneq ($(SAST_SKIP),1)
	@$(MAKE) sast-images ENV=$(ENV) GIT_DEPLOY_BRANCH=$(GIT_DEPLOY_BRANCH) IMAGE_TAG=$(IMAGE_TAG)
endif
endif
	@$(MAKE) push ENV=$(ENV) GIT_DEPLOY_BRANCH=$(GIT_DEPLOY_BRANCH) IMAGE_TAG=$(IMAGE_TAG)
	@echo "$(GREEN)Built and pushed $(ENV) images on GHCR. Next: make migrate-* then make deploy-* (Render hooks only).$(NC)"

# Internal: Semgrep → BE cov gate + FE tests → build-env (no Render).
_build-pipeline: resolve-tag
	@$(MAKE) sast ENV=$(ENV) GIT_DEPLOY_BRANCH=$(GIT_DEPLOY_BRANCH) IMAGE_TAG=$(IMAGE_TAG)
ifneq ($(TEST_SKIP),1)
	@$(MAKE) test-unit-be-db-cov TEST_DATABASE_URL=$(TEST_DATABASE_URL) BE_COV_FAIL_UNDER=$(BE_COV_FAIL_UNDER)
	@$(MAKE) test-unit-fe
endif
	@$(MAKE) build-env ENV=$(ENV) GIT_DEPLOY_BRANCH=$(GIT_DEPLOY_BRANCH) IMAGE_TAG=$(IMAGE_TAG) DEPLOY_ENV_NAME=$(DEPLOY_ENV_NAME)

build-dev:
	@$(MAKE) _build-pipeline ENV=dev GIT_DEPLOY_BRANCH=dev DEPLOY_ENV_NAME=dev

build-test:
	@$(MAKE) _build-pipeline ENV=tst GIT_DEPLOY_BRANCH=tst DEPLOY_ENV_NAME=tst

build-prd:
	@echo "$(RED)Production image build — confirm in 5s (Ctrl+C to cancel)$(NC)"
	@sleep 5
	@$(MAKE) _build-pipeline ENV=prod GIT_DEPLOY_BRANCH=main DEPLOY_ENV_NAME=prod

# Render deploy hooks only — assumes rolling tags already pushed via build-*.
render-deploy: resolve-tag
	@$(SCRIPTS_DIR)/render-deploy.sh $(DEPLOY_ENV_NAME)

deploy-dev:
	@echo "$(YELLOW)Triggering Render deploy hooks for dev (no build/push)$(NC)"
	@$(MAKE) render-deploy ENV=dev GIT_DEPLOY_BRANCH=dev DEPLOY_ENV_NAME=dev

deploy-test:
	@echo "$(YELLOW)Triggering Render deploy hooks for tst (no build/push)$(NC)"
	@$(MAKE) render-deploy ENV=tst GIT_DEPLOY_BRANCH=tst DEPLOY_ENV_NAME=tst

deploy-prd:
	@echo "$(RED)Production Render deploy — confirm in 5s (Ctrl+C to cancel)$(NC)"
	@sleep 5
	@echo "$(YELLOW)Triggering Render deploy hooks for prod (no build/push)$(NC)"
	@$(MAKE) render-deploy ENV=prod GIT_DEPLOY_BRANCH=main DEPLOY_ENV_NAME=prod

# All-in-one: build then Render (previous deploy-* behavior).
ship-dev:
	@$(MAKE) build-dev
	@$(MAKE) deploy-dev

ship-test:
	@$(MAKE) build-test
	@$(MAKE) deploy-test

ship-prd:
	@$(MAKE) build-prd
	@$(MAKE) deploy-prd

# Backward-compatible: build then Render for the current ENV vars.
_deploy-pipeline: resolve-tag
	@$(MAKE) _build-pipeline ENV=$(ENV) GIT_DEPLOY_BRANCH=$(GIT_DEPLOY_BRANCH) IMAGE_TAG=$(IMAGE_TAG) DEPLOY_ENV_NAME=$(DEPLOY_ENV_NAME)
	@$(MAKE) render-deploy ENV=$(ENV) GIT_DEPLOY_BRANCH=$(GIT_DEPLOY_BRANCH) IMAGE_TAG=$(IMAGE_TAG) DEPLOY_ENV_NAME=$(DEPLOY_ENV_NAME)

deploy-env: build-env
	@$(MAKE) render-deploy ENV=$(ENV) GIT_DEPLOY_BRANCH=$(GIT_DEPLOY_BRANCH) IMAGE_TAG=$(IMAGE_TAG) DEPLOY_ENV_NAME=$(DEPLOY_ENV_NAME)

# Semgrep + tests once, then per env: Docker build → Trivy → push (no Render).
build-all:
	@echo "$(YELLOW)Build images for all environments: dev → test → prd$(NC)"
	@echo "$(RED)Production included — confirm in 5s (Ctrl+C to cancel)$(NC)"
	@sleep 5
	@$(MAKE) sast ENV=dev GIT_DEPLOY_BRANCH=dev
ifneq ($(TEST_SKIP),1)
	@$(MAKE) test-unit-be-db-cov TEST_DATABASE_URL=$(TEST_DATABASE_URL) BE_COV_FAIL_UNDER=$(BE_COV_FAIL_UNDER)
	@$(MAKE) test-unit-fe
endif
	@echo "$(GREEN)==> build dev (branch dev)$(NC)"
	@$(MAKE) build-env ENV=dev GIT_DEPLOY_BRANCH=dev DEPLOY_ENV_NAME=dev
	@echo "$(GREEN)==> build test (branch tst)$(NC)"
	@$(MAKE) build-env ENV=tst GIT_DEPLOY_BRANCH=tst DEPLOY_ENV_NAME=tst
	@echo "$(GREEN)==> build prd (branch main)$(NC)"
	@$(MAKE) build-env ENV=prod GIT_DEPLOY_BRANCH=main DEPLOY_ENV_NAME=prod
	@echo "$(GREEN)All environment images built and pushed to GHCR. Run migrate-* then make deploy-all.$(NC)"

# Render hooks only for every env (images must already be built/pushed).
deploy-all deploy-all-envs:
	@echo "$(YELLOW)Render-deploy all environments: dev → test → prd$(NC)"
	@echo "$(RED)Production included — confirm in 5s (Ctrl+C to cancel)$(NC)"
	@sleep 5
	@echo "$(GREEN)==> deploy dev$(NC)"
	@$(MAKE) render-deploy ENV=dev GIT_DEPLOY_BRANCH=dev DEPLOY_ENV_NAME=dev
	@echo "$(GREEN)==> deploy test$(NC)"
	@$(MAKE) render-deploy ENV=tst GIT_DEPLOY_BRANCH=tst DEPLOY_ENV_NAME=tst
	@echo "$(GREEN)==> deploy prd$(NC)"
	@$(MAKE) render-deploy ENV=prod GIT_DEPLOY_BRANCH=main DEPLOY_ENV_NAME=prod
	@echo "$(GREEN)All environment deploy hooks triggered.$(NC)"

ship-all ship-all-envs:
	@$(MAKE) build-all
	@$(MAKE) deploy-all

build-local: ENV=dev
build-local: resolve-tag build-be build-fe-docker
	@docker tag $(REGISTRY)/$(GHCR_PACKAGE_BE):$(IMAGE_TAG) $(GHCR_PACKAGE_BE):local 2>/dev/null || \
		docker tag $(GHCR_PACKAGE_BE):$(IMAGE_TAG) $(GHCR_PACKAGE_BE):local
	@docker tag $(REGISTRY)/$(GHCR_PACKAGE_FE):$(ENV)-$(IMAGE_TAG) $(GHCR_PACKAGE_FE):local 2>/dev/null || \
		docker tag $(GHCR_PACKAGE_FE):$(ENV)-$(IMAGE_TAG) $(GHCR_PACKAGE_FE):local
	@echo "$(GREEN)Tagged $(GHCR_PACKAGE_BE):local and $(GHCR_PACKAGE_FE):local$(NC)"

deploy-local: build-local
ifneq ($(TEST_SKIP),1)
	@$(MAKE) test-unit-be-db-cov TEST_DATABASE_URL=$(TEST_DATABASE_URL) BE_COV_FAIL_UNDER=$(BE_COV_FAIL_UNDER)
	@$(MAKE) test-unit-fe
endif
	@echo "$(YELLOW)Starting local deploy stack...$(NC)"
	cd $(DEVOPS_DIR) && GHCR_PACKAGE_BE=$(GHCR_PACKAGE_BE) GHCR_PACKAGE_FE=$(GHCR_PACKAGE_FE) \
		$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) -f $(DEPLOY_COMPOSE) up -d db be fe
	@echo "$(GREEN)Local stack: FE http://localhost:$(FE_PORT) BE http://localhost:$(BE_PORT)$(NC)"

deploy-local-down:
	cd $(DEVOPS_DIR) && GHCR_PACKAGE_BE=$(GHCR_PACKAGE_BE) GHCR_PACKAGE_FE=$(GHCR_PACKAGE_FE) \
		$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) -f $(DEPLOY_COMPOSE) down be fe

git-promote-dev:
	@$(SCRIPTS_DIR)/git-promote.sh dev

git-promote-tst:
	@$(SCRIPTS_DIR)/git-promote.sh tst

git-promote-prd:
	@echo "$(RED)Promoting tst -> main via GitHub PR (auto-merge)$(NC)"
	@sleep 3
	@$(SCRIPTS_DIR)/git-promote.sh prod

git-promote-all:
	@echo "$(YELLOW)Promote all branches: dev → tst → main$(NC)"
	@echo "$(RED)Production (main) included — confirm in 5s (Ctrl+C to cancel)$(NC)"
	@sleep 5
	@$(MAKE) git-promote-dev
	@$(MAKE) git-promote-tst
	@$(MAKE) git-promote-prd

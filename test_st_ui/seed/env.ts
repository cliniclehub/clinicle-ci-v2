/** Seed-toolkit environment resolution. Loads test_st_ui/.env (same file Playwright uses). */

import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(__dirname, '..', '.env') })

export const DEFAULT_APP_BASE_URL = 'https://testorg-a.clinicle-ci.local'

/** Prefer ST_*; fall back to E2E_* for local .env migration. */
export function stEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return undefined
}

export function appBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? DEFAULT_APP_BASE_URL
}

/** Org domain for X-Organization-Domain / orgDomain payloads (host of the app URL). */
export function orgDomain(overrideUrl?: string): string {
  return new URL(overrideUrl ?? appBaseUrl()).hostname
}

/**
 * Backend API base (no trailing slash, includes /api/v1).
 * Explicit ST_API_BASE_URL wins; otherwise derived from the app host by swapping the
 * org subdomain for `api` (testorg-a.clinicle-ci.local → api.clinicle-ci.local).
 */
export function apiBaseUrl(): string {
  const explicit = stEnv('ST_API_BASE_URL', 'E2E_API_BASE_URL')
  if (explicit) return explicit.replace(/\/$/, '')
  const host = new URL(appBaseUrl()).hostname
  const apiHost = host.replace(/^[^.]+/, 'api')
  return `https://${apiHost}/api/v1`
}

/** Direct Postgres access to the target environment. Never commit the value. */
export function databaseUrl(): string {
  const url = stEnv('ST_DATABASE_URL', 'E2E_DATABASE_URL')
  if (!url) {
    throw new Error(
      'Set ST_DATABASE_URL in test_st_ui/.env — local example: ' +
        'postgresql://app_user:app_password@localhost:5432/app_db',
    )
  }
  return url
}

export function hasDatabaseUrl(): boolean {
  return Boolean(stEnv('ST_DATABASE_URL', 'E2E_DATABASE_URL'))
}

/** Postgres schema for seed oracle queries (local dump uses `ci`; some envs use `app`). */
export function databaseSchema(): string {
  return stEnv('ST_DATABASE_SCHEMA', 'E2E_DATABASE_SCHEMA', 'DB_SCHEMA') ?? 'app'
}

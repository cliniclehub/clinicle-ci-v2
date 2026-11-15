/**
 * Run-scoped naming for seeded data.
 *
 * Every entity created during a test run is named/e-mailed with the `st-run` prefix so
 * parallel runs never collide and cleanup can be scoped safely. Long-lived fixtures
 * (personas, flag-profile orgs) use the stable `st-fixture` prefix and are exempt from
 * run cleanup.
 *
 * Mailbox domains must NOT use `.local` / `.localhost` — EmailStr / email-validator
 * rejects those as special-use. Org *hosts* stay on `*.clinicle-ci.local`; emails use
 * `*.clinicle-test.com` (same pattern as dump users using `@allure.com`).
 */

import crypto from 'crypto'

import { stEnv } from './env'

export const FIXTURE_PREFIX = 'st-fixture'
export const RUN_PREFIX = 'st-run'
export const DEFAULT_ORG_DOMAIN = 'testorg-a.clinicle-ci.local'

let currentRunId: string | undefined

export function runId(): string {
  if (!currentRunId) {
    currentRunId =
      stEnv('ST_RUN_ID', 'E2E_RUN_ID') ||
      `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
  }
  return currentRunId
}

/**
 * Convert a tenant hostname into an EmailStr-safe mailbox domain.
 * `testorg-a.clinicle-ci.local` → `testorg-a.clinicle-test.com`
 */
export function emailDomainForOrg(orgHost: string): string {
  const host = orgHost.trim().toLowerCase()
  if (host.endsWith('.clinicle-ci.local')) {
    return `${host.slice(0, -'.clinicle-ci.local'.length)}.clinicle-test.com`
  }
  if (host.endsWith('.localhost')) {
    return `${host.slice(0, -'.localhost'.length)}.st-test.com`
  }
  return host
}

/** e.g. runName('user', 'active') → "st-run-m3k1ab12cd user active" prefix-safe label */
export function runName(...parts: string[]): string {
  return [`${RUN_PREFIX}-${runId()}`, ...parts].join(' ')
}

/** e.g. runSlug('user1') → "st-run-m3k1ab12cd-user1" */
export function runSlug(...parts: string[]): string {
  return [`${RUN_PREFIX}-${runId()}`, ...parts].join('-').toLowerCase()
}

/** Plus-addressed email unique to this run. Pass org host; mailbox domain is remapped. */
export function runEmail(label: string, orgHost = DEFAULT_ORG_DOMAIN): string {
  return `st+run-${runId()}-${label}@${emailDomainForOrg(orgHost)}`
}

export function fixtureEmail(label: string, orgHost = DEFAULT_ORG_DOMAIN): string {
  return `st+fixture-${label}@${emailDomainForOrg(orgHost)}`
}

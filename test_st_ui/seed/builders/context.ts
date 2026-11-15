import { RoleSessions, SeedApiClient } from '../api-client'
import { orgDomain, stEnv } from '../env'

export interface SeedActor {
  email: string
  password: string
  /** Login host domain when it differs from the org under test (super_admin → platform host). */
  domain?: string
}

/** Shared handle passed to all builders. */
export interface SeedContext {
  api: SeedApiClient
  sessions: RoleSessions
  /** Org subdomain the entities belong to (e.g. testorg-a.clinicle-ci.local). */
  orgDomain: string
  /** Required for org-scoped builders; optional during super_admin-only bootstrap. */
  orgAdmin?: SeedActor
  superAdmin?: SeedActor
}

/**
 * Full seed context for specs that already have Test Org A personas in `.env`.
 * Prefer ST_*; E2E_* is accepted as a migration fallback.
 */
export function createSeedContext(overrides: Partial<SeedContext> = {}): SeedContext {
  const api = overrides.api ?? new SeedApiClient()
  return {
    api,
    sessions: overrides.sessions ?? new RoleSessions(api),
    orgDomain: overrides.orgDomain ?? orgDomain(),
    orgAdmin:
      'orgAdmin' in overrides
        ? overrides.orgAdmin
        : {
            email: requireEnv(
              'ST_ORG_ADMIN_EMAIL',
              'E2E_ORG_ADMIN_EMAIL',
              'ST_ADMIN_EMAIL',
              'E2E_ADMIN_EMAIL',
            ),
            password: requireEnv(
              'ST_ORG_ADMIN_PASSWORD',
              'E2E_ORG_ADMIN_PASSWORD',
              'ST_ADMIN_PASSWORD',
              'E2E_ADMIN_PASSWORD',
            ),
          },
    superAdmin: overrides.superAdmin ?? optionalSuperAdmin(),
  }
}

/**
 * Bootstrap context: only super_admin is required so Test Org A/B can be created
 * without borrowing Allure (or any prior org-admin) credentials.
 */
export function createBootstrapContext(overrides: Partial<SeedContext> = {}): SeedContext {
  const api = overrides.api ?? new SeedApiClient()
  const superAdmin = overrides.superAdmin ?? optionalSuperAdmin()
  if (!superAdmin) {
    throw new Error(
      'Set ST_SUPER_ADMIN_EMAIL/PASSWORD (+ST_SUPER_ADMIN_BASE_URL) in test_st_ui/.env',
    )
  }
  return {
    api,
    sessions: overrides.sessions ?? new RoleSessions(api),
    orgDomain: overrides.orgDomain ?? orgDomain(),
    orgAdmin: overrides.orgAdmin,
    superAdmin,
  }
}

export async function actorToken(ctx: SeedContext, actor: SeedActor): Promise<string> {
  return ctx.sessions.token(actor.email, actor.password, actor.domain ?? ctx.orgDomain)
}

/**
 * Org id resolved from the org-admin JWT claims — keeps seeding DB-free
 * (ST_DATABASE_URL is an optional oracle, not a seeding dependency).
 */
const orgIdCache = new Map<string, string>()

export async function orgIdForContext(ctx: SeedContext): Promise<string> {
  if (!ctx.orgAdmin) {
    throw new Error('orgAdmin actor required to resolve organization id from JWT')
  }
  const cached = orgIdCache.get(ctx.orgDomain)
  if (cached) return cached
  const token = await actorToken(ctx, ctx.orgAdmin)
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  const orgId = claims.org_id ?? claims.orgId ?? claims.organizationId ?? claims.organization_id
  if (!orgId) {
    throw new Error(
      `No org id claim in JWT for ${ctx.orgDomain} (keys: ${Object.keys(claims).join(',')})`,
    )
  }
  orgIdCache.set(ctx.orgDomain, String(orgId))
  return String(orgId)
}

function requireEnv(...keys: string[]): string {
  const value = stEnv(...keys)
  if (value) return value
  throw new Error(`Set ${keys[0]} in test_st_ui/.env`)
}

function optionalSuperAdmin(): SeedActor | undefined {
  const email = stEnv('ST_SUPER_ADMIN_EMAIL', 'E2E_SUPER_ADMIN_EMAIL')
  const password = stEnv('ST_SUPER_ADMIN_PASSWORD', 'E2E_SUPER_ADMIN_PASSWORD')
  if (!email || !password) return undefined
  const baseUrl = stEnv('ST_SUPER_ADMIN_BASE_URL', 'E2E_SUPER_ADMIN_BASE_URL')
  return { email, password, domain: baseUrl ? new URL(baseUrl).hostname : undefined }
}

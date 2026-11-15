/**
 * Organization builders for disposable system-test tenants
 * (testorg-a.clinicle-ci.local / testorg-b.clinicle-ci.local).
 */

import { SeedContext, actorToken } from './context'
import { organizationIdForDomain } from '../db'

export interface OrgFlagProfile {
  enforcePhoneValidation?: boolean
  displayName?: string
}

export const FLAG_PROFILE_ORGS: Record<string, OrgFlagProfile> = {
  'testorg-a': { displayName: 'Test Org A' },
  'testorg-b': { displayName: 'Test Org B' },
}

/**
 * Create an organization as super_admin. Idempotent: returns the existing org when the
 * domain already resolves in the DB.
 */
export async function ensureOrg(
  ctx: SeedContext,
  subdomain: string,
  profile: OrgFlagProfile = {},
): Promise<{ id: string; domain: string; created: boolean }> {
  if (!ctx.superAdmin) {
    throw new Error(
      'Set ST_SUPER_ADMIN_EMAIL/PASSWORD (+ST_SUPER_ADMIN_BASE_URL) in test_st_ui/.env',
    )
  }
  const hostParts = ctx.orgDomain.split('.')
  const platformSuffix = hostParts.length > 1 ? hostParts.slice(1).join('.') : 'localhost'
  const domain = `${subdomain}.${platformSuffix}`
  const displayName = profile.displayName ?? `Test Org ${subdomain}`

  try {
    const id = await organizationIdForDomain(domain)
    return { id, domain, created: false }
  } catch {
    // fall through to create
  }

  const token = await actorToken(ctx, ctx.superAdmin)
  const created = await ctx.api.request<{ id: string }>(
    'POST',
    '/organizations/',
    {
      name: displayName,
      domain,
      isActive: true,
      timezone: 'UTC',
      supportEmail: `support@${domain}`,
      enforcePhoneValidation: profile.enforcePhoneValidation ?? false,
    },
    { token, orgDomain: ctx.superAdmin.domain ?? ctx.orgDomain },
  )

  return { id: created.data.id, domain, created: true }
}

/**
 * User builders.
 *
 * Role keys must be canonical (be/app/v1/auth/org_roles.py); org APIs refuse `super_admin`.
 */

import { SeedContext, actorToken, orgIdForContext } from './context'
import { hasDatabaseUrl, stEnv } from '../env'
import {
  latestEmailVerificationCode,
  organizationIdForDomain,
  userIdForEmail,
} from '../db'
import { runEmail } from '../run-id'

export type OrgRoleKey = 'org_owner' | 'org_admin' | 'user'

export interface SeededUser {
  id: string
  email: string
  password: string
  roles: OrgRoleKey[]
}

export const DEFAULT_SEED_PASSWORD =
  stEnv('ST_SEED_PASSWORD', 'E2E_SEED_PASSWORD') ?? 'St!Passw0rd#2026'

export async function createOrgUser(
  ctx: SeedContext,
  options: { roles: OrgRoleKey[]; label?: string; password?: string; email?: string },
): Promise<SeededUser> {
  if (!ctx.orgAdmin) {
    throw new Error('orgAdmin actor required for createOrgUser')
  }
  const token = await actorToken(ctx, ctx.orgAdmin)
  const email = options.email ?? runEmail(options.label ?? options.roles[0], ctx.orgDomain)
  const password = options.password ?? DEFAULT_SEED_PASSWORD
  const orgId = await orgIdForContext(ctx)

  const created = await ctx.api.request<{ id?: string }>(
    'POST',
    '/users/org',
    {
      email,
      password,
      firstName: 'ST',
      lastName: options.label ?? options.roles[0],
      organizationId: orgId,
      roles: options.roles,
      emailVerified: true,
      skipEmailVerification: true,
    },
    { token },
  )

  const id = created.data?.id ?? (await userIdForEmail(email, orgId))
  return { id, email, password, roles: options.roles }
}

export async function createUserViaPlatform(
  ctx: SeedContext,
  options: {
    organizationId: string
    email: string
    roles: OrgRoleKey[]
    password?: string
    label?: string
  },
): Promise<SeededUser> {
  if (!ctx.superAdmin) throw new Error('superAdmin actor required for createUserViaPlatform')
  const token = await actorToken(ctx, ctx.superAdmin)
  const password = options.password ?? DEFAULT_SEED_PASSWORD

  const created = await ctx.api.request<{ id?: string }>(
    'POST',
    '/users/platform',
    {
      email: options.email,
      password,
      firstName: 'ST',
      lastName: options.label ?? options.roles[0],
      organizationId: options.organizationId,
      roles: options.roles,
      emailVerified: true,
      skipEmailVerification: true,
    },
    { token, orgDomain: ctx.superAdmin.domain },
  )

  const id = created.data?.id ?? (await userIdForEmail(options.email, options.organizationId))
  return { id, email: options.email, password, roles: options.roles }
}

/**
 * No-op: independent user profiles were removed. Kept so existing seed/spec
 * call sites remain valid until they are cleaned up separately.
 */
export async function completeProfile(
  _ctx: SeedContext,
  _user: { email: string; password: string },
  _domain?: string,
): Promise<void> {
  return
}

export async function registerUser(
  ctx: SeedContext,
  options: { label?: string; password?: string } = {},
): Promise<SeededUser> {
  const email = runEmail(options.label ?? 'user', ctx.orgDomain)
  const password = options.password ?? DEFAULT_SEED_PASSWORD

  if (!hasDatabaseUrl()) {
    throw new Error(
      'registerUser requires ST_DATABASE_URL (email verification code is read from the DB).',
    )
  }
  await ctx.api.register({
    email,
    password,
    firstName: 'Eva',
    lastName: 'Tester',
  })

  const orgId = await organizationIdForDomain(ctx.orgDomain)
  const id = await userIdForEmail(email, orgId)
  const code = await latestEmailVerificationCode(id)
  await ctx.api.verifyEmail(email, code)

  return { id, email, password, roles: ['user'] }
}

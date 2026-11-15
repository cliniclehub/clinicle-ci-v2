import path from 'path'

/** App role slug — matches `tests/<slug>/` folder and Playwright project name. */
export type StRoleSlug = 'user' | 'org-admin' | 'org-owner' | 'super-admin'

/** @deprecated Prefer StRoleSlug */
export type E2eRoleSlug = StRoleSlug

export interface StRoleDefinition {
  slug: StRoleSlug
  label: string
  /** Tag for test.describe, e.g. @org-admin */
  tag: string
  emailEnvVars: readonly string[]
  passwordEnvVars: readonly string[]
  setupTitle: string
}

/** @deprecated Prefer StRoleDefinition */
export type E2eRoleDefinition = StRoleDefinition

/**
 * Role folders under tests/ — one folder per app role that can have authenticated
 * system-test specs. Env vars prefer ST_* (system test); E2E_* is a migration fallback.
 */
export const ST_ROLES: readonly StRoleDefinition[] = [
  {
    slug: 'user',
    label: 'User',
    tag: '@user',
    emailEnvVars: ['ST_USER_EMAIL', 'E2E_USER_EMAIL'],
    passwordEnvVars: ['ST_USER_PASSWORD', 'E2E_USER_PASSWORD'],
    setupTitle: 'save user session',
  },
  {
    slug: 'org-admin',
    label: 'Org admin',
    tag: '@org-admin',
    emailEnvVars: [
      'ST_ORG_ADMIN_EMAIL',
      'E2E_ORG_ADMIN_EMAIL',
      'ST_ADMIN_EMAIL',
      'E2E_ADMIN_EMAIL',
    ],
    passwordEnvVars: [
      'ST_ORG_ADMIN_PASSWORD',
      'E2E_ORG_ADMIN_PASSWORD',
      'ST_ADMIN_PASSWORD',
      'E2E_ADMIN_PASSWORD',
    ],
    setupTitle: 'save org admin session',
  },
  {
    slug: 'org-owner',
    label: 'Org owner',
    tag: '@org-owner',
    emailEnvVars: ['ST_ORG_OWNER_EMAIL', 'E2E_ORG_OWNER_EMAIL'],
    passwordEnvVars: ['ST_ORG_OWNER_PASSWORD', 'E2E_ORG_OWNER_PASSWORD'],
    setupTitle: 'save org owner session',
  },
  {
    slug: 'super-admin',
    label: 'Super admin',
    tag: '@super-admin',
    emailEnvVars: ['ST_SUPER_ADMIN_EMAIL', 'E2E_SUPER_ADMIN_EMAIL'],
    passwordEnvVars: ['ST_SUPER_ADMIN_PASSWORD', 'E2E_SUPER_ADMIN_PASSWORD'],
    setupTitle: 'save super admin session',
  },
] as const

/** @deprecated Prefer ST_ROLES */
export const E2E_ROLES = ST_ROLES

function readEnv(vars: readonly string[]): string | undefined {
  for (const key of vars) {
    const value = process.env[key]
    if (value) return value
  }
  return undefined
}

export function getRoleBySlug(slug: StRoleSlug): StRoleDefinition {
  const role = ST_ROLES.find((r) => r.slug === slug)
  if (!role) throw new Error(`Unknown ST role: ${slug}`)
  return role
}

export function hasRoleCredentials(role: StRoleDefinition): boolean {
  return Boolean(readEnv(role.emailEnvVars) && readEnv(role.passwordEnvVars))
}

export function roleCredentials(role: StRoleDefinition): { email: string; password: string } {
  const email = readEnv(role.emailEnvVars)
  const password = readEnv(role.passwordEnvVars)
  if (!email || !password) {
    throw new Error(
      `Set ${role.emailEnvVars[0]} and ${role.passwordEnvVars[0]} in test_st_ui/.env`,
    )
  }
  return { email, password }
}

export function roleCredentialSkipMessage(role: StRoleDefinition): string {
  return `Set ${role.emailEnvVars[0]} and ${role.passwordEnvVars[0]} in test_st_ui/.env`
}

/** App `RoleId` (underscore) for each ST slug (hyphen). */
export function appRoleIdForSlug(slug: StRoleSlug): string {
  return slug.replace(/-/g, '_')
}

export function authFileForRole(slug: StRoleSlug, authDir: string): string {
  return path.join(authDir, `${slug}.json`)
}

export function roleFolderPattern(slug: StRoleSlug): RegExp {
  return new RegExp(`${slug.replace(/-/g, '\\-')}/.*\\.spec\\.ts`)
}

/** Prefer ST_*; fall back to E2E_* for local .env migration. */
export function stEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return undefined
}

export function stSuperAdminBaseUrl(): string | undefined {
  return stEnv('ST_SUPER_ADMIN_BASE_URL', 'E2E_SUPER_ADMIN_BASE_URL')
}

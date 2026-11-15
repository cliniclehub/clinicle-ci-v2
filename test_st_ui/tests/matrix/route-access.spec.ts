/**
 * Route-access matrix — every route prefix × every role (see README.md Architecture).
 *
 * Runs under the `matrix-<role>` projects (each reuses that role's storageState) and
 * `matrix-anonymous` (no session). The role is derived from the project name at runtime.
 * Expected outcome per cell comes from the generated support/matrices/route-roles.json —
 * never from what the UI happens to do.
 *
 * Parameterized routes (e.g. /organization-offerings/{id}/edit) are covered by their static
 * prefix here; entity-level checks live in the journey suites with seeded IDs.
 */

import { expect, test } from '../../support/fixtures'
import matrix from '../../support/matrices/route-roles.json'
import {
  appRoleIdForSlug,
  ST_ROLES,
  hasRoleCredentials,
  type StRoleSlug,
} from '../../support/roles'

type Access = 'allowed' | 'unauthorized' | 'login'

function roleFromProject(projectName: string): StRoleSlug | null {
  const slug = projectName.replace(/^matrix-/, '')
  return slug === 'anonymous' ? null : (slug as StRoleSlug)
}

function expectedAccess(prefix: string, roleSlug: StRoleSlug | null): Access {
  if (!roleSlug) {
    return (matrix.publicPrefixes as string[]).includes(prefix) ? 'allowed' : 'login'
  }
  const allowedRoles = (matrix.rolePrefixRules as Record<string, string[]>)[prefix]
  if (!allowedRoles) return 'allowed' // public or authenticated-only prefix
  return allowedRoles.includes(appRoleIdForSlug(roleSlug)) ? 'allowed' : 'unauthorized'
}

const allPrefixes: string[] = [
  ...(matrix.publicPrefixes as string[]),
  ...(matrix.authenticatedOnlyPrefixes as string[]),
  ...Object.keys(matrix.rolePrefixRules as Record<string, string[]>),
]

test.describe('route access matrix @matrix', () => {
  for (const prefix of allPrefixes) {
    test(`access: ${prefix}`, async ({ page }) => {
      const roleSlug = roleFromProject(test.info().project.name)
      if (roleSlug) {
        const role = ST_ROLES.find((r) => r.slug === roleSlug)
        test.skip(!role || !hasRoleCredentials(role), `Set credentials for ${roleSlug}`)
      }
      const expected = expectedAccess(prefix, roleSlug)

      await page.goto(prefix, { waitUntil: 'domcontentloaded' })

      switch (expected) {
        case 'allowed': {
          // Public pages like /unauthorized and /login are allowed destinations.
          // For other prefixes, wait for any client bounce and reject unauthorized/login.
          if (prefix === '/unauthorized' || prefix === '/login') {
            await expect(page).toHaveURL(new RegExp(`${prefix.replace(/\//g, '\\/')}(/|\\?|$)`), {
              timeout: 8_000,
            })
            break
          }
          await expect
            .poll(() => new URL(page.url()).pathname, { timeout: 8_000, intervals: [100, 250, 500] })
            .not.toMatch(/^\/(unauthorized|login)(\/|$)/)
          const pathname = new URL(page.url()).pathname
          if (!pathname.startsWith(prefix)) {
            expect(
              pathname,
              `expected ${roleSlug ?? 'anonymous'} to be allowed on ${prefix}`,
            ).not.toMatch(/^\/(unauthorized|login)/)
          }
          break
        }
        case 'unauthorized':
          await expect(
            page,
            `expected ${roleSlug} to be blocked from ${prefix}`,
          ).toHaveURL(/\/unauthorized/, { timeout: 8_000 })
          break
        case 'login':
          await expect(
            page,
            `expected anonymous to be sent to login from ${prefix}`,
          ).toHaveURL(/\/login/, { timeout: 8_000 })
          break
      }
    })
  }
})

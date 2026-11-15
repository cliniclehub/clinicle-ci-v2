import { expect, test } from '../../support/fixtures'
import { createSeedContext } from '../../seed/builders/context'
import { completeProfile, createOrgUser, DEFAULT_SEED_PASSWORD } from '../../seed/builders/users'
import { stEnv } from '../../seed/env'

/**
 * Tenant isolation: authenticated routes resolve the org from the caller's token.
 * A different org's identity must not reach this org's users.
 * Primary = Test Org A; isolation peer = Test Org B.
 */
test.describe('Tenant isolation @security @P0', () => {
  const OTHER_ORG_DOMAIN =
    stEnv('ST_TENANT_B_DOMAIN', 'E2E_TENANT_B_DOMAIN', 'API_TEST_TENANT_B_DOMAIN') ||
    'testorg-b.clinicle-ci.local'

  function otherOrgContext() {
    const email =
      stEnv(
        'ST_TENANT_B_ORG_ADMIN_EMAIL',
        'E2E_TENANT_B_ORG_ADMIN_EMAIL',
        'API_TEST_TENANT_B_ORG_ADMIN_EMAIL',
      ) ?? ''
    const password =
      stEnv(
        'ST_TENANT_B_ORG_ADMIN_PASSWORD',
        'E2E_TENANT_B_ORG_ADMIN_PASSWORD',
        'API_TEST_TENANT_B_ORG_ADMIN_PASSWORD',
        'ST_SEED_PASSWORD',
        'E2E_SEED_PASSWORD',
      ) ?? DEFAULT_SEED_PASSWORD
    return createSeedContext({
      orgDomain: OTHER_ORG_DOMAIN,
      orgAdmin: { email, password },
    })
  }

  test("a user from another org cannot read this org's user record", async () => {
    test.slow()
    const ctx = createSeedContext()
    const insider = await createOrgUser(ctx, { roles: ['user'], label: 'tenant-insider' })
    await completeProfile(ctx, insider)

    const otherCtx = otherOrgContext()
    const outsider = await createOrgUser(otherCtx, {
      roles: ['user'],
      label: 'tenant-outsider',
    })
    const outsiderToken = await otherCtx.sessions.token(
      outsider.email,
      outsider.password,
      OTHER_ORG_DOMAIN,
    )

    const foreign = await otherCtx.api.request<{ id?: string }>(
      'GET',
      `/users/org/${insider.id}`,
      undefined,
      {
        token: outsiderToken,
        orgDomain: OTHER_ORG_DOMAIN,
        expectedStatus: 0,
      },
    )
    expect(
      foreign.data?.id,
      `users/org leaked another org's user: ${JSON.stringify(foreign).slice(0, 200)}`,
    ).not.toBe(insider.id)
  })

  test('anonymous callers cannot read org-scoped collections', async () => {
    const ctx = createSeedContext()
    for (const path of ['/users/org', '/media/assets', '/notifications/rules']) {
      const response = await ctx.api.request<unknown>('GET', path, undefined, {
        expectedStatus: 0,
      })
      expect(response.status, `${path} answered an unauthenticated caller with success`).not.toBe(
        'success',
      )
    }
  })
})

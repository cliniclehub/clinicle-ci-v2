/**
 * Super admin smoke — platform host surface.
 *
 * Super admin sessions live on the platform host (ST_SUPER_ADMIN_BASE_URL,
 * e.g. https://admin.clinicle-ci.local), not an org subdomain — auth.setup.ts saves the
 * session there, and this spec pins baseURL to match.
 *
 * Policy truth (fe/lib/utils/middleware-route-policy.ts): /platform-organizations,
 * /platform-users and /platform-settings are super_admin only.
 */

import { expect, test } from '../../support/fixtures'
import { ROUTES, TIMEOUTS } from '../../support/constants'
import { BasePage } from '../../pages/base.page'
import {
  getRoleBySlug,
  hasRoleCredentials,
  roleCredentialSkipMessage,
  stSuperAdminBaseUrl,
} from '../../support/roles'

const role = getRoleBySlug('super-admin')
const platformBaseUrl = stSuperAdminBaseUrl()

// Fallback keeps test.use() valid when the env var is missing; the skip guard below
// prevents the tests from actually running against the fallback.
test.use({ baseURL: platformBaseUrl ?? 'https://admin.clinicle-ci.local' })

const PLATFORM_USERS_ROUTE = '/platform-users'
const PLATFORM_SETTINGS_ROUTE = '/platform-settings'

test.describe(`Super admin platform ${role.tag} @P1`, () => {
  test.skip(!hasRoleCredentials(role), roleCredentialSkipMessage(role))
  test.skip(!platformBaseUrl, 'Set ST_SUPER_ADMIN_BASE_URL in test_st_ui/.env')

  test('platform organizations lists orgs including Test Org A', async ({ page }) => {
    test.slow()
    const shell = new BasePage(page)
    await shell.goto(ROUTES.platformOrganizations)
    await shell.waitForAppReady()

    await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible({
      timeout: TIMEOUTS.catalogLoad,
    })
    await expect(page.getByText('All Organizations')).toBeVisible()
    await expect(
      page.getByRole('link', { name: /create organization/i }),
    ).toBeVisible()

    // Client-side table search filters on organization name (not domain).
    const search = page.getByPlaceholder(/search organizations/i)
    await expect(search).toBeVisible({ timeout: TIMEOUTS.catalogLoad })
    await search.fill('Test Org A')
    await expect(page.getByText('Test Org A', { exact: true }).first()).toBeVisible({
      timeout: TIMEOUTS.catalogLoad,
    })
    await expect(page.getByText(/testorg-a\.clinicle\.local/i).first()).toBeVisible({
      timeout: TIMEOUTS.catalogLoad,
    })
  })

  test('platform users renders', async ({ page }) => {
    test.slow()
    const shell = new BasePage(page)
    await shell.goto(PLATFORM_USERS_ROUTE)
    await shell.waitForAppReady()

    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible({
      timeout: TIMEOUTS.catalogLoad,
    })
    await expect(page.getByText('All Users')).toBeVisible({
      timeout: TIMEOUTS.catalogLoad,
    })
  })

  test('platform settings renders service tabs', async ({ page }) => {
    test.slow()
    const shell = new BasePage(page)
    await shell.goto(PLATFORM_SETTINGS_ROUTE)
    await shell.waitForAppReady()

    await expect(
      page.getByRole('heading', { name: 'Platform Settings' }),
    ).toBeVisible({ timeout: TIMEOUTS.catalogLoad })
    await expect(page.getByRole('tab', { name: 'Email' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'SMS' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Storage' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Security' })).toBeVisible()
  })
})

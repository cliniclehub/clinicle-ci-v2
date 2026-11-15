/**
 * Org-admin typical-org baseline on Test Org A (ORG-ST-002 / USR-ST-002 smoke).
 */

import { expect, test } from '../../support/fixtures'
import { ROUTES, TIMEOUTS } from '../../support/constants'
import { BasePage } from '../../pages/base.page'
import {
  getRoleBySlug,
  hasRoleCredentials,
  roleCredentialSkipMessage,
} from '../../support/roles'

const role = getRoleBySlug('org-admin')

test.describe(`Organization admin baseline ${role.tag} @P1`, () => {
  test.skip(!hasRoleCredentials(role), roleCredentialSkipMessage(role))

  test('organization settings shows Test Org A', async ({ page }) => {
    test.slow()
    const shell = new BasePage(page)
    await shell.goto(ROUTES.organizationSettings)
    await shell.waitForAppReady()

    await expect(
      page.getByRole('heading', { name: 'Organization Settings' }),
    ).toBeVisible({ timeout: TIMEOUTS.catalogLoad })

    await expect(page.getByLabel(/organization name/i)).toHaveValue(/Test Org A/i, {
      timeout: TIMEOUTS.catalogLoad,
    })
  })

  test('organization users lists seeded personas', async ({ page }) => {
    test.slow()
    const shell = new BasePage(page)
    await shell.goto(ROUTES.organizationUsers)
    await shell.waitForAppReady()

    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible({
      timeout: TIMEOUTS.catalogLoad,
    })
    await expect(page.getByText('Organization Users')).toBeVisible({
      timeout: TIMEOUTS.catalogLoad,
    })

    // Seeded fixture emails use @testorg-a.clinicle-test.com (EmailStr rejects .local)
    const search = page.getByPlaceholder(/search/i).first()
    if (await search.isVisible().catch(() => false)) {
      await search.fill('st+fixture-testorg-a')
    }
    await expect(page.getByText(/st\+fixture-testorg-a-/i).first()).toBeVisible({
      timeout: TIMEOUTS.catalogLoad,
    })
  })
})

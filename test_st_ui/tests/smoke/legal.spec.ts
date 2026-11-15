import { expect, test } from '../../support/fixtures'
import { ROUTES } from '../../support/constants'

test.describe('Legal pages @smoke', () => {
  test('privacy policy is reachable', async ({ page }) => {
    await page.goto(ROUTES.privacyPolicy)
    await expect(page.getByRole('heading', { name: /privacy policy/i })).toBeVisible()
  })

  test('terms of use is reachable', async ({ page }) => {
    await page.goto(ROUTES.termsOfUse)
    await expect(page.getByRole('heading', { name: /terms of use/i })).toBeVisible()
  })
})

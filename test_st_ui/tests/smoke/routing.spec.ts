import { expect, test } from '../../support/fixtures'
import { ROUTES } from '../../support/constants'

test.describe('Routing @smoke', () => {
  test('home redirects unauthenticated users to site landing', async ({ page }) => {
    await page.goto(ROUTES.home)
    await expect(page).toHaveURL(/\/site-landing/)
  })

  test('site landing shows sign-in entry point', async ({ siteLandingPage }) => {
    await siteLandingPage.open()
    await expect(siteLandingPage.signInLink).toBeVisible()
  })
})

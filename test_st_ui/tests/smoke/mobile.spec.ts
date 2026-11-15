import { expect, test } from '../../support/fixtures'
import { ROUTES } from '../../support/constants'

test.describe('Routing @smoke @mobile', () => {
  test('login page renders on mobile viewport', async ({ loginPage }) => {
    await loginPage.open()
    await loginPage.expectOnPage()
  })

  test('site landing shows sign-in on mobile', async ({ siteLandingPage }) => {
    await siteLandingPage.open()
    await expect(siteLandingPage.signInLink).toBeVisible()
  })
})

test.describe('Mobile navigation @smoke @mobile', () => {
  test('home redirects to site landing on mobile', async ({ page }) => {
    await page.goto(ROUTES.home)
    await expect(page).toHaveURL(/\/site-landing/)
  })
})

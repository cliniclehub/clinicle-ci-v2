import { expect, test } from '../../support/fixtures'

test.describe('Auth navigation @auth', () => {
  test('login page links to register', async ({ loginPage, page }) => {
    await loginPage.open()
    await page.getByRole('link', { name: /^sign up$/i }).click()
    await expect(page).toHaveURL(/\/register/)
  })

  test('login page links to forgot password', async ({ loginPage, page }) => {
    await loginPage.open()
    await loginPage.forgotPasswordLink.click()
    await expect(page).toHaveURL(/\/forgot-password/)
  })

  test('register page links back to login', async ({ registerPage, page }) => {
    await registerPage.open()
    await registerPage.signInLink.click()
    await expect(page).toHaveURL(/\/login/)
  })

  test('forgot password back button returns to login', async ({ forgotPasswordPage, page }) => {
    await forgotPasswordPage.open()
    // Prefer the semantic "back to login" control; the icon-button fallback is a brittle
    // "first button containing an svg" match (README selector policy).
    const back = (await forgotPasswordPage.backToSignInLink.isVisible().catch(() => false))
      ? forgotPasswordPage.backToSignInLink
      : forgotPasswordPage.backButton
    await back.click()
    await expect(page).toHaveURL(/\/login/)
  })
})

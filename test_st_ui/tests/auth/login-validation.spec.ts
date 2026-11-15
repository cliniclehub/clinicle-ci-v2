import { expect, test } from '../../support/fixtures'

test.describe('Login validation @auth', () => {
  test('shows error for invalid credentials', async ({ loginPage }) => {
    await loginPage.open()
    await loginPage.signIn('not-a-real-user@example.com', 'wrong-password-123')

    await expect(loginPage.errorAlert).toBeVisible({ timeout: 15_000 })
    await expect(loginPage.heading).toBeVisible()
  })

  test('browser blocks submit when email is empty', async ({ loginPage, page }) => {
    await loginPage.open()
    await loginPage.passwordInput.fill('some-password')
    await loginPage.submitButton.click()
    await expect(page).toHaveURL(/\/login/)
  })
})

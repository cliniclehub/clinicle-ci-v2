import { expect, test } from '../../support/fixtures'
import { hasUserCredentials, userCredentials, TIMEOUTS } from '../../support/constants'

test.describe('Login @auth', () => {
  test.skip(!hasUserCredentials(), 'Set ST_USER_EMAIL and ST_USER_PASSWORD in test_st_ui/.env')

  test('valid credentials redirect away from login', async ({ loginPage, page }) => {
    const { email, password } = userCredentials()
    await loginPage.open()
    await loginPage.signIn(email, password)

    await expect(page).not.toHaveURL(/\/login/, { timeout: TIMEOUTS.authRedirect })
    await expect(loginPage.heading).not.toBeVisible()
  })
})
